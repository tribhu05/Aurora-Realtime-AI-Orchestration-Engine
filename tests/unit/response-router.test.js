// tests/unit/response-router.test.js
// Unit tests for Aurora's Intelligent Response Router, guardrails, and contract enforcement.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RESPONSE_MODES,
  SPOKEN_BUDGETS,
  containsStructuredContent,
  enforceSpokenBudget,
  deterministicClassify,
  safeParseOrExtract,
  unwrapNestedJson,
  validateAndEnforceContract,
} from '../../server/response-router.js';

test('Response Router - containsStructuredContent detector', () => {
  // Python code
  assert.equal(containsStructuredContent('def is_prime(n):\n    return True'), true);
  // C++ code
  assert.equal(containsStructuredContent('#include <iostream>\nint main() { return 0; }'), true);
  // JavaScript code
  assert.equal(containsStructuredContent('const sum = (a, b) => a + b;'), true);
  // Markdown table
  assert.equal(containsStructuredContent('| Name | Speed |\n|---|---|\n| C++ | Fast |'), true);
  // JSON payload
  assert.equal(containsStructuredContent('{"type": "code", "language": "cpp"}'), true);
  // Multi-line list (3+ items)
  assert.equal(containsStructuredContent('\n- item 1\n- item 2\n- item 3'), true);
  // Markdown headers
  assert.equal(containsStructuredContent('### Algorithm Overview\nHere is how it works.'), true);
  // Conversational text should NOT trigger detector
  assert.equal(containsStructuredContent('Paris is the capital of France.'), false);
  assert.equal(
    containsStructuredContent('Binary search works by repeatedly halving the search interval.'),
    false
  );
});

test('Response Router - enforceSpokenBudget trimming', () => {
  const longSpeech =
    'First sentence is short. Second sentence explains the details thoroughly. Third sentence exceeds our word limits substantially.';

  // TEXT budget: max 20 words
  const textBudgeted = enforceSpokenBudget(longSpeech, 'TEXT');
  const textWords = textBudgeted.split(/\s+/).length;
  assert.ok(
    textWords <= SPOKEN_BUDGETS.TEXT,
    `TEXT budget exceeded: ${textWords} > ${SPOKEN_BUDGETS.TEXT}`
  );
  assert.match(textBudgeted, /[.!?]$/, 'Budgeted text ends with punctuation');

  // VOICE budget: max 35 words
  const voiceBudgeted = enforceSpokenBudget(longSpeech, 'VOICE');
  const voiceWords = voiceBudgeted.split(/\s+/).length;
  assert.ok(
    voiceWords <= SPOKEN_BUDGETS.VOICE,
    `VOICE budget exceeded: ${voiceWords} > ${SPOKEN_BUDGETS.VOICE}`
  );

  // Strips code fences and backticks from speech
  const dirtySpeech = 'Check `code` in ```def foo(): pass``` right now.';
  const cleaned = enforceSpokenBudget(dirtySpeech, 'VOICE');
  assert.equal(cleaned.includes('`'), false, 'Backticks stripped from speech');
  assert.equal(cleaned.includes('```'), false, 'Fences stripped from speech');

  // Empty string handling
  const emptyResult = enforceSpokenBudget('', 'TEXT');
  assert.ok(emptyResult.includes('workspace'), 'Fallback directs user to workspace');
});

test('Response Router - deterministicClassify intent routing', () => {
  // Scaffolding intent -> HYBRID
  assert.equal(
    deterministicClassify('Create an Express REST API in JavaScript'),
    RESPONSE_MODES.HYBRID
  );
  assert.equal(deterministicClassify('Scaffold Express Todo App'), RESPONSE_MODES.HYBRID);

  // Pure code requests -> TEXT
  assert.equal(deterministicClassify('Write a binary search function in C++'), RESPONSE_MODES.TEXT);
  assert.equal(
    deterministicClassify('Write a Python program to check whether a number is prime'),
    RESPONSE_MODES.TEXT
  );
  assert.equal(
    deterministicClassify('Write a C++ program to reverse a string'),
    RESPONSE_MODES.TEXT
  );

  // Table / comparison requests -> TEXT
  assert.equal(deterministicClassify('Compare React and Vue in a table'), RESPONSE_MODES.TEXT);
  assert.equal(deterministicClassify('Compare Python and C++ in a table'), RESPONSE_MODES.TEXT);

  // Explanation + Code -> HYBRID
  assert.equal(
    deterministicClassify('Explain quicksort and write a python implementation'),
    RESPONSE_MODES.HYBRID
  );

  // Conversational questions -> VOICE
  assert.equal(deterministicClassify('What is the capital of Japan?'), RESPONSE_MODES.VOICE);
  assert.equal(deterministicClassify('What is recursion?'), RESPONSE_MODES.VOICE);
  assert.equal(deterministicClassify('Why is a base case required?'), RESPONSE_MODES.VOICE);
  assert.equal(deterministicClassify('Tell me a short joke'), RESPONSE_MODES.VOICE);
});

test('Response Router - safeParseOrExtract robust JSON extraction', () => {
  // Standard JSON
  const validJson = JSON.stringify({
    responseMode: 'VOICE',
    spokenResponse: 'Hello world',
    visualResponse: { type: 'text', content: 'Hello world' },
  });
  const parsedValid = safeParseOrExtract(validJson);
  assert.equal(parsedValid.responseMode, 'VOICE');
  assert.equal(parsedValid.spokenResponse, 'Hello world');

  // Outer markdown fences ```json ... ```
  const fencedJson = `\`\`\`json\n${validJson}\n\`\`\``;
  const parsedFenced = safeParseOrExtract(fencedJson);
  assert.equal(parsedFenced.responseMode, 'VOICE');

  // Unescaped literal newlines in code string
  const unescapedCode = `{
    "responseMode": "TEXT",
    "spokenResponse": "Here is the code in the workspace.",
    "type": "code",
    "language": "python",
    "content": "def add(a, b):
    return a + b"
  }`;
  const parsedUnescaped = safeParseOrExtract(unescapedCode);
  assert.ok(parsedUnescaped, 'Extracted from unescaped newlines');
  assert.equal(parsedUnescaped.type, 'code');
  assert.equal(parsedUnescaped.language, 'python');
  assert.ok(parsedUnescaped.content.includes('def add'), 'Preserved code content');

  // Stringified nested visualResponse
  const stringifiedNested = {
    responseMode: 'TEXT',
    spokenResponse: 'Done.',
    visualResponse: '{"type": "code", "language": "cpp", "content": "#include <iostream>"}',
  };
  const unwrapped = unwrapNestedJson(stringifiedNested);
  assert.equal(typeof unwrapped.visualResponse, 'object');
  assert.equal(unwrapped.visualResponse.language, 'cpp');
});

test('Response Router - validateAndEnforceContract safety rules', () => {
  // Rule A1: Hallucinated VOICE mode when returning code -> escalated to TEXT
  const hallucinatedVoice = {
    responseMode: 'VOICE',
    spokenResponse: 'Here is the binary search code.',
    visualResponse: {
      type: 'code',
      language: 'cpp',
      content: 'int binarySearch() { return 0; }',
    },
  };
  const correctedVoice = validateAndEnforceContract(
    hallucinatedVoice,
    'Write binary search in C++'
  );
  assert.equal(correctedVoice.responseMode, 'TEXT', 'Elevated to TEXT modality');
  assert.equal(
    containsStructuredContent(correctedVoice.spokenResponse),
    false,
    'Spoken channel sanitized'
  );

  // Rule B: Code syntax in spoken channel sanitized immediately
  const rawCodeInSpeech = {
    responseMode: 'TEXT',
    spokenResponse: 'Here is def is_prime(n): return True for you.',
    visualResponse: {
      type: 'code',
      language: 'python',
      content: 'def is_prime(n):\n    return True',
    },
  };
  const sanitizedSpeech = validateAndEnforceContract(
    rawCodeInSpeech,
    'Write prime checker in Python'
  );
  assert.equal(
    containsStructuredContent(sanitizedSpeech.spokenResponse),
    false,
    'Code syntax stripped from speech'
  );
  assert.ok(sanitizedSpeech.spokenResponse.includes('workspace'), 'Directs user to workspace');

  // Rule C: TEXT mode short acknowledgement
  const verboseText = {
    responseMode: 'TEXT',
    spokenResponse:
      'I have carefully reviewed the specification, determined the best pattern, initialized the data structures, and written the complete program in the chat for you.',
    visualResponse: { type: 'code', content: 'code here' },
  };
  const shortText = validateAndEnforceContract(verboseText, 'Write code');
  assert.ok(
    shortText.spokenResponse.split(/\s+/).length <= SPOKEN_BUDGETS.TEXT,
    'Spoken text within TEXT budget'
  );

  // User override
  const overridden = validateAndEnforceContract(
    {
      responseMode: 'VOICE',
      spokenResponse: 'Explanation here',
      visualResponse: { type: 'text', content: 'Text' },
    },
    'What is recursion?',
    [],
    'TEXT'
  );
  assert.equal(overridden.responseMode, 'TEXT', 'Honored user mode override');
});
