// server/services/research/queryGenerator.js
// Extracts clean, focused search queries and selects appropriate search engines.

import { detectGitHubUrl } from '../../github.js';
import { isAcademicResearchQuery, isNewsQuery } from './intentAnalyzer.js';

/**
 * Extracts a concise, high-signal search query from natural language input.
 * Strips conversational preamble, politeness fillers, and task directives
 * while retaining core keywords, entities, versions, and qualifiers.
 *
 * @param {string} text - User prompt.
 * @returns {string} Clean search query suitable for search engines.
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
    /\s+and\s+(?:then\s+)?(?:build|scaffold|create|write|implement|generate)\s+.*$/i,
    ''
  );
  q = q.replace(/\s+and\s+build\s+a\s+project.*$/i, '');
  q = q.replace(/\s+using\s+(?:current|latest)\s+best\s+practices.*$/i, '');

  // Strip trailing punctuation
  q = q.replace(/[?.!]+$/, '').trim();

  return q || text.trim();
}

/**
 * Selects the most appropriate search engine based on query characteristics.
 *
 * @param {string} query - Clean search query.
 * @param {object} [intent] - Optional intent metadata.
 * @returns {'google_scholar' | 'google_news' | 'google'} Selected search engine identifier.
 */
export function selectSearchEngine(query, intent = {}) {
  if (intent.isAcademic || isAcademicResearchQuery(query)) {
    return 'google_scholar';
  }
  if (intent.isNews || isNewsQuery(query)) {
    return 'google_news';
  }
  return 'google';
}
