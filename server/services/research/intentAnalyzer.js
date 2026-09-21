// server/services/research/intentAnalyzer.js
// Intelligent research decision layer for Aurora.
// Distinguishes queries requiring live web data from casual or timeless conceptual queries,
// and identifies contextual follow-up references to previously retrieved sources.

import { detectGitHubUrl } from '../../github.js';

/**
 * High-signal regex patterns indicating information that is dynamic, temporal,
 * current, or requires external web verification.
 */
const RESEARCH_TRIGGER_PATTERNS = [
  /\b(?:latest|recent|currently|current|trending|breaking|today'?s|now)\b/i,
  /\b(?:research|look\s*up|check\s*documentation|check\s*docs)\b/i,
  /\b(?:current\s*best\s*practices|best\s*practices\s*in\s*202[4-9])\b/i,
  /\b(?:latest\s*version|current\s*version|latest\s*release|new\s*features\s*in)\b/i,
  /\b(?:current\s*api|current\s*documentation|official\s*documentation|docs\s*for)\b/i,
  /\b(?:compare\s*current|current\s*libraries|recommended\s*approach)\b/i,
  /\b(?:news|current\s*affairs|weather|temperature|forecast|climate)\b/i,
  /\b(?:who\s+is\s+(?:the\s+)?(?:current\s+)?(?:ceo|president|founder|director|prime\s*minister))\b/i,
  /\b(?:ceo|founder|net\s*worth|stock\s*price)\s+of\b/i,
  /\b(?:search\s*(?:for|the\s*web|online|google)?)\b/i,
  /\b(?:tell\s+me\s+about\s+(?:this\s+)?(?:repo|repository))\b/i,
  /\b(?:sources?|citations?|references?|papers?|studies|literature)\b/i,
  /\b(?:what\s+happened\s+(?:to|with|in))\b/i,
  /\b(?:when\s+(?:was|is)\s+(?:the\s+)?(?:latest|release|launch|event))\b/i,
];

/**
 * Queries that should NEVER trigger web research.
 * Guards sub-second latency for basic conversational greetings, arithmetic,
 * creative writing, and standard timeless computer science concepts.
 */
const TIMELESS_PATTERNS = [
  /^(?:hi|hello|hey|good\s*(?:morning|afternoon|evening)|howdy|greetings|namaste|hola)\b[!.? ]*$/i,
  /^how\s+are\s+you(?:\s+doing)?\??$/i,
  /^who\s+are\s+you\??$/i,
  /^what\s+is\s+your\s+name\??$/i,
  /^what\s+is\s+(?:a\s+)?(?:function|variable|loop|recursion|gravity|quantum\s+physics|an\s+http\s+request)\??$/i,
  /^(?:write|create)\s+a\s+(?:python\s+)?hello\s*world/i,
  /^calculate\s+\d+/i,
  /^what\s+is\s+\d+\s*[+\-*/x×]\s*\d+/i,
  /^\d+\s*[+\-*/x×]\s*\d+\s*(?:equals|\?|$)/i,
  /^(?:write|compose|generate)\s+(?:a\s+)?(?:poem|story|song|haiku|joke|fiction)/i,
  /^explain\s+what\s+(?:a\s+)?(?:javascript\s+function|function|http\s+request|express\s+middleware)\s+is/i,
  /^explain\s+(?:recursion|gravity|general\s+relativity|binary\s+search)\.?$/i,
];

/**
 * Detects if a query targets academic literature, peer-reviewed studies,
 * scientific journals, conference proceedings, or DOIs.
 *
 * @param {string} text - User input.
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
 * Detects if a query is news-oriented or current-affairs-oriented.
 *
 * @param {string} text - User prompt.
 * @returns {boolean} True if news or current affairs query.
 */
export function isNewsQuery(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.toLowerCase();
  return /\b(?:news|current\s*affairs|headlines|breaking\s*news|today'?s\s*news|latest\s*news|press\s*release|world\s*news|tech\s*news)\b/i.test(
    t
  );
}

/**
 * Evaluates whether external web research is needed.
 *
 * @param {string} text - The raw user prompt.
 * @returns {boolean} True if web research should be triggered.
 */
export function isResearchNeeded(text) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (trimmed.length < 3) return false;

  // 1. Academic queries always warrant live research
  if (isAcademicResearchQuery(trimmed)) {
    return true;
  }

  // 2. Guard against timeless elementary/conversational queries
  for (const pattern of TIMELESS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return false;
    }
  }

  // 3. GitHub repository inspection
  if (detectGitHubUrl(trimmed)) {
    return true;
  }

  // 4. Check dynamic/research triggers
  for (const pattern of RESEARCH_TRIGGER_PATTERNS) {
    if (pattern.test(trimmed)) {
      return true;
    }
  }

  return false;
}

/**
 * Detects when a user query is a follow-up referencing an existing source
 * previously retrieved in the conversation context.
 *
 * Examples:
 * - "Explain the methodology used in paper 2"
 * - "Summarize the first link"
 * - "What does source 3 say about deployment?"
 * - "Tell me more about this paper"
 *
 * @param {string} text - User prompt.
 * @param {Array<object>} recentSources - Sources found in recent turns.
 * @returns {{ isFollowup: boolean, targetIndex?: number, targetSource?: object }}
 */
export function isContextualSourceFollowup(text, recentSources = []) {
  if (
    !text ||
    typeof text !== 'string' ||
    !Array.isArray(recentSources) ||
    recentSources.length === 0
  ) {
    return { isFollowup: false };
  }

  const t = text.trim().toLowerCase();

  // Pattern: "paper 2", "source 1", "the second link", "the 3rd article"
  const indexMatch = t.match(
    /\b(?:paper|source|link|article|result)\s*(?:#|no\.?|number\s*)?(\d+)\b/i
  );
  if (indexMatch) {
    const idx = parseInt(indexMatch[1], 10) - 1; // 1-indexed to 0-indexed
    if (idx >= 0 && idx < recentSources.length) {
      return { isFollowup: true, targetIndex: idx, targetSource: recentSources[idx] };
    }
  }

  // Ordinal matches: "first paper", "second source", "third link"
  const ordinals = [
    { pattern: /\b(?:first|1st)\s+(?:paper|source|link|article|result)\b/i, idx: 0 },
    { pattern: /\b(?:second|2nd)\s+(?:paper|source|link|article|result)\b/i, idx: 1 },
    { pattern: /\b(?:third|3rd)\s+(?:paper|source|link|article|result)\b/i, idx: 2 },
    { pattern: /\b(?:fourth|4th)\s+(?:paper|source|link|article|result)\b/i, idx: 3 },
  ];
  for (const ord of ordinals) {
    if (ord.pattern.test(t) && ord.idx < recentSources.length) {
      return { isFollowup: true, targetIndex: ord.idx, targetSource: recentSources[ord.idx] };
    }
  }

  // Generic reference: "this paper", "the paper above", "that source"
  if (
    /\b(?:this\s+(?:paper|source|article)|that\s+(?:paper|source|article)|the\s+(?:paper|source|article)\s+above)\b/i.test(
      t
    )
  ) {
    return { isFollowup: true, targetIndex: 0, targetSource: recentSources[0] };
  }

  return { isFollowup: false };
}
