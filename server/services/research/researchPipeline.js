// server/services/research/researchPipeline.js
// Autonomous end-to-end research pipeline coordinating intent analysis,
// multi-engine search, source ranking, webpage retrieval, and content extraction.

import { isResearchNeeded, isContextualSourceFollowup } from './intentAnalyzer.js';
import { generateResearchQuery } from './queryGenerator.js';
import { executeSearch } from './searchOrchestrator.js';
import { rankSources } from './sourceSelector.js';
import { fetchWebpageContent } from './pageRetriever.js';
import { extractReadableContent } from './contentExtractor.js';
import { formatResearchContextForLLM } from './citationManager.js';

/**
 * Executes the complete autonomous web research and action pipeline.
 *
 * @param {string} userText - User prompt.
 * @param {object} [options] - Execution configuration.
 * @param {string} [options.apiKey] - Optional SerpApi key.
 * @param {AbortSignal} [options.signal] - Cancellation signal.
 * @param {number} [options.timeoutMs=4500] - Hard search timeout.
 * @param {Array<object>} [options.recentSources=[]] - Sources from recent turns in session.
 * @param {boolean} [options.fetchPages=true] - Whether to retrieve full content of top sources.
 * @param {number} [options.maxPagesToRead=2] - Maximum source pages to fetch.
 * @param {object} [options.mockResults] - Mock results for tests.
 * @param {Function} [options.onProgress] - Callback for real-time progress events.
 * @returns {Promise<{
 *   ok: boolean,
 *   query: string,
 *   results: Array<object>,
 *   context?: string,
 *   source?: string,
 *   isAcademic?: boolean,
 *   isNews?: boolean,
 *   sourcesRead: number,
 *   sourcesFailed: number,
 *   durationMs: number
 * }>}
 */
export async function executeAutonomousResearch(userText, options = {}) {
  const {
    apiKey = '',
    signal = null,
    timeoutMs = 4500,
    recentSources = [],
    fetchPages = true,
    maxPagesToRead = 2,
    mockResults = null,
    onProgress = null,
    fetchFn = globalThis.fetch,
  } = options;

  const t0 = Date.now();

  const emit = (event) => {
    if (typeof onProgress === 'function') {
      try {
        onProgress(event);
      } catch (_) {}
    }
  };

  // 1. Contextual Follow-Up Check:
  // If the user asks about a previous source ("paper 2", "the first link"),
  // avoid a new search and inspect or retrieve that source directly!
  const followupCheck = isContextualSourceFollowup(userText, recentSources);
  if (followupCheck.isFollowup && followupCheck.targetSource) {
    const target = { ...followupCheck.targetSource };
    console.log(
      `[RESEARCH_CONTEXTUAL_FOLLOWUP] Identified target source #${followupCheck.targetIndex + 1}: "${target.title}"`
    );

    emit({
      step: 'reading',
      status: 'Reading target source from conversation...',
      source: target.source,
      url: target.url,
    });

    // If page content not yet retrieved, fetch it now
    if (!target.readContent && target.url && !target.url.startsWith('#')) {
      const pageRes = await fetchWebpageContent(target.url, { signal, timeoutMs: 3500, fetchFn });
      if (pageRes.ok && pageRes.html) {
        const extracted = extractReadableContent(pageRes.html);
        target.readContent = extracted.content;
        emit({
          step: 'read_success',
          status: `Read source: ${target.title.slice(0, 40)}...`,
          url: target.url,
        });
      }
    }

    const durationMs = Date.now() - t0;
    const context = formatResearchContextForLLM({
      query: userText,
      results: [target],
      source: target.source || 'Conversation Context',
      isAcademic: Boolean(target.doi || target.year),
    });

    emit({
      step: 'completed',
      status: 'Research completed using conversation source.',
      count: 1,
    });

    return {
      ok: true,
      query: userText,
      results: [target],
      context,
      source: target.source || 'Conversation Context',
      isAcademic: Boolean(target.doi || target.year),
      sourcesRead: target.readContent ? 1 : 0,
      sourcesFailed: 0,
      durationMs,
    };
  }

  // 2. Intent Analysis:
  if (!isResearchNeeded(userText)) {
    return {
      ok: false,
      query: '',
      results: [],
      sourcesRead: 0,
      sourcesFailed: 0,
      durationMs: Date.now() - t0,
    };
  }

  // 3. Generate Clean Query:
  const researchQuery = generateResearchQuery(userText);
  emit({
    step: 'searching',
    status: `Searching web sources for "${researchQuery.slice(0, 48)}"`,
    query: researchQuery,
  });

  // 4. Search Execution:
  const searchResult = await executeSearch(researchQuery, {
    apiKey,
    signal,
    timeoutMs,
    mockResults,
    fetchFn,
    allowOpenFallback: true,
  });

  if (!searchResult.ok || !searchResult.results || searchResult.results.length === 0) {
    emit({
      step: 'failed',
      status: searchResult.error || 'Search yielded no usable sources',
    });
    return {
      ok: false,
      query: researchQuery,
      results: [],
      error: searchResult.error || 'No sources found',
      sourcesRead: 0,
      sourcesFailed: 0,
      durationMs: Date.now() - t0,
    };
  }

  emit({
    step: 'sources_found',
    status: `Found ${searchResult.results.length} relevant sources.`,
    count: searchResult.results.length,
    sources: searchResult.results,
  });

  // 5. Source Ranking:
  const rankedSources = rankSources(searchResult.results);

  // 6. Webpage Retrieval for Top Sources:
  let sourcesRead = 0;
  let sourcesFailed = 0;

  if (fetchPages && !mockResults && !searchResult.isAcademic) {
    const pagesToFetch = rankedSources.slice(0, maxPagesToRead);

    for (const source of pagesToFetch) {
      if (signal?.aborted) break;
      if (!source.url || source.url.startsWith('#') || source.url.endsWith('.pdf')) continue;

      emit({
        step: 'reading',
        status: `Reading: ${source.title.slice(0, 45)}...`,
        url: source.url,
      });

      try {
        const pageRes = await fetchWebpageContent(source.url, {
          signal,
          timeoutMs: 3000,
          fetchFn,
        });

        if (pageRes.ok && pageRes.html) {
          const extracted = extractReadableContent(pageRes.html);
          if (extracted.content) {
            source.readContent = extracted.content;
            if (extracted.title && !source.title) source.title = extracted.title;
            sourcesRead += 1;
            emit({
              step: 'read_success',
              status: `Successfully read: ${source.title.slice(0, 35)}...`,
              url: source.url,
            });
            continue;
          }
        }
        sourcesFailed += 1;
        emit({
          step: 'read_failed',
          status: `Could not read full page, using search summary.`,
          url: source.url,
        });
      } catch (_) {
        sourcesFailed += 1;
      }
    }
  }

  const durationMs = Date.now() - t0;
  const context = formatResearchContextForLLM({
    query: researchQuery,
    results: rankedSources,
    source: searchResult.source,
    isAcademic: searchResult.isAcademic,
  });

  emit({
    step: 'completed',
    status: `Research completed using ${rankedSources.length} sources.`,
    count: rankedSources.length,
    sourcesRead,
  });

  return {
    ok: true,
    query: researchQuery,
    results: rankedSources,
    context,
    source: searchResult.source,
    isAcademic: searchResult.isAcademic,
    isNews: searchResult.isNews,
    sourcesRead,
    sourcesFailed,
    durationMs,
  };
}
