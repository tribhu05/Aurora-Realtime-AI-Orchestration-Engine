// server/services/research/searchOrchestrator.js
// Autonomous search orchestration across SerpApi, Google News RSS, DuckDuckGo, and Crossref.
// Guarantees reliable live search results with zero secret leakage and automatic open fallbacks.

import { isAcademicResearchQuery, isNewsQuery } from './intentAnalyzer.js';
import { selectSearchEngine } from './queryGenerator.js';
import { normalizeSearchResults } from './sourceSelector.js';

// In-memory query cache with 60s TTL to prevent duplicate API hits and conserve quota
const searchCache = new Map();
const CACHE_TTL_MS = 60_000;

function getCached(key) {
  const item = searchCache.get(key);
  if (!item) return null;
  if (Date.now() - item.timestamp > CACHE_TTL_MS) {
    searchCache.delete(key);
    return null;
  }
  return item.data;
}

function setCache(key, data) {
  // Prune cache if it grows too large
  if (searchCache.size > 200) {
    const oldestKey = searchCache.keys().next().value;
    if (oldestKey) searchCache.delete(oldestKey);
  }
  searchCache.set(key, { data, timestamp: Date.now() });
}

/**
 * Fetches real-time academic research papers via Crossref Works REST API.
 * Free, open, requires no private API keys, and guarantees genuine DOIs and metadata.
 */
export async function fetchOpenAcademicPapers(query, options = {}) {
  const { signal = null, timeoutMs = 5000, rows = 4, fetchFn = globalThis.fetch } = options;

  const cleanQuery = query.trim();
  console.log(`[RESEARCH_TOOL_SELECTED] Tool: crossref_academic | Engine: crossref`);

  const internalController = new AbortController();
  const timeoutId = setTimeout(() => internalController.abort(), timeoutMs);
  if (signal) {
    signal.addEventListener('abort', () => internalController.abort(), { once: true });
  }

  const t0 = Date.now();
  try {
    const encoded = encodeURIComponent(cleanQuery);
    const targetUrl = `https://api.crossref.org/works?query=${encoded}&rows=${rows}&sort=relevance`;
    console.log(`[RESEARCH_API_REQUEST_STARTED] URL: ${targetUrl} | Engine: crossref`);

    const res = await fetchFn(targetUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Aurora-Research-Agent/1.0 (mailto:aurora-research@aurora-agent.dev)',
      },
      signal: internalController.signal,
    });

    const durationMs = Date.now() - t0;
    console.log(
      `[RESEARCH_API_RESPONSE_RECEIVED] Status: ${res.status} | Duration: ${durationMs}ms`
    );

    if (!res.ok) {
      throw new Error(`Crossref API error HTTP ${res.status}`);
    }

    const data = await res.json();
    const items = data?.message?.items || [];
    const results = [];

    for (const item of items) {
      if (!item) continue;
      const rawTitle = Array.isArray(item.title) ? item.title[0] : item.title;
      const title = typeof rawTitle === 'string' ? rawTitle.replace(/<[^>]+>/g, '').trim() : '';
      if (!title) continue;

      const doi = item.DOI || '';
      const directUrl = doi
        ? `https://doi.org/${doi}`
        : item.URL || item.resource?.primary?.URL || '';
      if (!directUrl) continue;

      const year =
        item.issued?.['date-parts']?.[0]?.[0] ||
        item.published?.['date-parts']?.[0]?.[0] ||
        item.created?.['date-parts']?.[0]?.[0] ||
        '';

      const journal = Array.isArray(item['container-title'])
        ? item['container-title'][0]
        : item['container-title'] || item.publisher || 'Crossref Academic';

      const authors = Array.isArray(item.author)
        ? item.author
            .slice(0, 3)
            .map((a) => [a.given, a.family].filter(Boolean).join(' ') || a.name)
            .filter(Boolean)
        : [];
      if (item.author && item.author.length > 3) {
        authors.push('et al.');
      }

      let snippet = '';
      if (typeof item.abstract === 'string') {
        snippet = item.abstract
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 300);
      } else {
        const authorText = authors.length ? `Authors: ${authors.join(', ')}. ` : '';
        const yearText = year ? `(${year}). ` : '';
        const journalText = journal ? `Published in ${journal}.` : '';
        snippet = `${authorText}${yearText}${journalText}`.trim();
      }

      results.push({
        title,
        url: directUrl,
        snippet,
        source: journal,
        sourceType: 'academic_paper',
        year: String(year),
        authors,
        doi,
        position: results.length + 1,
      });

      if (results.length >= 4) break;
    }

    console.log(`[RESEARCH_RESPONSE_PARSED] Extracted ${results.length} verified academic papers`);
    console.log(
      `[RESEARCH_RESULTS_SENT] Transmitting ${results.length} items | Query: "${cleanQuery}"`
    );

    return {
      ok: results.length > 0,
      query: cleanQuery,
      results,
      isAcademic: true,
      source: 'Crossref Academic Registry',
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - t0;
    const isAborted = internalController.signal.aborted;
    const reason = isAborted ? 'timeout or aborted' : err.message || String(err);
    console.warn(`[RESEARCH_REQUEST_FAILED] Category: ACADEMIC_FETCH_ERROR | Reason: ${reason}`);
    return {
      ok: false,
      query: cleanQuery,
      results: [],
      error: reason,
      isAcademic: true,
      durationMs,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetches real-time news headlines and articles via public Google News RSS.
 * Free, open, zero credentials required, guarantees live breaking news and current affairs.
 */
export async function fetchOpenNews(query, options = {}) {
  const { signal = null, timeoutMs = 4000, fetchFn = globalThis.fetch } = options;
  const cleanQuery = query.trim();
  console.log(`[RESEARCH_TOOL_SELECTED] Tool: open_news_rss | Engine: google_news_rss`);

  const internalController = new AbortController();
  const timeoutId = setTimeout(() => internalController.abort(), timeoutMs);
  if (signal) {
    signal.addEventListener('abort', () => internalController.abort(), { once: true });
  }

  const t0 = Date.now();
  try {
    const encoded = encodeURIComponent(cleanQuery);
    const targetUrl = `https://news.google.com/rss/search?q=${encoded}&hl=en-US&gl=US&ceid=US:en`;
    console.log(`[RESEARCH_API_REQUEST_STARTED] URL: ${targetUrl} | Engine: google_news_rss`);

    const res = await fetchFn(targetUrl, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/rss+xml, application/xml, text/xml',
      },
      signal: internalController.signal,
    });

    const durationMs = Date.now() - t0;
    console.log(
      `[RESEARCH_API_RESPONSE_RECEIVED] Status: ${res.status} | Duration: ${durationMs}ms`
    );

    if (!res.ok) {
      throw new Error(`Google News RSS error HTTP ${res.status}`);
    }

    const xml = await res.text();
    const itemMatches = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
    const results = [];

    for (const raw of itemMatches.slice(0, 4)) {
      const titleMatch = raw.match(/<title>([\s\S]*?)<\/title>/);
      const linkMatch = raw.match(/<link>([\s\S]*?)<\/link>/);
      const pubDateMatch = raw.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
      const sourceMatch = raw.match(/<source[^>]*>([\s\S]*?)<\/source>/);

      if (titleMatch && linkMatch) {
        let cleanTitle = titleMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim();
        const cleanUrl = linkMatch[1].trim();
        const source = sourceMatch
          ? sourceMatch[1].replace(/<[^>]+>/g, '').trim()
          : 'Live News Wire';
        // Strip trailing "- SourceName" from title if present
        if (source && cleanTitle.endsWith(` - ${source}`)) {
          cleanTitle = cleanTitle.slice(0, -(source.length + 3)).trim();
        }

        const pubDate = pubDateMatch ? pubDateMatch[1].trim() : '';
        const yearMatch = pubDate.match(/\b(20\d\d)\b/);
        const year = yearMatch ? yearMatch[1] : new Date().getFullYear().toString();

        results.push({
          title: cleanTitle,
          url: cleanUrl,
          snippet: `Published on ${pubDate || 'recent news'} by ${source}.`,
          source,
          sourceType: 'news',
          year,
          position: results.length + 1,
        });
      }
    }

    console.log(`[RESEARCH_RESPONSE_PARSED] Extracted ${results.length} live news sources`);
    console.log(
      `[RESEARCH_RESULTS_SENT] Transmitting ${results.length} items | Query: "${cleanQuery}"`
    );

    return {
      ok: results.length > 0,
      query: cleanQuery,
      results,
      isNews: true,
      source: 'Google News Wire',
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - t0;
    const isAborted = internalController.signal.aborted;
    const reason = isAborted ? 'timeout or aborted' : err.message || String(err);
    console.warn(`[RESEARCH_REQUEST_FAILED] Category: NEWS_FETCH_ERROR | Reason: ${reason}`);
    return {
      ok: false,
      query: cleanQuery,
      results: [],
      error: reason,
      isNews: true,
      durationMs,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetches organic search results via DuckDuckGo HTML search.
 * Free, open, resilient fallback for general web, documentation, and technical queries.
 */
export async function fetchOpenWebSearch(query, options = {}) {
  const { signal = null, timeoutMs = 4500, fetchFn = globalThis.fetch } = options;
  const cleanQuery = query.trim();
  console.log(`[RESEARCH_TOOL_SELECTED] Tool: open_web_search | Engine: duckduckgo_html`);

  const internalController = new AbortController();
  const timeoutId = setTimeout(() => internalController.abort(), timeoutMs);
  if (signal) {
    signal.addEventListener('abort', () => internalController.abort(), { once: true });
  }

  const t0 = Date.now();
  try {
    const encoded = encodeURIComponent(cleanQuery);
    const targetUrl = `https://html.duckduckgo.com/html/?q=${encoded}`;
    console.log(`[RESEARCH_API_REQUEST_STARTED] URL: ${targetUrl} | Engine: duckduckgo_html`);

    const res = await fetchFn(targetUrl, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: internalController.signal,
    });

    const durationMs = Date.now() - t0;
    console.log(
      `[RESEARCH_API_RESPONSE_RECEIVED] Status: ${res.status} | Duration: ${durationMs}ms`
    );

    if (!res.ok) {
      throw new Error(`DuckDuckGo error HTTP ${res.status}`);
    }

    const html = await res.text();
    const blocks = html.split(/class="[^"]*web-result[^"]*"/).slice(1);
    const results = [];

    for (const block of blocks) {
      const tMatch = block.match(
        /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/
      );
      const sMatch = block.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/);

      if (tMatch) {
        const rawUrl = tMatch[1];
        const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
        const cleanUrl = uddgMatch ? decodeURIComponent(uddgMatch[1]) : rawUrl;

        // Skip DuckDuckGo internal ads or search links
        if (cleanUrl.includes('duckduckgo.com') || cleanUrl.startsWith('/')) continue;

        const cleanTitle = tMatch[2].replace(/<[^>]+>/g, '').trim();
        const cleanSnippet = sMatch
          ? sMatch[1]
              .replace(/<[^>]+>/g, '')
              .replace(/&#x27;/g, "'")
              .replace(/&quot;/g, '"')
              .replace(/&amp;/g, '&')
              .replace(/\s+/g, ' ')
              .trim()
          : '';

        let hostname = 'web';
        try {
          hostname = new URL(cleanUrl).hostname.replace(/^www\./, '');
        } catch (_) {}

        // Determine source type
        let sourceType = 'web';
        if (
          hostname.startsWith('docs.') ||
          hostname.includes('developer.') ||
          hostname.includes('github.io') ||
          hostname === 'react.dev' ||
          hostname === 'nodejs.org' ||
          hostname === 'nextjs.org'
        ) {
          sourceType = 'documentation';
        }

        results.push({
          title: cleanTitle,
          url: cleanUrl,
          snippet: cleanSnippet,
          source: hostname,
          sourceType,
          position: results.length + 1,
        });

        if (results.length >= 4) break;
      }
    }

    console.log(`[RESEARCH_RESPONSE_PARSED] Extracted ${results.length} web search results`);
    console.log(
      `[RESEARCH_RESULTS_SENT] Transmitting ${results.length} items | Query: "${cleanQuery}"`
    );

    return {
      ok: results.length > 0,
      query: cleanQuery,
      results,
      source: 'DuckDuckGo Web Search',
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - t0;
    const isAborted = internalController.signal.aborted;
    const reason = isAborted ? 'timeout or aborted' : err.message || String(err);
    console.warn(`[RESEARCH_REQUEST_FAILED] Category: WEB_SEARCH_ERROR | Reason: ${reason}`);
    return {
      ok: false,
      query: cleanQuery,
      results: [],
      error: reason,
      durationMs,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Executes a search query using SerpApi (primary) with automatic open fallbacks
 * (Google News RSS, DuckDuckGo, Crossref).
 *
 * @param {string} query - The search query.
 * @param {object} options - Search configuration.
 * @returns {Promise<{ ok: boolean, query: string, results: Array<any>, error?: string, raw?: object, isAcademic?: boolean, source?: string, durationMs: number }>}
 */
export async function executeSearch(query, options = {}) {
  const {
    apiKey = '',
    signal = null,
    timeoutMs = 4000,
    engine = 'google',
    mockResults = null,
    fetchFn = globalThis.fetch,
    isAcademic = false,
    allowOpenFallback = false,
  } = options;

  const academicQuery = Boolean(isAcademic || isAcademicResearchQuery(query));
  const newsQuery = isNewsQuery(query);
  console.log(
    `[RESEARCH_REQUEST_RECEIVED] Query: "${query}" | Academic: ${academicQuery} | News: ${newsQuery}`
  );

  if (signal?.aborted) {
    console.warn(`[RESEARCH_REQUEST_FAILED] Category: ABORTED | Reason: aborted`);
    return { ok: false, query, results: [], error: 'aborted', durationMs: 0 };
  }

  // 1. Mock results for unit tests & offline CI
  if (mockResults) {
    console.log(`[RESEARCH_TOOL_SELECTED] Tool: mock_search | Engine: ${engine}`);
    console.log(`[SERPAPI_REQUEST_STARTED] Query: "${query}" (engine: ${engine}, mock: true)`);
    const normalized = normalizeSearchResults(mockResults, query);
    console.log(`[SERPAPI_RESPONSE_RECEIVED] Status: 200 (mock)`);
    console.log(
      `[SERPAPI_RESULT_COUNT] Count: ${normalized.results.length} | Query: "${query}" (mock)`
    );
    console.log(
      `[RESEARCH_RESPONSE_PARSED] Extracted ${normalized.results.length} verified sources`
    );
    console.log(
      `[RESEARCH_RESULTS_SENT] Transmitting ${normalized.results.length} items | Query: "${query}"`
    );
    return {
      ok: true,
      query,
      results: normalized.results,
      raw: mockResults,
      isAcademic: academicQuery,
      source: 'Mock Search Engine',
      durationMs: 1,
    };
  }

  // 2. Check query cache
  const cacheKey = `${engine}:${academicQuery}:${query.toLowerCase().trim()}`;
  const cached = getCached(cacheKey);
  if (cached) {
    console.log(`[RESEARCH_CACHE_HIT] Query: "${query}"`);
    return { ...cached, durationMs: 0 };
  }

  const cleanApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  const effectiveEngine = selectSearchEngine(query, {
    isAcademic: academicQuery,
    isNews: newsQuery,
  });

  // 3. Fallback check if SerpApi key is missing or placeholder
  const isKeyValid = cleanApiKey && !/^your_.*_here$/i.test(cleanApiKey);
  if (!isKeyValid) {
    if (academicQuery) {
      console.log(
        `[RESEARCH_KEY_NOTICE] SerpApi unconfigured, activating autonomous open academic engine`
      );
      return fetchOpenAcademicPapers(query, { signal, timeoutMs, fetchFn });
    }

    if (allowOpenFallback) {
      console.log(
        `[RESEARCH_KEY_NOTICE] SerpApi unconfigured, activating autonomous open search engine`
      );
      let fallbackRes;
      if (newsQuery) {
        fallbackRes = await fetchOpenNews(query, { signal, timeoutMs, fetchFn });
        if (!fallbackRes.ok || fallbackRes.results.length === 0) {
          fallbackRes = await fetchOpenWebSearch(query, { signal, timeoutMs, fetchFn });
        }
      } else {
        fallbackRes = await fetchOpenWebSearch(query, { signal, timeoutMs, fetchFn });
        if (!fallbackRes.ok || fallbackRes.results.length === 0) {
          fallbackRes = await fetchOpenNews(query, { signal, timeoutMs, fetchFn });
        }
      }

      if (fallbackRes.ok && fallbackRes.results.length > 0) {
        setCache(cacheKey, fallbackRes);
      }
      return fallbackRes;
    }

    console.warn(
      `[SERPAPI_REQUEST_FAILED] Category: MISSING_API_KEY | Reason: SERPAPI_KEY is not configured or placeholder.`
    );
    console.warn(
      `[RESEARCH_REQUEST_FAILED] Category: MISSING_API_KEY | Reason: SERPAPI_KEY is not configured or placeholder.`
    );
    return {
      ok: false,
      query,
      results: [],
      error: 'SERPAPI_KEY is not configured or placeholder.',
      durationMs: 0,
    };
  }

  // 4. Primary: SerpApi request
  console.log(`[RESEARCH_TOOL_SELECTED] Tool: serpapi | Engine: ${effectiveEngine}`);
  const internalController = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    internalController.abort();
  }, timeoutMs);

  const onAbort = () => internalController.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });

  const t0 = Date.now();
  try {
    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('engine', effectiveEngine);
    url.searchParams.set('q', query);
    url.searchParams.set('api_key', cleanApiKey);

    console.log(
      `[RESEARCH_API_REQUEST_STARTED] URL: https://serpapi.com/search.json | Engine: ${effectiveEngine}`
    );
    console.log(`[SERPAPI_REQUEST_STARTED] Query: "${query}" | Engine: ${effectiveEngine}`);

    const response = await fetchFn(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: internalController.signal,
    });

    const durationMs = Date.now() - t0;
    console.log(`[SERPAPI_RESPONSE_RECEIVED] Status: ${response.status}`);
    console.log(
      `[RESEARCH_API_RESPONSE_RECEIVED] Status: ${response.status} | Duration: ${durationMs}ms`
    );

    if (!response.ok) {
      let errorCategory = 'API_ERROR';
      if (response.status === 401 || response.status === 403) {
        errorCategory = 'AUTHENTICATION_FAILED';
      } else if (response.status === 429) {
        errorCategory = 'RATE_LIMITED';
      } else if (response.status >= 500) {
        errorCategory = 'SERPAPI_SERVER_ERROR';
      }
      const safeErr = `SerpApi HTTP error ${response.status}: ${response.statusText || response.status}`;
      console.error(`[SERPAPI_REQUEST_FAILED] Category: ${errorCategory} | Error: ${safeErr}`);
      console.error(`[RESEARCH_REQUEST_FAILED] Category: ${errorCategory} | Reason: ${safeErr}`);

      // Gracefully fall back to open search engines on SerpApi failure if enabled
      if (academicQuery) {
        console.log(
          `[RESEARCH_FALLBACK] SerpApi failed (${response.status}), falling back to open academic engine`
        );
        return fetchOpenAcademicPapers(query, { signal, timeoutMs, fetchFn });
      }
      if (allowOpenFallback) {
        console.log(
          `[RESEARCH_FALLBACK] SerpApi failed (${response.status}), falling back to open engines`
        );
        if (newsQuery) {
          return fetchOpenNews(query, { signal, timeoutMs, fetchFn });
        }
        return fetchOpenWebSearch(query, { signal, timeoutMs, fetchFn });
      }
      return {
        ok: false,
        query,
        results: [],
        error: safeErr,
      };
    }

    const data = await response.json();
    const normalized = normalizeSearchResults(data, query);
    console.log(`[SERPAPI_RESULT_COUNT] Count: ${normalized.results.length} | Query: "${query}"`);
    console.log(
      `[RESEARCH_RESPONSE_PARSED] Extracted ${normalized.results.length} verified sources`
    );

    // If 0 results returned from SerpApi, try open fallback
    if (normalized.results.length === 0) {
      if (academicQuery) {
        console.log(`[RESEARCH_TOOL_SELECTED] 0 SerpApi results, trying open academic fallback`);
        return fetchOpenAcademicPapers(query, { signal, timeoutMs, fetchFn });
      }
      if (allowOpenFallback) {
        console.log(`[RESEARCH_TOOL_SELECTED] 0 SerpApi results, trying open engines fallback`);
        if (newsQuery) {
          return fetchOpenNews(query, { signal, timeoutMs, fetchFn });
        }
        return fetchOpenWebSearch(query, { signal, timeoutMs, fetchFn });
      }
    }

    console.log(
      `[RESEARCH_RESULTS_SENT] Transmitting ${normalized.results.length} items | Query: "${query}"`
    );

    const resultPayload = {
      ok: true,
      query,
      results: normalized.results,
      raw: data,
      isAcademic: academicQuery,
      source:
        effectiveEngine === 'google_scholar'
          ? 'Google Scholar via SerpApi'
          : effectiveEngine === 'google_news'
            ? 'Google News via SerpApi'
            : 'SerpApi Google Search',
      durationMs,
    };

    setCache(cacheKey, resultPayload);
    return resultPayload;
  } catch (err) {
    const durationMs = Date.now() - t0;
    if (signal?.aborted || err?.name === 'AbortError') {
      const reason = timedOut ? 'timeout' : 'aborted';
      console.warn(
        `[SERPAPI_REQUEST_FAILED] Category: ${timedOut ? 'TIMEOUT' : 'ABORTED'} | Reason: ${reason}`
      );
      console.warn(
        `[RESEARCH_REQUEST_FAILED] Category: ${timedOut ? 'TIMEOUT' : 'ABORTED'} | Reason: ${reason}`
      );
      return { ok: false, query, results: [], error: reason, durationMs };
    }

    // Mask secret keys from error messages
    const safeError = (err.message || String(err)).replace(cleanApiKey, '***REDACTED***');
    console.error(`[SERPAPI_REQUEST_FAILED] Category: NETWORK_ERROR | Error: ${safeError}`);
    console.error(`[RESEARCH_REQUEST_FAILED] Category: NETWORK_ERROR | Reason: ${safeError}`);

    if (academicQuery) {
      console.log(
        `[RESEARCH_FALLBACK] SerpApi network error, falling back to open academic engine`
      );
      return fetchOpenAcademicPapers(query, { signal, timeoutMs, fetchFn });
    }
    if (allowOpenFallback) {
      console.log(`[RESEARCH_FALLBACK] SerpApi network error, falling back to open engines`);
      if (newsQuery) {
        return fetchOpenNews(query, { signal, timeoutMs, fetchFn });
      }
      return fetchOpenWebSearch(query, { signal, timeoutMs, fetchFn });
    }
    return {
      ok: false,
      query,
      results: [],
      error: safeError,
      durationMs,
    };
  } finally {
    clearTimeout(timeoutId);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}
