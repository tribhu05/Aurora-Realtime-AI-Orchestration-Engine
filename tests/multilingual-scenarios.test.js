// tests/multilingual-scenarios.test.js
// Dedicated test suite verifying multilingual & barge-in scenarios with English as default.

import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { analyzeLanguage } from '../server/response-router.js';
import {
  localFallbackReply,
  buildLanguageInstruction,
  sanitizeMessagesForLlm,
} from '../server/llm.js';
import { createAuroraServer } from '../server/server.js';

test('Scenario 1: English - "How are you?" detects English and generates fluent English response', () => {
  const query = 'How are you?';
  const analysis = analyzeLanguage(query);

  assert.equal(analysis.detectedLanguage, 'en');
  assert.equal(analysis.detectedScript, 'Latin');
  assert.equal(analysis.responseLanguage, 'en');

  const instruction = buildLanguageInstruction(analysis);
  assert.match(instruction, /Current user language: English/);
  assert.match(instruction, /Current script: Latin\/Roman/);
  assert.match(instruction, /Respond naturally in English using Latin script/);

  const reply = localFallbackReply(query);
  assert.equal(reply.detectedLanguage, 'en');
  assert.match(reply.spokenResponse, /I'm doing great|thank you/i);
  assert.doesNotMatch(
    reply.spokenResponse,
    /[\u0900-\u097F]/,
    'English response must contain 0 Devanagari characters'
  );
});

test('Scenario 2: Hindi (Devanagari) - "आप कैसे हो?" detects Hindi and responds in Devanagari script', () => {
  const query = 'आप कैसे हो?';
  const analysis = analyzeLanguage(query);

  assert.equal(analysis.detectedLanguage, 'hi');
  assert.equal(analysis.detectedScript, 'Devanagari');
  assert.equal(analysis.responseLanguage, 'hi');

  const instruction = buildLanguageInstruction(analysis);
  assert.match(instruction, /Current user language: Hindi/);
  assert.match(instruction, /Current script: Devanagari/);
  assert.match(instruction, /Respond naturally in Hindi using Devanagari script/);

  const reply = localFallbackReply(query);
  assert.equal(reply.detectedLanguage, 'hi');
  assert.equal(reply.detectedScript, 'Devanagari');
  assert.match(
    reply.spokenResponse,
    /[\u0900-\u097F]/,
    'Hindi response must be in Devanagari script'
  );
  assert.match(reply.spokenResponse, /मैं बिल्कुल ठीक हूँ|आप कैसे हैं/);
});

test('Scenario 3: Roman query defaults to English (Hinglish removed)', () => {
  const query = 'Aap kaise ho?';
  const analysis = analyzeLanguage(query);

  assert.equal(analysis.detectedLanguage, 'en');
  assert.equal(analysis.detectedScript, 'Latin');
  assert.equal(analysis.responseLanguage, 'en');

  const instruction = buildLanguageInstruction(analysis);
  assert.match(instruction, /Current user language: English/);
  assert.match(instruction, /Current script: Latin\/Roman/);
  assert.match(instruction, /Respond naturally in English using Latin script/);

  const reply = localFallbackReply(query);
  assert.equal(reply.detectedLanguage, 'en');
  assert.equal(reply.detectedScript, 'Latin');
  assert.doesNotMatch(
    reply.spokenResponse,
    /[\u0900-\u097F]/,
    'English response must NOT contain Devanagari characters'
  );
});

test('Scenario 4: Roman DSA query defaults to English with technical terms', () => {
  const query = 'Bhai mujhe DSA samjha de';
  const analysis = analyzeLanguage(query);

  assert.equal(analysis.detectedLanguage, 'en');
  assert.equal(analysis.detectedScript, 'Latin');
  assert.equal(analysis.responseLanguage, 'en');

  const reply = localFallbackReply(query);
  assert.equal(reply.detectedLanguage, 'en');
  assert.doesNotMatch(
    reply.spokenResponse,
    /[\u0900-\u097F]/,
    'English DSA must NOT be in Devanagari script'
  );
  assert.match(
    reply.spokenResponse,
    /DSA|Data Structures/i,
    'Must retain DSA/technical terms in English'
  );
});

test('Scenario 5: Hindi Devanagari DSA Concept - "मुझे DSA समझा दो" responds in Devanagari with technical clarity', () => {
  const query = 'मुझे DSA समझा दो';
  const analysis = analyzeLanguage(query);

  assert.equal(analysis.detectedLanguage, 'hi');
  assert.equal(analysis.detectedScript, 'Devanagari');
  assert.equal(analysis.responseLanguage, 'hi');
  assert.equal(analysis.hasTechnicalTerms, true);

  const reply = localFallbackReply(query);
  assert.equal(reply.detectedLanguage, 'hi');
  assert.equal(reply.detectedScript, 'Devanagari');
  assert.match(reply.spokenResponse, /[\u0900-\u097F]/, 'Must be in Devanagari script');
  assert.match(reply.spokenResponse, /DSA|Data Structures/i, 'Retains technical identifier');
});

test('Scenario 6: Explicit Language Switch - "Ab English mein explain kar" overrides Hindi history', () => {
  const historyHindi = [
    { role: 'user', content: 'मुझे विज्ञान के बारे में बताओ' },
    { role: 'assistant', content: 'विज्ञान प्रकृति और ब्रह्मांड का व्यवस्थित अध्ययन है।' },
  ];

  const switchQuery = 'Ab English mein explain kar';
  const analysis = analyzeLanguage(switchQuery, { messages: historyHindi });

  assert.equal(analysis.isExplicit, true, 'Must identify explicit language switch intent');
  assert.equal(analysis.responseLanguage, 'en', 'Response language must switch to English');
  assert.equal(analysis.detectedScript, 'Latin');

  // Also test switch from English to Hindi
  const historyEnglish = [
    { role: 'user', content: 'Explain APIs to me' },
    { role: 'assistant', content: 'An API allows two software systems to communicate.' },
  ];
  const switchToHindi = 'Ab Hindi mein batao';
  const analysisHindi = analyzeLanguage(switchToHindi, { messages: historyEnglish });
  assert.equal(analysisHindi.isExplicit, true);
  assert.equal(analysisHindi.responseLanguage, 'hi');
});

test('Scenario 7: Barge-in and Speaker Echo Loop Prevention - cleans context and drops echoed audio', async () => {
  // Test 7a: sanitizeMessagesForLlm prevents consecutive user messages from causing loops
  const rawHistoryWithBargeIn = [
    { role: 'user', content: 'मुझे विज्ञान के बारे में बताओ' },
    { role: 'user', content: 'जीव विज्ञान और' },
    { role: 'user', content: 'विज्ञान' },
  ];

  const sanitized = sanitizeMessagesForLlm(rawHistoryWithBargeIn);
  assert.equal(
    sanitized.length,
    5,
    'Must insert cancellation assistant markers between orphan user turns'
  );
  assert.equal(sanitized[1].role, 'assistant');
  assert.match(sanitized[1].content, /Cancelled/);
  assert.equal(sanitized[3].role, 'assistant');
  assert.match(sanitized[3].content, /Cancelled/);

  // Test 7b: WebSocket server rejects echoed assistant phrases
  const server = createAuroraServer({ mock: true, mockAudio: true, quiet: true });
  const { port } = await server.listen(0);
  const ws = new WebSocket(`ws://localhost:${port}`);

  await new Promise((resolve) => ws.on('open', resolve));

  const received = [];
  ws.on('message', (raw) => received.push(JSON.parse(raw.toString())));

  // Turn 1: Normal query
  ws.send(JSON.stringify({ type: 'query', text: 'How does an API work?', timestamp: Date.now() }));

  // Wait for Turn 1 response
  await new Promise((resolve) => {
    const interval = setInterval(() => {
      const aiMsg = received.find((m) => m.type === 'ai_text');
      if (aiMsg) {
        clearInterval(interval);
        resolve();
      }
    }, 20);
  });

  const turn1Ai = received.find((m) => m.type === 'ai_text');
  assert.ok(turn1Ai, 'Must receive Turn 1 ai_text');
  const spokenEcho = turn1Ai.spoken;

  // Turn 2: Client/microphone erroneously feeds Aurora's own spoken text back as input
  ws.send(JSON.stringify({ type: 'query', text: spokenEcho, timestamp: Date.now() }));

  // Brief pause to allow echo rejection
  await new Promise((r) => setTimeout(r, 80));

  // Verify no new ai_text was generated for the echo
  const allAiTexts = received.filter((m) => m.type === 'ai_text');
  assert.equal(
    allAiTexts.length,
    1,
    'Server EchoGuard must drop echoed assistant speech without creating loop'
  );

  ws.close();
  await server.close();
});

test('Scenario 8: Short Messages - "haan", "theek hai", "kyu?", "okay" language resolution', () => {
  const hindiContext = [{ role: 'user', content: 'आप कैसे हो?' }];
  const englishContext = [{ role: 'user', content: 'How are you doing today?' }];

  // Devanagari in Hindi context inherits Hindi Devanagari
  const res1 = analyzeLanguage('हाँ', { messages: hindiContext, previousLang: 'hi' });
  assert.equal(res1.responseLanguage, 'hi');

  const res2 = analyzeLanguage('ठीक है', { messages: hindiContext, previousLang: 'hi' });
  assert.equal(res2.responseLanguage, 'hi');

  // 'okay' in English context inherits English
  const res3 = analyzeLanguage('okay', { messages: englishContext, previousLang: 'en' });
  assert.equal(res3.responseLanguage, 'en');

  // Roman words default to English
  const res4 = analyzeLanguage('why?', { messages: englishContext, previousLang: 'en' });
  assert.equal(res4.responseLanguage, 'en');
});
