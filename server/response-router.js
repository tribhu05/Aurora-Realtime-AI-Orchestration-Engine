// server/response-router.js
// Intelligent Response Router for Aurora: Voice-First AI Workspace.
// Classifies requests into VOICE, TEXT, or HYBRID modalities.
// Enforces spoken response budgets, validates structured contracts,
// and applies deterministic server-side safety corrections.

export const RESPONSE_MODES = {
  VOICE: 'VOICE',
  TEXT: 'TEXT',
  HYBRID: 'HYBRID',
};

// Spoken word count limits by modality
export const SPOKEN_BUDGETS = {
  VOICE: 35, // Natural, concise conversational answer (max ~40 words)
  TEXT: 20, // Brief acknowledgement confirming content is in workspace
  HYBRID: 25, // High-level conceptual summary or recommendation (10-25 words)
};

/**
 * Checks whether a string contains structured programming code, markdown tables,
 * JSON, or technical syntax that must NEVER be read aloud by Rime TTS.
 */
export function containsStructuredContent(text) {
  if (!text || typeof text !== 'string') return false;

  // Code fences
  if (/```[\s\S]*?```/.test(text)) return true;

  // Markdown tables
  if (/\|[^\n]+\|\n\|[-:\s|]+\|/m.test(text)) return true;

  // Markdown headers
  if (/^#{1,4}\s+/m.test(text)) return true;

  // JSON objects or arrays
  if (/^\s*[{[][\s\S]*[}\]]\s*$/.test(text.trim())) return true;

  // Common programming constructs
  if (
    /(?:^|\b)(?:def\s+\w+\s*\(|function\s+\w+\s*\(|const\s+\w+\s*=|let\s+\w+\s*=|var\s+\w+\s*=|class\s+\w+\s*[{:]|int\s+main\s*\(|public:\s*|std::|SELECT\s+[\w*]+\s+FROM|#include\s*<)/i.test(
      text
    )
  ) {
    return true;
  }

  // Multi-line numbered or bulleted list (3+ items)
  const listItems = text.match(/\n\s*[-*•\d+.]\s+[^\n]+/g);
  if (listItems && listItems.length >= 3) return true;

  return false;
}

/**
 * Enforces the spoken response word budget while preserving grammatically
 * complete sentences and natural flow.
 */
export function enforceSpokenBudget(spokenText, mode = 'VOICE') {
  if (!spokenText || typeof spokenText !== 'string') {
    return mode === 'TEXT'
      ? "I've written the response in the workspace."
      : "I've prepared that for you in the workspace.";
  }

  // 1. Strip raw markdown/code artifacts from speech
  let clean = spokenText
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*#_~]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!clean) {
    return mode === 'TEXT'
      ? "I've written the response in the workspace."
      : "I've prepared that in the workspace.";
  }

  const maxWords = SPOKEN_BUDGETS[mode] || 35;
  const words = clean.split(/\s+/);

  if (words.length <= maxWords) {
    return clean;
  }

  // 2. Sentence-aware trimming: accumulate complete sentences up to maxWords
  const sentenceMatches = clean.match(/[^.!?]+[.!?]+(\s+|$)/g);
  if (sentenceMatches && sentenceMatches.length > 0) {
    let accumulated = '';
    let wordCount = 0;

    for (const sentence of sentenceMatches) {
      const sentenceWords = sentence.trim().split(/\s+/).length;
      if (wordCount + sentenceWords <= maxWords) {
        accumulated += sentence;
        wordCount += sentenceWords;
      } else {
        break;
      }
    }

    if (accumulated.trim().length > 0) {
      return accumulated.trim();
    }
  }

  // 3. Fallback: Trim to nearest word within budget and add period
  const truncatedWords = words.slice(0, maxWords);
  let truncatedText = truncatedWords.join(' ').replace(/[,;:\s]+$/, '');
  if (!/[.!?]$/.test(truncatedText)) {
    truncatedText += '.';
  }

  return truncatedText;
}

/**
 * Deterministic intent classifier based on request characteristics,
 * expected response complexity, and conversation history.
 * Used for offline fallback and server-side safety correction.
 */
export function deterministicClassify(userText, history = []) {
  if (!userText || typeof userText !== 'string') return RESPONSE_MODES.VOICE;
  const t = userText.toLowerCase().trim();

  // 1. Task Scaffolding Intent -> HYBRID
  const taskPatterns = [
    'create an express',
    'scaffold express',
    'build express',
    'setup express',
    'scaffold api',
    'create a rest api',
    'create a todo app',
    'create todo app',
    'scaffold a project',
  ];
  if (taskPatterns.some((p) => t.includes(p))) {
    return RESPONSE_MODES.HYBRID;
  }

  // 2. Code + Explanation Combination -> HYBRID
  const hasCodeIntent =
    /\b(code|program|script|implementation|function|algorithm|class|sql|query|endpoint)\b/i.test(t);
  const hasExplanationIntent =
    /\b(explain|why|how|concept|overview|walkthrough|describe|recommend|comparison)\b/i.test(t);

  if (hasCodeIntent && hasExplanationIntent) {
    return RESPONSE_MODES.HYBRID;
  }

  // 3. Comparison with recommendation -> HYBRID
  if (
    /\b(compare|versus|vs)\b/i.test(t) &&
    /\b(recommend|which is better|pros and cons|choose)\b/i.test(t)
  ) {
    return RESPONSE_MODES.HYBRID;
  }

  // 4. Code Generation -> TEXT
  const pureCodePatterns = [
    /\b(write|create|give me|generate|show me)\b.*\b(code|program|function|implementation|script|class|sql)\b/i,
    /\b(binary search|prime number|reverse a string|quicksort|mergesort|linked list|fibonacci)\b.*\b(in\s+(python|c\+\+|cpp|javascript|typescript|java|go|rust))\b/i,
    /\b(in\s+(python|c\+\+|cpp|javascript|typescript|java|go|rust))\b.*\b(implementation|code|program)\b/i,
  ];
  if (pureCodePatterns.some((rgx) => rgx.test(t))) {
    return RESPONSE_MODES.TEXT;
  }

  // 5. Tables & Structured Data -> TEXT
  if (/\b(table|comparison table|matrix|chart|grid)\b/i.test(t)) {
    return RESPONSE_MODES.TEXT;
  }

  // 6. JSON / YAML / Configuration -> TEXT
  if (/\b(json|yaml|config|configuration|schema|manifest)\b/i.test(t)) {
    return RESPONSE_MODES.TEXT;
  }

  // 7. Large Lists / Multi-step Documentation -> TEXT
  if (
    /\b(10|5|list of|interview questions|steps to|guide to|documentation for)\b/i.test(t) &&
    !/\b(brief|quick|short)\b/i.test(t)
  ) {
    return RESPONSE_MODES.TEXT;
  }

  // 8. Follow-up intent resolution based on context
  if (history && history.length > 0) {
    const _recentUserTurns = history.filter((h) => h.role === 'user').slice(-2);
    if (
      /\b(now give me the code|now implement|give me the implementation|show the code)\b/i.test(t)
    ) {
      return RESPONSE_MODES.TEXT;
    }
    if (/\b(why does this work|why\?|why does the middle element matter)\b/i.test(t)) {
      return RESPONSE_MODES.VOICE;
    }
  }

  // 9. Short, conversational, or conceptual questions -> VOICE
  const voiceQuestions = [
    /^(what is|what's|who is|who's|where is|where's|when did|when was)\b/i,
    /^(is it|is this|are you|can you|could you|do you)\b/i,
    /\b(capital of|definition of|what is recursion|what is polymorphism|quick definition)\b/i,
    /\b(briefly|short explanation|in one sentence|in simple terms)\b/i,
    /^(hello|hi|hey|good morning|thanks|thank you)\b/i,
  ];
  if (voiceQuestions.some((rgx) => rgx.test(t))) {
    return RESPONSE_MODES.VOICE;
  }

  // Default to VOICE for conversational assistance
  return RESPONSE_MODES.VOICE;
}

/**
 * Unwraps nested or stringified JSON from object fields (e.g. if content or visualResponse
 * is itself a stringified JSON string).
 */
export function unwrapNestedJson(obj) {
  if (!obj || typeof obj !== 'object') return obj;

  // 1. If visualResponse is a stringified JSON string
  if (typeof obj.visualResponse === 'string' && obj.visualResponse.trim().startsWith('{')) {
    try {
      const inner = JSON.parse(obj.visualResponse);
      if (inner && typeof inner === 'object') obj.visualResponse = inner;
    } catch (_) {
      const extracted = safeParseOrExtract(obj.visualResponse);
      if (extracted) obj.visualResponse = extracted;
    }
  }

  // 2. If content or visualResponse.content is stringified JSON containing structured keys
  const targetContent = obj.content || obj.visualResponse?.content;
  if (typeof targetContent === 'string') {
    const trimmed = targetContent.trim();
    if (
      trimmed.startsWith('{') &&
      (trimmed.includes('"spoken"') ||
        trimmed.includes('"content"') ||
        trimmed.includes('"type"') ||
        trimmed.includes('"visualResponse"') ||
        trimmed.includes('"responseMode"'))
    ) {
      const parsedInner = safeParseOrExtract(trimmed);
      if (parsedInner && typeof parsedInner === 'object') {
        if (parsedInner.spoken && !obj.spoken) obj.spoken = parsedInner.spoken;
        if (parsedInner.spokenResponse && !obj.spokenResponse)
          obj.spokenResponse = parsedInner.spokenResponse;
        if (parsedInner.responseMode && !obj.responseMode)
          obj.responseMode = parsedInner.responseMode;

        const innerType = parsedInner.visualResponse?.type || parsedInner.type;
        const innerLang = parsedInner.visualResponse?.language || parsedInner.language;
        const innerTitle = parsedInner.visualResponse?.title || parsedInner.title;
        const innerContent =
          parsedInner.visualResponse?.content || parsedInner.content || parsedInner.text;

        if (obj.visualResponse && typeof obj.visualResponse === 'object') {
          if (innerType) obj.visualResponse.type = innerType;
          if (innerLang) obj.visualResponse.language = innerLang;
          if (innerTitle) obj.visualResponse.title = innerTitle;
          if (innerContent) obj.visualResponse.content = innerContent;
        } else {
          obj.content = innerContent || obj.content;
          if (innerType) obj.type = innerType;
          if (innerLang) obj.language = innerLang;
          if (innerTitle) obj.title = innerTitle;
        }
      }
    }
  }

  return obj;
}

/**
 * Robust extractor for structured responses from LLM output.
 * Handles standard JSON, escaped JSON, unescaped code newlines,
 * unescaped quotes within code strings, markdown fences, and regex fallbacks.
 */
export function safeParseOrExtract(rawText) {
  if (!rawText) return null;
  if (typeof rawText === 'object') return unwrapNestedJson(rawText);
  if (typeof rawText !== 'string') return null;

  let clean = rawText.trim();
  // Strip outer markdown code blocks if present
  if (clean.startsWith('```json')) clean = clean.slice(7);
  else if (clean.startsWith('```')) clean = clean.slice(3);
  if (clean.endsWith('```')) clean = clean.slice(0, -3);
  clean = clean.trim();

  const looksLikeJson =
    clean.startsWith('{') &&
    (clean.includes('"spoken"') ||
      clean.includes('"spokenResponse"') ||
      clean.includes('"visualResponse"') ||
      clean.includes('"content"') ||
      clean.includes('"type"') ||
      clean.includes('"responseMode"'));

  if (!looksLikeJson && !clean.startsWith('{')) {
    return null;
  }

  // Attempt 1: Native JSON.parse
  try {
    const parsed = JSON.parse(clean);
    if (parsed && typeof parsed === 'object') {
      return unwrapNestedJson(parsed);
    }
  } catch (_) {}

  // Attempt 2: Repair unescaped newlines/tabs inside string literals
  try {
    const repaired = clean.replace(/:\s*"([\s\S]*?)"(?=\s*[,}])/g, (_match, p1) => {
      const escaped = p1
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
      return `: "${escaped}"`;
    });
    const parsed = JSON.parse(repaired);
    if (parsed && typeof parsed === 'object') {
      return unwrapNestedJson(parsed);
    }
  } catch (_) {}

  // Attempt 3: Robust Regex Field Extraction
  const result = {};

  // Extract responseMode
  const modeMatch = clean.match(/"responseMode"\s*:\s*"([A-Za-z]+)"/i);
  if (modeMatch) result.responseMode = modeMatch[1].toUpperCase();

  // Extract type
  const typeMatch = clean.match(/"type"\s*:\s*"([A-Za-z]+)"/i);
  if (typeMatch) result.type = typeMatch[1].toLowerCase();

  // Extract language
  const langMatch = clean.match(/"language"\s*:\s*"([A-Za-z0-9_+-]+)"/i);
  if (langMatch) result.language = langMatch[1].toLowerCase();

  // Extract title
  const titleMatch = clean.match(/"title"\s*:\s*"([^"\r\n]+)"/i);
  if (titleMatch) result.title = titleMatch[1];

  // Extract spoken / spokenResponse
  const spokenMatch = clean.match(/"(?:spokenResponse|spoken)"\s*:\s*"((?:[^"\\]|\\.)*)"/i);
  if (spokenMatch) {
    result.spoken = spokenMatch[1].replace(/\\"/g, '"').replace(/\\n/g, ' ');
    result.spokenResponse = result.spoken;
  }

  // Extract content: find where "content": " begins and find the last matching quote before closing brace
  const contentStartMatch = clean.match(/"content"\s*:\s*"/);
  if (contentStartMatch) {
    const startIndex = contentStartMatch.index + contentStartMatch[0].length;
    const lastBrace = clean.lastIndexOf('}');
    const endSearchIndex = lastBrace !== -1 ? lastBrace : clean.length;
    const lastQuote = clean.lastIndexOf('"', endSearchIndex - 1);
    if (lastQuote > startIndex) {
      let content = clean.slice(startIndex, lastQuote);
      content = content
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
      result.content = content;
    }
  }

  if (result.content || result.spoken || result.type || result.responseMode) {
    return unwrapNestedJson(result);
  }

  return null;
}

/**
 * Validates, corrects, and enforces the structured response contract:
 * {
 *   responseMode: 'VOICE' | 'TEXT' | 'HYBRID',
 *   spokenResponse: string,
 *   visualResponse: { type, language, title, content }
 * }
 *
 * Ensures model hallucinations, unescaped raw JSON, or misclassifications
 * are deterministically normalized and corrected before reaching Rime TTS or the workspace.
 */
export function validateAndEnforceContract(
  rawObj,
  userText = '',
  history = [],
  userOverride = null
) {
  const fallbackMode = deterministicClassify(userText, history);

  // 1. Basic parsing safety & string unwrapping
  let obj = rawObj;
  if (typeof rawObj === 'string') {
    const extracted = safeParseOrExtract(rawObj);
    if (extracted) {
      obj = extracted;
    } else {
      obj = {
        responseMode: fallbackMode,
        spokenResponse: rawObj,
        visualResponse: null,
      };
    }
  } else if (obj && typeof obj === 'object') {
    obj = unwrapNestedJson(obj);
  } else {
    obj = {
      responseMode: fallbackMode,
      spokenResponse: '',
      visualResponse: null,
    };
  }

  // 2. Validate responseMode
  let mode = String(obj.responseMode || '')
    .toUpperCase()
    .trim();
  if (![RESPONSE_MODES.VOICE, RESPONSE_MODES.TEXT, RESPONSE_MODES.HYBRID].includes(mode)) {
    mode = fallbackMode;
  }

  // Apply user override if explicitly set and valid
  if (
    userOverride &&
    [RESPONSE_MODES.VOICE, RESPONSE_MODES.TEXT].includes(userOverride.toUpperCase())
  ) {
    mode = userOverride.toUpperCase();
  }

  // 3. Extract spoken response
  let spoken = String(obj.spokenResponse || obj.spoken || '').trim();

  // 4. Extract visual response
  let visual = obj.visualResponse;
  if (!visual || typeof visual !== 'object') {
    visual = {
      type: obj.visualType || obj.type || (mode === RESPONSE_MODES.VOICE ? 'text' : 'markdown'),
      language: obj.language || null,
      title: obj.title || null,
      content: obj.content || obj.text || null,
    };
  }

  // Normalize visual fields
  let visualContent = visual.content != null ? String(visual.content).trim() : '';

  // Safeguard: Check if visualContent itself is stringified JSON!
  if (
    visualContent.startsWith('{') &&
    (visualContent.includes('"spoken"') ||
      visualContent.includes('"content"') ||
      visualContent.includes('"type"') ||
      visualContent.includes('"visualResponse"'))
  ) {
    const unnested = safeParseOrExtract(visualContent);
    if (unnested) {
      if (unnested.spoken && !spoken) spoken = unnested.spoken;
      if (unnested.visualResponse?.content) visualContent = unnested.visualResponse.content;
      else if (unnested.content) visualContent = unnested.content;

      const unnestedType = unnested.visualResponse?.type || unnested.type;
      const unnestedLang = unnested.visualResponse?.language || unnested.language;
      const unnestedTitle = unnested.visualResponse?.title || unnested.title;

      if (unnestedType) visual.type = unnestedType;
      if (unnestedLang) visual.language = unnestedLang;
      if (unnestedTitle) visual.title = unnestedTitle;
    }
  }

  let visualType = ['text', 'code', 'table', 'markdown', 'task'].includes(visual.type)
    ? visual.type
    : containsStructuredContent(visualContent)
      ? 'markdown'
      : 'text';
  let visualLanguage =
    visualType === 'code' && visual.language ? String(visual.language).toLowerCase().trim() : null;
  let visualTitle = visual.title ? String(visual.title).trim() : null;

  // Safeguard: If visualContent contains markdown code fences, strip them for clean code rendering
  if (visualType === 'code' && visualContent) {
    const fenceMatch = visualContent.match(/^```([a-zA-Z0-9_-]*)\n([\s\S]*?)```$/);
    if (fenceMatch) {
      if (!visualLanguage && fenceMatch[1]) visualLanguage = fenceMatch[1].toLowerCase().trim();
      visualContent = fenceMatch[2].trim();
    }
  }

  // 5. Deterministic Safety Corrections:
  // Rule A1: If visual content is a rich artifact (code block, table, extensive list),
  // but the model incorrectly classified it as VOICE -> Force TEXT or HYBRID!
  const hasRichVisualContent =
    visualType === 'code' ||
    visualType === 'table' ||
    visualType === 'task' ||
    containsStructuredContent(visualContent) ||
    visualContent.length > 350;

  if (mode === RESPONSE_MODES.VOICE && hasRichVisualContent) {
    const wantsExplanation = /\b(explain|how|why|describe|walkthrough)\b/i.test(userText);
    mode = wantsExplanation ? RESPONSE_MODES.HYBRID : RESPONSE_MODES.TEXT;
  }

  // Rule A2: If the model classified as TEXT, but there is NO rich visual content
  // (no code, no table, no structured list, short plain text) and user did not override -> Correct to VOICE!
  const explicitlyWantsText =
    /\b(in (the )?workspace|written|show me code|write code|table|json|yaml|schema)\b/i.test(
      userText
    );
  if (
    mode === RESPONSE_MODES.TEXT &&
    !hasRichVisualContent &&
    !userOverride &&
    !explicitlyWantsText
  ) {
    mode = RESPONSE_MODES.VOICE;
    if (
      !spoken ||
      spoken.toLowerCase().includes('workspace') ||
      spoken.toLowerCase().includes('chat')
    ) {
      spoken = visualContent;
    }
  }

  // Rule B: If spoken response contains raw code, table pipes, JSON braces, or markdown syntax,
  // sanitize it immediately so Rime never speaks raw syntax!
  if (containsStructuredContent(spoken) || spoken.trim().startsWith('{')) {
    if (mode === RESPONSE_MODES.TEXT) {
      const itemDesc =
        visualType === 'code'
          ? visualTitle || 'code'
          : visualType === 'table'
            ? 'comparison table'
            : 'response';
      spoken = `Done. I've placed the ${itemDesc} in the workspace.`;
    } else if (mode === RESPONSE_MODES.HYBRID) {
      spoken =
        "I've summarized the key concept, and placed the full implementation in the workspace.";
    } else {
      // In voice mode with code syntax, move the code into visualResponse and make spoken clean
      if (!visualContent) {
        visualContent = spoken;
        visualType = 'code';
      }
      mode = RESPONSE_MODES.TEXT;
      spoken = "I've placed the code implementation in the workspace.";
    }
  }

  // Rule C: In TEXT mode, Rime should receive ONLY a short acknowledgement.
  if (mode === RESPONSE_MODES.TEXT) {
    if (
      !spoken ||
      spoken.length > 120 ||
      (!spoken.toLowerCase().includes('workspace') && !spoken.toLowerCase().includes('chat'))
    ) {
      const itemDesc =
        visualType === 'code'
          ? visualTitle || 'code implementation'
          : visualType === 'table'
            ? 'comparison table'
            : 'response';
      spoken = `Done. I've placed the ${itemDesc} in the workspace.`;
    }
  }

  // Rule D: In HYBRID mode, ensure both a concise spoken summary and a rich visual artifact exist.
  if (mode === RESPONSE_MODES.HYBRID) {
    if (!visualContent && spoken) {
      visualContent = spoken;
      visualType = 'markdown';
    }
    if (!spoken || spoken.length > 200) {
      spoken = "I've provided a summary, and added the full details to the workspace.";
    }
  }

  // Rule E: In VOICE mode, visualResponse holds the transcript representation
  if (mode === RESPONSE_MODES.VOICE) {
    if (!visualContent && spoken) {
      visualContent = spoken;
      visualType = 'text';
    }
  }

  // 6. Enforce Spoken Word Budget
  const budgetedSpoken = enforceSpokenBudget(spoken, mode);

  // 7. Assemble validated structured contract
  const finalVisualResponse = {
    type: visualType,
    language: visualLanguage,
    title: visualTitle,
    content: visualContent || budgetedSpoken,
  };

  return {
    responseMode: mode,
    spokenResponse: budgetedSpoken,
    visualResponse: finalVisualResponse,
    visual: finalVisualResponse,

    // Backward compatibility properties for existing clients & test harnesses
    text: finalVisualResponse.content,
    spoken: budgetedSpoken,
    type: finalVisualResponse.type,
    visualType: finalVisualResponse.type,
    language: finalVisualResponse.language,
    title: finalVisualResponse.title,
    content: finalVisualResponse.content,
  };
}
