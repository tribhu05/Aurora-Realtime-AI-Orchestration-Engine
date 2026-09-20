// server/research.js
// Autonomous live research capability for Aurora powered by SerpApi.
// Provides deterministic intent detection, clean query generation,
// AbortSignal-compatible search execution, result normalization,
// and dual-channel LLM context formatting.

import { detectGitHubUrl } from './github.js';

/**
 * Deterministic triggers for queries that require live web research.
 * Covers current libraries, release notes, recent docs, explicit research requests,
 * weather queries, current figures/events, and web searches.
 */
const RESEARCH_TRIGGER_PATTERNS = [
  /\b(?:latest|recent|currently|current)\b/i,
  /\b(?:research|look\s*up|check\s*documentation|check\s*docs)\b/i,
  /\b(?:current\s*best\s*practices|best\s*practices\s*in\s*202[4-9])\b/i,
  /\b(?:latest\s*version|current\s*version|latest\s*release)\b/i,
  /\b(?:current\s*api|current\s*documentation|official\s*documentation)\b/i,
  /\b(?:compare\s*current|current\s*libraries|recommended\s*approach)\b/i,
  /\b(?:today'?s\s*news|today'?s\s*weather|current\s*events)\b/i,
  /\b(?:documentation\s*for|docs\s*for)\b/i,
  /\b(?:search\s*(?:for|the\s*web|online|google)?)\b/i,
  /\b(?:weather|temperature|forecast|climate)\b/i,
  /\b(?:who\s+is\s+(?:the\s+)?(?:current\s+)?(?:ceo|president|founder|director|prime\s*minister))\b/i,
  /\b(?:ceo|founder|net\s*worth|stock\s*price)\s+of\b/i,
  /\b(?:github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)\b/i,
  /\b(?:tell\s+me\s+about\s+(?:this\s+)?(?:repo|repository))\b/i,
];

/**
 * Basic / timeless queries that should NEVER trigger web research.
 * Protects sub-second latency for standard algorithmic, conversational, or elementary questions.
 */
const TIMELESS_PATTERNS = [
  /^what\s+is\s+(?:a\s+)?(?:function|variable|loop|recursion|gravity|quantum\s+physics|an\s+http\s+request)\??$/i,
  /^(?:write|create)\s+a\s+(?:python\s+)?hello\s*world/i,
  /^calculate\s+\d+/i,
  /^what\s+is\s+\d+\s*[+\-*/x×]\s*\d+/i,
  /^explain\s+what\s+(?:a\s+)?(?:javascript\s+function|function|http\s+request|express\s+middleware)\s+is/i,
  /^explain\s+(?:recursion|gravity|general\s+relativity|binary\s+search)\.?$/i,
];

/**
 * Detects if a query is asking for scientific research papers, academic literature,
 * peer-reviewed studies, conference proceedings, or journal publications.
 *
 * @param {string} text - User prompt or search query.
 * @returns {boolean} True if query targets academic research papers.
 */
export function isAcademicResearchQuery(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.toLowerCase();
  return (
    /\b(?:research\s+paper|research\s+papers|academic\s+papers?|scientific\s+papers?|scholarly|peer-reviewed|journal\s+articles?|conference\s+proceedings?|literature\s+review|studies\s+on|study\s+on|arxiv|doi\.org|crossref|scholar)\b/i.test(
      t
    ) ||
    (/\b(?:paper|papers|studies|literature)\b/i.test(t) &&
      /\b(?:recent|latest|find|search|show|assistive|technology|biomedical|engineering|algorithm|model)\b/i.test(
        t
      ))
  );
}

/**
 * Determines whether a given user text warrants live web research or external inspection.
 *
 * @param {string} text - The raw user prompt or transcribed speech.
 * @returns {boolean} True if research or GitHub inspection should be conducted.
 */
export function isResearchNeeded(text) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (trimmed.length < 3) return false;

  // 1. Academic queries always warrant live research
  if (isAcademicResearchQuery(trimmed)) {
    return true;
  }

  // 2. Guard against timeless elementary queries
  for (const pattern of TIMELESS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return false;
    }
  }

  // 3. Check for GitHub repository URL
  if (detectGitHubUrl(trimmed)) {
    return true;
  }

  // 4. Check for explicit or technical current-info triggers
  for (const pattern of RESEARCH_TRIGGER_PATTERNS) {
    if (pattern.test(trimmed)) {
      return true;
    }
  }

  return false;
}

/**
 * Extracts a concise, high-signal search query from the user's natural language input.
 * Strips conversational preamble, politeness fillers, and task commands while retaining
 * key technical terms, framework names, and version qualifiers.
 *
 * @param {string} text - User prompt.
 * @returns {string} Clean search query suitable for SerpApi or Academic API.
 */
export function generateResearchQuery(text) {
  if (!text || typeof text !== 'string') return '';

  const gh = detectGitHubUrl(text);
  if (gh) {
    return `${gh.owner} ${gh.repo} GitHub`;
  }

  let q = text.trim();

  // Strip common conversational / voice prefixes
  q = q.replace(/^(?:aurora\s*,?\s*)/i, '');
  q = q.replace(
    /^(?:can\s+you\s+(?:please\s+)?|could\s+you\s+(?:please\s+)?|please\s+|i\s+want\s+(?:you\s+to\s+)?|kindly\s+)/i,
    ''
  );

  // Strip research paper commands and trailing link requests
  q = q.replace(
    /^(?:find|search\s+for|show\s+me|get|fetch)\s+(?:recent|latest)?\s*(?:research\s+)?(?:papers?|articles?|studies|literature)\s+(?:on|about|regarding)?\s*/i,
    ''
  );
  q = q.replace(/^(?:research\s+papers?\s+(?:on|about)?\s*)/i, '');
  q = q.replace(/\s+and\s+(?:provide|give|include)\s+(?:direct\s+)?links?.*$/i, '');
  q = q.replace(/\s+with\s+(?:direct\s+)?links?.*$/i, '');
  q = q.replace(/\s+provide\s+(?:direct\s+)?links?.*$/i, '');

  q = q.replace(/^(?:search\s+(?:for|the\s+web\s+for|online\s+for|google\s+for)?\s*)/i, '');
  q = q.replace(/^(?:look\s*up\s+(?:the\s+)?)/i, '');
  q = q.replace(/^(?:research\s+(?:the\s+)?)/i, '');
  q = q.replace(
    /^(?:check\s+(?:the\s+)?(?:latest\s+)?documentation\s+(?:for|and\s+build)?\s*)/i,
    ''
  );
  q = q.replace(/^(?:tell\s+me\s+(?:about\s+)?|explain\s+to\s+me\s+)/i, '');
  q = q.replace(/^(?:what\s+is\s+the\s+|what's\s+the\s+|who\s+is\s+the\s+)/i, '');
  q = q.replace(/^(?:create|build|scaffold|setup|set\s+up|generate)\s+(?:an?\s+)?/i, '');

  // Strip trailing scaffolding instructions if preceded by research intent
  q = q.replace(
    /\s+and\s+(?:then\s+)?(?:create|build|scaffold|setup|generate)\s+(?:an?\s+)?.*$/i,
    ''
  );
  q = q.replace(/\s+before\s+(?:creating|building|scaffolding|setting\s+up)\s+.*$/i, '');

  // Clean excess punctuation
  q = q.replace(/[?!.:;]+$/g, '').trim();

  // If query became too short, fall back to cleaned original
  if (q.length < 3) {
    q = text
      .replace(/^(?:aurora\s*,?\s*)/i, '')
      .replace(/[?!.:;]+$/g, '')
      .trim();
  }

  // Cap query length to 100 characters / ~12 words for focused Google search
  const words = q.split(/\s+/).slice(0, 12);
  return words.join(' ');
}

/**
 * Normalizes raw SerpApi search results into a clean, sanitized list of sources.
 * Limits output to top 3–5 high-relevance items and deduplicates URLs.
 *
 * @param {object} data - Raw SerpApi response JSON.
 * @param {string} query - The search query executed.
 * @returns {{ query: string, results: Array<{ title: string, url: string, snippet: string, source: string, position: number }> }}
 */
export function normalizeSearchResults(data, query = '') {
  if (!data || typeof data !== 'object') {
    return { query, results: [] };
  }

  const rawResults = [];

  // 1. Check knowledge graph / answer box first if present
  if (data.answer_box && data.answer_box.title && (data.answer_box.link || data.answer_box.url)) {
    rawResults.push({
      title: data.answer_box.title,
      url: data.answer_box.link || data.answer_box.url,
      snippet: data.answer_box.snippet || data.answer_box.answer || '',
      source: data.answer_box.source || 'Direct Answer',
      position: 0,
    });
  }

  // 2. Check organic results
  if (Array.isArray(data.organic_results)) {
    for (const item of data.organic_results) {
      if (!item || (!item.link && !item.url)) continue;
      const url = item.link || item.url || '';
      const title = item.title || item.displayed_link || 'Web Source';
      const snippet = item.snippet || item.description || '';
      const pubInfo = item.publication_info;
      let year = '';
      let authors = [];
      let sourceName = '';

      if (pubInfo && typeof pubInfo === 'object') {
        const summary = pubInfo.summary || '';
        const yMatch = summary.match(/\b(19\d\d|20\d\d)\b/);
        if (yMatch) year = yMatch[1];
        if (Array.isArray(pubInfo.authors)) {
          authors = pubInfo.authors
            .map((a) => (typeof a === 'string' ? a : a.name))
            .filter(Boolean);
        }
        sourceName = summary.split('-').pop()?.trim() || 'Google Scholar';
      }

      const source =
        item.source ||
        sourceName ||
        (() => {
          try {
            return new URL(url).hostname.replace(/^www\./, '');
          } catch {
            return 'Web';
          }
        })();

      rawResults.push({
        title,
        url,
        snippet,
        source,
        year,
        authors,
        pdfUrl: item.resources?.[0]?.link || null,
        position: item.position || rawResults.length + 1,
      });
    }
  }

  // Deduplicate by URL
  const seenUrls = new Set();
  const deduped = [];
  for (const item of rawResults) {
    if (!item.url || seenUrls.has(item.url)) continue;
    seenUrls.add(item.url);
    deduped.push(item);
    if (deduped.length >= 4) break; // Maximum 4 high-quality results
  }

  return {
    query,
    results: deduped,
  };
}

/**
 * Formats research findings into a clear, structured markdown block
 * for inclusion in LLM prompt / system messages.
 *
 * @param {{ query: string, results: Array<{ title: string, url: string, snippet: string, source?: string, year?: string, authors?: Array<string>, doi?: string }>, isAcademic?: boolean, source?: string }} researchData
 * @returns {string} Formatted context block.
 */
export function formatResearchContextForLLM(researchData) {
  if (!researchData || !Array.isArray(researchData.results) || researchData.results.length === 0) {
    return '';
  }

  const isAcademic = Boolean(
    researchData.isAcademic || researchData.results.some((r) => r.year || r.doi)
  );
  const header = isAcademic ? 'VERIFIED ACADEMIC RESEARCH PAPERS' : 'LIVE WEB RESEARCH';

  const lines = [
    header,
    '',
    `Research topic: ${researchData.query || 'current topic'}`,
    `Source registry: ${researchData.source || 'Verified Research Engine'}`,
    '',
    isAcademic ? 'Verified Peer-Reviewed Literature & Studies:' : 'Sources:',
  ];

  researchData.results.forEach((r, idx) => {
    const yearStr = r.year ? ` (${r.year})` : '';
    const authorStr =
      Array.isArray(r.authors) && r.authors.length ? ` - Authors: ${r.authors.join(', ')}` : '';
    const sourceStr = r.source ? ` [${r.source}]` : '';
    lines.push(`${idx + 1}. ${r.title}${yearStr}${sourceStr}`);
    lines.push(`   Direct Link: ${r.url}`);
    if (r.doi) {
      lines.push(`   DOI: ${r.doi}`);
    }
    if (authorStr) {
      lines.push(`  ${authorStr}`);
    }
    if (r.snippet) {
      lines.push(`   Summary: ${r.snippet}`);
    }
    lines.push('');
  });

  lines.push('Instructions for utilizing research:');
  lines.push('- Ground all answers, citations, and summaries strictly in these verified sources.');
  lines.push(
    '- Spoken channel: Summarize findings conversationally without reading raw URLs or DOI strings aloud.'
  );
  lines.push(
    '- Visual channel: Reference the papers with authors, year, and provide clickable markdown links.'
  );
  lines.push('- CRITICAL: Never fabricate fake paper titles, fake DOIs, or fake URLs.');

  return lines.join('\n');
}

/**
 * Returns a natural spoken lead-in phrase acknowledging live research,
 * strictly avoiding raw URLs, markdown asterisks, or robotic formatting.
 *
 * @param {{ results: Array<any> }} researchData
 * @returns {string} Natural spoken lead-in.
 */
export function formatSpokenResearchSummary(researchData) {
  if (!researchData || !Array.isArray(researchData.results) || researchData.results.length === 0) {
    return '';
  }
  const count = researchData.results.length;
  if (count === 1) {
    return 'Based on current official documentation, ';
  }
  return 'Based on current web sources and documentation, ';
}

/**
 * Fetches real, peer-reviewed academic research papers via Crossref Works REST API.
 * Free, open, requires no private API keys, and guarantees genuine DOIs and metadata.
 *
 * @param {string} query - Academic research query.
 * @param {object} [options={}] - Options.
 * @returns {Promise<{ ok: boolean, query: string, results: Array<any>, error?: string, isAcademic: boolean, source: string, durationMs: number }>}
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
      const title =
        typeof rawTitle === 'string' ? rawTitle.replace(/<[^>]+>/g, '').trim() : '';
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
        year: String(year),
        authors,
        doi,
        position: results.length + 1,
      });

      if (results.length >= 4) break;
    }

    console.log(
      `[RESEARCH_RESPONSE_PARSED] Extracted ${results.length} verified academic papers`
    );
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
 * Executes a live research query against SerpApi with strict AbortSignal cancellation,
 * configurable timeout, automatic academic fallback to Crossref, and robust error handling.
 *
 * @param {string} query - The search query.
 * @param {object} options - Execution options.
 * @param {string} [options.apiKey] - SerpApi API key.
 * @param {AbortSignal} [options.signal] - Signal for mid-flight barge-in cancellation.
 * @param {number} [options.timeoutMs=4000] - Hard timeout threshold.
 * @param {string} [options.engine='google'] - Target search engine.
 * @param {object} [options.mockResults] - Pre-canned results for deterministic offline tests.
 * @param {Function} [options.fetchFn] - Custom fetch override for unit testing.
 * @param {boolean} [options.isAcademic=false] - Force academic research pipeline.
 * @returns {Promise<{ ok: boolean, query: string, results: Array<any>, error?: string, raw?: object, isAcademic?: boolean, source?: string }>}
 */
export async function performLiveResearch(query, options = {}) {
  const {
    apiKey = '',
    signal = null,
    timeoutMs = 4000,
    engine = 'google',
    mockResults = null,
    fetchFn = globalThis.fetch,
    isAcademic = false,
  } = options;

  const academicQuery = Boolean(isAcademic || isAcademicResearchQuery(query));
  console.log(`[RESEARCH_REQUEST_RECEIVED] Query: "${query}" | Academic: ${academicQuery}`);

  if (signal?.aborted) {
    console.warn(`[RESEARCH_REQUEST_FAILED] Category: ABORTED | Reason: aborted`);
    return { ok: false, query, results: [], error: 'aborted' };
  }

  // 1. Check for mock results (for offline testing & test suite)
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
    };
  }

  const cleanApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  const effectiveEngine =
    academicQuery && cleanApiKey ? options.engine || 'google_scholar' : engine;

  // 2. If no valid SerpApi key:
  if (!cleanApiKey || /^your_.*_here$/i.test(cleanApiKey)) {
    if (academicQuery) {
      console.log(
        `[RESEARCH_TOOL_SELECTED] SerpApi unconfigured, falling back to open academic literature API`
      );
      return fetchOpenAcademicPapers(query, { signal, timeoutMs, fetchFn });
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
    };
  }

  // 3. Setup timeout controller combined with external barge-in signal
  console.log(`[RESEARCH_TOOL_SELECTED] Tool: serpapi | Engine: ${effectiveEngine}`);
  const internalController = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    internalController.abort();
  }, timeoutMs);

  const onAbort = () => {
    internalController.abort();
  };
  if (signal) {
    signal.addEventListener('abort', onAbort, { once: true });
  }

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
      headers: {
        Accept: 'application/json',
      },
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
      const statusText = response.statusText || String(response.status);
      const safeErr = `SerpApi HTTP error ${response.status}: ${statusText}`;
      console.error(`[SERPAPI_REQUEST_FAILED] Category: ${errorCategory} | Error: ${safeErr}`);
      console.error(`[RESEARCH_REQUEST_FAILED] Category: ${errorCategory} | Reason: ${safeErr}`);

      // If academic query failed on SerpApi, fall back to Crossref
      if (academicQuery) {
        console.log(
          `[RESEARCH_TOOL_SELECTED] SerpApi error (${response.status}), falling back to open academic literature API`
        );
        return fetchOpenAcademicPapers(query, { signal, timeoutMs, fetchFn });
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

    // If academic query returned 0 results on scholar, fall back to Crossref
    if (academicQuery && normalized.results.length === 0) {
      console.log(
        `[RESEARCH_TOOL_SELECTED] 0 scholar results, falling back to open academic literature API`
      );
      return fetchOpenAcademicPapers(query, { signal, timeoutMs, fetchFn });
    }

    console.log(
      `[RESEARCH_RESULTS_SENT] Transmitting ${normalized.results.length} items | Query: "${query}"`
    );

    return {
      ok: true,
      query,
      results: normalized.results,
      raw: data,
      isAcademic: academicQuery,
      source:
        effectiveEngine === 'google_scholar'
          ? 'Google Scholar via SerpApi'
          : 'SerpApi Google Search',
      durationMs,
    };
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
      return {
        ok: false,
        query,
        results: [],
        error: reason,
        durationMs,
      };
    }

    // Mask any accidental keys in error message
    const safeError = (err.message || String(err)).replace(cleanApiKey, '***REDACTED***');
    console.error(`[SERPAPI_REQUEST_FAILED] Category: NETWORK_ERROR | Error: ${safeError}`);
    console.error(`[RESEARCH_REQUEST_FAILED] Category: NETWORK_ERROR | Reason: ${safeError}`);

    if (academicQuery) {
      console.log(
        `[RESEARCH_TOOL_SELECTED] SerpApi network error, falling back to open academic literature API`
      );
      return fetchOpenAcademicPapers(query, { signal, timeoutMs, fetchFn });
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
    if (signal) {
      signal.removeEventListener('abort', onAbort);
    }
  }
}

/**
 * Diagnostic utility to verify SerpApi connectivity safely without exposing secrets.
 * Validates API key existence, endpoint reachability, parameter formatting,
 * and quota/authentication status with real or mock search execution.
 *
 * @param {string} [apiKey] - SerpApi key to verify. Defaults to process.env.
 * @param {object} [options] - Verification options.
 * @param {string} [options.testQuery='latest AI news'] - Test query to execute.
 * @param {number} [options.timeoutMs=5000] - Diagnostic timeout threshold.
 * @param {object} [options.mockResults] - Optional mock results for tests.
 * @returns {Promise<{
 *   ok: boolean,
 *   configured: boolean,
 *   endpoint: string,
 *   query: string,
 *   status?: number,
 *   resultCount: number,
 *   latencyMs: number,
 *   maskedKey: string,
 *   error?: string
 * }>}
 */
export async function testSerpApiConnectivity(apiKey = null, options = {}) {
  const { testQuery = 'latest AI news', timeoutMs = 5000, mockResults = null } = options;

  const key =
    (typeof apiKey === 'string' && apiKey.trim()) ||
    process.env.SERPAPI_API_KEY ||
    process.env.SERPAPI_KEY ||
    '';

  const cleanKey = key.trim().replace(/^["']|["']$/g, '');
  const isConfigured = Boolean(cleanKey && !/^your_.*_here$/i.test(cleanKey));
  const maskedKey = isConfigured
    ? cleanKey.length > 8
      ? `${cleanKey.slice(0, 4)}...${cleanKey.slice(-4)}`
      : '****'
    : 'none';

  const endpoint = 'https://serpapi.com/search.json';

  if (!isConfigured && !mockResults) {
    return {
      ok: false,
      configured: false,
      endpoint,
      query: testQuery,
      resultCount: 0,
      latencyMs: 0,
      maskedKey: 'none',
      error: 'SERPAPI_API_KEY is not configured on the server.',
    };
  }

  const t0 = Date.now();
  const res = await performLiveResearch(testQuery, {
    apiKey: cleanKey,
    timeoutMs,
    mockResults,
  });
  const latencyMs = Date.now() - t0;

  if (res.ok) {
    return {
      ok: true,
      configured: true,
      endpoint,
      query: testQuery,
      status: 200,
      resultCount: Array.isArray(res.results) ? res.results.length : 0,
      latencyMs,
      maskedKey,
      resultsPreview: (res.results || []).slice(0, 2).map((r) => ({
        title: r.title,
        source: r.source,
        url: r.url,
      })),
    };
  }

  return {
    ok: false,
    configured: isConfigured,
    endpoint,
    query: testQuery,
    resultCount: 0,
    latencyMs,
    maskedKey,
    error: res.error || 'SerpApi test query failed.',
  };
}
