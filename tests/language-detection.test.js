/**
 * @file tests/language-detection.test.js
 * Comprehensive automated test suite for English default language handling
 * and Hindi (Devanagari) detection, with Hinglish removed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { detectLanguage, validateAndEnforceContract } from '../server/response-router.js';
import { buildLanguageInstruction, localFallbackReply } from '../server/llm.js';
import { isTaskRequest, executeScaffoldTask } from '../server/tasks.js';

test('Language Detection - English queries', () => {
  const englishQueries = [
    'How does an API work?',
    'Explain HTTP protocols in detail.',
    'Write a binary search function in C++',
    'My Node.js server is not starting. How can I fix it?',
    'What is the difference between SQL and NoSQL databases?',
  ];

  for (const query of englishQueries) {
    const lang = detectLanguage(query);
    assert.equal(lang, 'en', `Expected 'en' for query: "${query}", got: "${lang}"`);
  }
});

test('Language Detection - Hinglish queries detect hinglish', () => {
  const hinglishQueries = [
    'API kaise kaam karti hai?',
    'API kya hoti hai?',
    'mujhe batao ki database kya hota hai',
    'ye code kaise work kar raha hai?',
    'Mera Node.js server start nahi ho raha, isko kaise fix karu?',
    'Can you bata sakte ho why my server is crashing?',
    'bhai ye function kaam nahi kar raha',
    'ek express api bana do',
  ];

  for (const query of hinglishQueries) {
    const lang = detectLanguage(query);
    assert.equal(
      lang,
      'hinglish',
      `Expected 'hinglish' for Hinglish query: "${query}", got: "${lang}"`
    );
  }
});

test('Language Detection - Devanagari Hindi queries', () => {
  const hindiQueries = [
    'मुझे समझाइए कि एपीआई क्या होती है।',
    'नमस्ते, आप कैसे हैं?',
    'पायथन में लूप कैसे चलाते हैं?',
  ];

  for (const query of hindiQueries) {
    const lang = detectLanguage(query);
    assert.equal(lang, 'hi', `Expected 'hi' for query: "${query}", got: "${lang}"`);
  }
});

test('Language Detection - Conversational context inheritance', () => {
  // Turn 1: Devanagari Hindi
  const historyHindi = [
    { role: 'user', content: 'एपीआई कैसे काम करती है?' },
    {
      role: 'assistant',
      content: 'एपीआई दो सिस्टम्स के बीच संचार कराती है।',
    },
  ];
  // Short Devanagari follow-up inheriting Hindi
  assert.equal(detectLanguage('हाँ', historyHindi), 'hi');
  assert.equal(detectLanguage('ठीक है', historyHindi), 'hi');

  // Turn 1: English
  const historyEnglish = [
    { role: 'user', content: 'Can you explain how APIs work?' },
    { role: 'assistant', content: 'An API allows applications to communicate.' },
  ];
  // Short follow-up inheriting English
  assert.equal(detectLanguage('okay', historyEnglish), 'en');
  assert.equal(detectLanguage('yes', historyEnglish), 'en');
});

test('Language Detection - Explicit language switches', () => {
  const historyHindi = [
    { role: 'user', content: 'एपीआई कैसे काम करती है?' },
    {
      role: 'assistant',
      content: 'एपीआई दो सिस्टम्स के बीच संचार कराती है।',
    },
  ];

  // User explicitly asks to switch to English
  assert.equal(detectLanguage('Now explain it in English.', historyHindi), 'en');
  assert.equal(detectLanguage('Speak in English please', historyHindi), 'en');

  const historyEnglish = [
    { role: 'user', content: 'Can you explain how APIs work?' },
    { role: 'assistant', content: 'An API allows applications to communicate.' },
  ];

  // User explicitly asks to switch to Hindi
  assert.equal(detectLanguage('Explain in Hindi please', historyEnglish), 'hi');
  assert.equal(detectLanguage('Ab Hindi mein batao', historyEnglish), 'hi');

  // User explicitly asks to switch to Hinglish
  assert.equal(detectLanguage('Hinglish mein batao', historyEnglish), 'hinglish');
  assert.equal(detectLanguage('Explain in Hinglish please', historyEnglish), 'hinglish');
});

test('Dynamic LLM Prompting - buildLanguageInstruction handles English, Hindi, and Hinglish', () => {
  const englishPrompt = buildLanguageInstruction('en');
  assert.match(englishPrompt, /LANGUAGE REQUIREMENT: ENGLISH/);
  assert.match(englishPrompt, /clear, crisp, natural fluent English/);

  const fallbackPrompt = buildLanguageInstruction('other');
  assert.match(fallbackPrompt, /LANGUAGE REQUIREMENT: ENGLISH/);

  const hindiPrompt = buildLanguageInstruction('hi');
  assert.match(hindiPrompt, /LANGUAGE REQUIREMENT: HINDI/);
  assert.match(hindiPrompt, /Devanagari script/);

  const hinglishPrompt = buildLanguageInstruction('hinglish');
  assert.match(hinglishPrompt, /LANGUAGE REQUIREMENT: HINGLISH/);
  assert.match(hinglishPrompt, /Roman\/Latin script only/i);
});

test('Local Fallback - English Spoken Verbal Response for API query', () => {
  const messages = [{ role: 'user', content: 'Can you explain how APIs work?' }];
  const reply = localFallbackReply(messages);

  assert.equal(reply.responseMode, 'HYBRID');
  assert.equal(
    reply.spokenResponse,
    'An API allows two applications to communicate and exchange data with structured requests and responses.'
  );
});

test('Local Fallback - English greeting default', () => {
  const messages = [{ role: 'user', content: 'Hello, how are you?' }];
  const reply = localFallbackReply(messages);

  assert.equal(reply.responseMode, 'VOICE');
  assert.match(reply.spokenResponse, /I'm doing great, thank you!/);
});

test('Task Scaffolding - English announcements by default', async () => {
  assert.equal(isTaskRequest('scaffold api'), true);
  assert.equal(isTaskRequest('create an express rest api'), true);

  const steps = [];
  const res = await executeScaffoldTask({
    prompt: 'create an express rest api',
    onProgress: (p) => steps.push(p),
  });

  assert.equal(res.success, true);
  assert.match(res.initialSpoken, /Starting the Express.*REST API/);
  assert.match(res.completionSpoken, /Your Express.*project is ready/);
  assert.match(res.artifacts[0].content, /express/);
});

test('Contract Enforcement - returns en for English, hi for Devanagari, and hinglish for Roman Hindi', () => {
  const contractEn = validateAndEnforceContract(
    {
      responseMode: 'VOICE',
      spokenResponse: 'I am ready to help you.',
      visualResponse: { type: 'text', content: 'Ready.' },
    },
    'tell me how this works'
  );
  assert.equal(contractEn.detectedLanguage, 'en');

  const contractHi = validateAndEnforceContract(
    {
      responseMode: 'VOICE',
      spokenResponse: 'मैं आपकी मदद के लिए तैयार हूँ।',
      visualResponse: { type: 'text', content: 'तैयार हूँ।' },
    },
    'मुझे बताओ कि यह कैसे काम करता है'
  );
  assert.equal(contractHi.detectedLanguage, 'hi');

  const contractHinglish = validateAndEnforceContract(
    {
      responseMode: 'VOICE',
      spokenResponse: 'Main aapki help ke liye ready hoon.',
      visualResponse: { type: 'text', content: 'Ready.' },
    },
    'mujhe batao ye kaise kaam karta hai'
  );
  assert.equal(contractHinglish.detectedLanguage, 'hinglish');
});
