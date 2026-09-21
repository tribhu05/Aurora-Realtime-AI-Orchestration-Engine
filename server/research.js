// server/research.js
// Autonomous web research and action system for Aurora.
// Modular facade exporting intent detection, query generation,
// multi-engine search orchestration, SSRF-safe page retrieval,
// content extraction, and citation management.

export {
  isResearchNeeded,
  isAcademicResearchQuery,
  isNewsQuery,
  isContextualSourceFollowup,
} from './services/research/intentAnalyzer.js';

export { generateResearchQuery, selectSearchEngine } from './services/research/queryGenerator.js';

export {
  executeSearch,
  executeSearch as performLiveResearch, // Backward-compatible alias
  fetchOpenAcademicPapers,
  fetchOpenNews,
  fetchOpenWebSearch,
} from './services/research/searchOrchestrator.js';

export { normalizeSearchResults, rankSources } from './services/research/sourceSelector.js';

export {
  fetchWebpageContent,
  validateUrlForSsrf,
  isPrivateOrReservedIp,
} from './services/research/pageRetriever.js';

export {
  extractReadableContent,
  wrapUntrustedContent,
} from './services/research/contentExtractor.js';

export {
  formatResearchContextForLLM,
  formatSpokenResearchSummary,
} from './services/research/citationManager.js';

export { executeAutonomousResearch } from './services/research/researchPipeline.js';

import { executeSearch } from './services/research/searchOrchestrator.js';

/**
 * Diagnostic utility to verify SerpApi or fallback search engine connectivity safely.
 *
 * @param {string} [apiKey] - SerpApi key to verify.
 * @param {object} [options] - Options.
 * @returns {Promise<object>} Diagnostic report.
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
    : 'open_fallback_active';

  const endpoint = isConfigured ? 'https://serpapi.com/search.json' : 'autonomous_open_engine';

  const t0 = Date.now();
  const res = await executeSearch(testQuery, {
    apiKey: cleanKey,
    timeoutMs,
    mockResults,
  });
  const latencyMs = Date.now() - t0;

  if (res.ok) {
    return {
      ok: true,
      configured: isConfigured,
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
    error: res.error || 'Search test query failed.',
  };
}
