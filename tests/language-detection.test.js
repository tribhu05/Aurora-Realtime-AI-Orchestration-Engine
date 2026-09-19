/**
 * @file tests/language-detection.test.js
 * Comprehensive automated test suite for dynamic multilingual detection,
 * Hinglish/English/Hindi prompt construction, fallback fidelity, and context inheritance.
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

test('Language Detection - Roman Hindi & Hinglish queries', () => {
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
    assert.equal(lang, 'hinglish', `Expected 'hinglish' for query: "${query}", got: "${lang}"`);
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
  // Turn 1: Hinglish
  const historyHinglish = [
    { role: 'user', content: 'API kaise kaam karti hai?' },
    {
      role: 'assistant',
      content: 'API basically do applications ke beech communication ka kaam karti hai.',
    },
  ];
  // Short follow-up inheriting Hinglish
  assert.equal(detectLanguage('haan', historyHinglish), 'hinglish');
  assert.equal(detectLanguage('theek hai', historyHinglish), 'hinglish');
  assert.equal(detectLanguage('continue', historyHinglish), 'hinglish');

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
  const historyHinglish = [
    { role: 'user', content: 'API kaise kaam karti hai?' },
    {
      role: 'assistant',
      content: 'API basically do applications ke beech communication ka kaam karti hai.',
    },
  ];

  // User explicitly asks to switch to English
  assert.equal(detectLanguage('Now explain it in English.', historyHinglish), 'en');
  assert.equal(detectLanguage('Speak in English please', historyHinglish), 'en');

  const historyEnglish = [
    { role: 'user', content: 'Can you explain how APIs work?' },
    { role: 'assistant', content: 'An API allows applications to communicate.' },
  ];

  // User explicitly asks to switch to Hinglish or Hindi
  assert.equal(detectLanguage('Now explain in Hinglish', historyEnglish), 'hinglish');
  assert.equal(detectLanguage('Explain in Hindi please', historyEnglish), 'hi');
});

test('Dynamic LLM Prompting - buildLanguageInstruction', () => {
  const hinglishPrompt = buildLanguageInstruction('hinglish');
  assert.match(hinglishPrompt, /LANGUAGE REQUIREMENT: HINGLISH/);
  assert.match(hinglishPrompt, /Roman\/Latin script/i);
  assert.match(hinglishPrompt, /Do NOT translate technical terms into formal Hindi/i);
  assert.match(hinglishPrompt, /API basically do applications ke beech communication/);

  const englishPrompt = buildLanguageInstruction('en');
  assert.match(englishPrompt, /LANGUAGE REQUIREMENT: ENGLISH/);
  assert.match(englishPrompt, /clear, crisp, natural fluent English/);

  const hindiPrompt = buildLanguageInstruction('hi');
  assert.match(hindiPrompt, /LANGUAGE REQUIREMENT: HINDI/);
  assert.match(hindiPrompt, /Devanagari script/);
});

test('Local Fallback - Fluent Hinglish Spoken Verbal Response for API query', () => {
  const messages = [{ role: 'user', content: 'API kaise kaam karti hai?' }];
  const reply = localFallbackReply(messages);

  assert.equal(reply.responseMode, 'HYBRID');
  assert.equal(
    reply.spokenResponse,
    'API basically do applications ke beech communication ka kaam karti hai. Ek application request bhejti hai aur doosri application uska response provide karti hai.'
  );
  assert.match(reply.visualResponse.content, /API \(Application Programming Interface\)/);
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

test('Local Fallback - Fluent Hinglish Spoken Verbal Response for conversational greeting', () => {
  const messages = [{ role: 'user', content: 'Namaste, kaise ho?' }];
  const reply = localFallbackReply(messages);

  assert.equal(reply.responseMode, 'VOICE');
  assert.equal(
    reply.spokenResponse,
    'Main bilkul badhiya hoon! Aap bataiye, aaj kya madad karoon?'
  );
});

test('Task Scaffolding - Hinglish trigger detection and announcements', async () => {
  assert.equal(isTaskRequest('api bana do'), true);
  assert.equal(isTaskRequest('ek express api banao'), true);
  assert.equal(isTaskRequest('project bana do'), true);

  const steps = [];
  const res = await executeScaffoldTask({
    prompt: 'express api bana do',
    onProgress: (p) => steps.push(p),
  });

  assert.equal(res.success, true);
  assert.match(res.initialSpoken, /Express.*REST API.*scaffold/);
  assert.match(res.completionSpoken, /Express.*project ready hai/);
  assert.match(res.artifacts[0].content, /express/);
});

test('Contract Enforcement - returns detectedLanguage tag in normalized contract', () => {
  const contract = validateAndEnforceContract(
    {
      responseMode: 'VOICE',
      spokenResponse: 'Main aapki madad ke liye taiyar hoon.',
      visualResponse: { type: 'text', content: 'Main ready hoon.' },
    },
    'mujhe batao ki ye kaise kaam karta hai'
  );

  assert.equal(contract.detectedLanguage, 'hinglish');
});
