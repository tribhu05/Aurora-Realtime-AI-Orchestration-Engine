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
 * Determines whether a given user text warrants live web research or external inspection.
 *
 * @param {string} text - The raw user prompt or transcribed speech.
 * @returns {boolean} True if research or GitHub inspection should be conducted.
 */
export function isResearchNeeded(text) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (trimmed.length < 3) return false;

  // 1. Guard against timeless elementary queries
  for (const pattern of TIMELESS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return false;
    }
  }

  // 2. Check for GitHub repository URL
  if (detectGitHubUrl(trimmed)) {
    return true;
  }

  // 3. Check for explicit or technical current-info triggers
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
 * @returns {string} Clean search query suitable for SerpApi.
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
      const source =
        item.source ||
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
 * @param {{ query: string, results: Array<{ title: string, url: string, snippet: string, source?: string }> }} researchData
 * @returns {string} Formatted context block.
 */
export function formatResearchContextForLLM(researchData) {
  if (!researchData || !Array.isArray(researchData.results) || researchData.results.length === 0) {
    return '';
  }

  const lines = [
    'LIVE WEB RESEARCH',
    '',
    `Research query:`,
    researchData.query || 'current query',
    '',
    'Sources:',
  ];

  researchData.results.forEach((r, idx) => {
    lines.push(`${idx + 1}. ${r.title}`);
    lines.push(`   ${r.url}`);
    if (r.snippet) {
      lines.push(`   ${r.snippet}`);
    }
    lines.push('');
  });

  lines.push('Instructions for utilizing research:');
  lines.push('- Ground facts, code packages, and recommendations in these sources.');
  lines.push('- Spoken channel: Summarize naturally without reading raw URLs or list asterisks.');
  lines.push('- Visual channel: You may reference findings and provide clean markdown links.');

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
 * Executes a live research query against SerpApi with strict AbortSignal cancellation,
 * configurable timeout, and robust error handling.
 *
 * @param {string} query - The search query.
 * @param {object} options - Execution options.
 * @param {string} [options.apiKey] - SerpApi API key.
 * @param {AbortSignal} [options.signal] - Signal for mid-flight barge-in cancellation.
 * @param {number} [options.timeoutMs=4000] - Hard timeout threshold.
 * @param {string} [options.engine='google'] - Target search engine.
 * @param {object} [options.mockResults] - Pre-canned results for deterministic offline tests.
 * @param {Function} [options.fetchFn] - Custom fetch override for unit testing.
 * @returns {Promise<{ ok: boolean, query: string, results: Array<any>, error?: string, raw?: object }>}
 */
export async function performLiveResearch(query, options = {}) {
  const {
    apiKey = '',
    signal = null,
    timeoutMs = 4000,
    engine = 'google',
    mockResults = null,
    fetchFn = globalThis.fetch,
  } = options;

  if (signal?.aborted) {
    return { ok: false, query, results: [], error: 'aborted' };
  }

  // 1. Check for mock results (for offline testing & test suite)
  if (mockResults) {
    const normalized = normalizeSearchResults(mockResults, query);
    return {
      ok: true,
      query,
      results: normalized.results,
      raw: mockResults,
    };
  }

  const cleanApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!cleanApiKey || /^your_.*_here$/i.test(cleanApiKey)) {
    return {
      ok: false,
      query,
      results: [],
      error: 'SERPAPI_KEY is not configured or placeholder.',
    };
  }

  // 2. Setup timeout controller combined with external barge-in signal
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

  try {
    // 3. Execute request via native fetch to SerpApi endpoint
    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('engine', engine);
    url.searchParams.set('q', query);
    url.searchParams.set('api_key', cleanApiKey);

    const response = await fetchFn(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: internalController.signal,
    });

    if (!response.ok) {
      const statusText = response.statusText || String(response.status);
      return {
        ok: false,
        query,
        results: [],
        error: `SerpApi HTTP error ${response.status}: ${statusText}`,
      };
    }

    const data = await response.json();
    const normalized = normalizeSearchResults(data, query);

    return {
      ok: true,
      query,
      results: normalized.results,
      raw: data,
    };
  } catch (err) {
    if (signal?.aborted || err?.name === 'AbortError') {
      return {
        ok: false,
        query,
        results: [],
        error: timedOut ? 'timeout' : 'aborted',
      };
    }

    // Mask any accidental keys in error message
    const safeError = (err.message || String(err)).replace(cleanApiKey, '***REDACTED***');
    return {
      ok: false,
      query,
      results: [],
      error: safeError,
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
