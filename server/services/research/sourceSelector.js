// server/services/research/sourceSelector.js
// Source discovery, metadata extraction, ranking, and deduplication.

const OFFICIAL_DOC_DOMAINS = new Set([
  'docs.github.com',
  'developer.mozilla.org',
  'nodejs.org',
  'react.dev',
  'nextjs.org',
  'vuejs.org',
  'angular.dev',
  'typescriptlang.org',
  'expressjs.com',
  'python.org',
  'go.dev',
  'rust-lang.org',
  'kubernetes.io',
  'docker.com',
  'cloud.google.com',
  'aws.amazon.com',
  'learn.microsoft.com',
]);

/**
 * Normalizes raw search response items into structured, verified sources.
 *
 * @param {object} data - Raw SerpApi response or custom search data.
 * @param {string} query - The search query.
 * @returns {{ query: string, results: Array<object> }} Normalized sources.
 */
export function normalizeSearchResults(data, query) {
  if (!data || typeof data !== 'object') {
    return { query, results: [] };
  }

  const rawResults = [];

  // 1. Direct answer box / knowledge graph
  if (data.answer_box && typeof data.answer_box === 'object') {
    rawResults.push({
      title: data.answer_box.title || 'Direct Answer',
      url: data.answer_box.link || data.answer_box.url || '',
      snippet: data.answer_box.snippet || data.answer_box.answer || '',
      source: data.answer_box.source || 'Direct Answer',
      sourceType: 'official',
      position: 0,
    });
  }

  // 2. Organic results
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

      let domain = 'Web';
      try {
        domain = new URL(url).hostname.replace(/^www\./, '');
      } catch (_) {}

      const source = item.source || sourceName || domain;

      // Classify source type
      let sourceType = 'web';
      if (
        OFFICIAL_DOC_DOMAINS.has(domain) ||
        domain.startsWith('docs.') ||
        domain.includes('developer.') ||
        domain.includes('github.io')
      ) {
        sourceType = 'documentation';
      } else if (
        pubInfo ||
        item.result_id ||
        domain.includes('scholar') ||
        domain.includes('doi.org')
      ) {
        sourceType = 'academic_paper';
      }

      rawResults.push({
        title,
        url,
        snippet,
        source,
        sourceType,
        year,
        authors,
        pdfUrl: item.resources?.[0]?.link || null,
        position: item.position || rawResults.length + 1,
      });
    }
  }

  // Deduplicate by canonical URL
  const seenUrls = new Set();
  const deduped = [];
  for (const item of rawResults) {
    if (!item.url || seenUrls.has(item.url)) continue;
    seenUrls.add(item.url);
    deduped.push(item);
    if (deduped.length >= 4) break;
  }

  return {
    query,
    results: deduped,
  };
}

/**
 * Ranks sources prioritizing official documentation, recency, and credibility.
 *
 * @param {Array<object>} sources - Raw sources.
 * @returns {Array<object>} Ranked sources.
 */
export function rankSources(sources) {
  if (!Array.isArray(sources) || sources.length === 0) return [];

  return [...sources].sort((a, b) => {
    // Official documentation gets top priority (+10)
    const aDoc = a.sourceType === 'documentation' ? 10 : 0;
    const bDoc = b.sourceType === 'documentation' ? 10 : 0;

    // Academic papers with verified DOIs (+5)
    const aDoi = a.doi ? 5 : 0;
    const bDoi = b.doi ? 5 : 0;

    // Recent publications (+2)
    const aYear = parseInt(a.year, 10) || 0;
    const bYear = parseInt(b.year, 10) || 0;

    const aScore = aDoc + aDoi + (aYear > 2023 ? 2 : 0);
    const bScore = bDoc + bDoi + (bYear > 2023 ? 2 : 0);

    if (bScore !== aScore) {
      return bScore - aScore;
    }

    return (a.position || 0) - (b.position || 0);
  });
}
