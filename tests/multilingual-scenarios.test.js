// tests/multilingual-scenarios.test.js
// Dedicated test suite verifying the 8 specific multilingual & barge-in scenarios.

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

test('Scenario 3: Hinglish (Roman script) - "Aap kaise ho?" detects Hinglish and responds in Roman script', () => {
  const query = 'Aap kaise ho?';
  const analysis = analyzeLanguage(query);

  assert.equal(analysis.detectedLanguage, 'hinglish');
  assert.equal(analysis.detectedScript, 'Latin');
  assert.equal(analysis.responseLanguage, 'hinglish');

  const instruction = buildLanguageInstruction(analysis);
  assert.match(instruction, /Current user language: Hinglish/);
  assert.match(instruction, /Current script: Latin\/Roman/);
  assert.match(instruction, /Respond naturally in Hinglish using Roman script/);
  assert.match(instruction, /Do NOT convert Hinglish to Devanagari script/);

  const reply = localFallbackReply(query);
  assert.equal(reply.detectedLanguage, 'hinglish');
  assert.equal(reply.detectedScript, 'Latin');
  assert.doesNotMatch(
    reply.spokenResponse,
    /[\u0900-\u097F]/,
    'Hinglish response must NOT contain Devanagari characters'
  );
  assert.match(reply.spokenResponse, /Main ekdum theek hoon|badhiya/i);
});

test('Scenario 4: Hinglish DSA Concept - "Bhai mujhe DSA samjha de" retains English technical terms in Roman script', () => {
  const query = 'Bhai mujhe DSA samjha de';
  const analysis = analyzeLanguage(query);

  assert.equal(analysis.detectedLanguage, 'hinglish');
  assert.equal(analysis.detectedScript, 'Latin');
  assert.equal(analysis.responseLanguage, 'hinglish');
  assert.equal(analysis.hasTechnicalTerms, true);

  const reply = localFallbackReply(query);
  assert.equal(reply.detectedLanguage, 'hinglish');
  assert.doesNotMatch(
    reply.spokenResponse,
    /[\u0900-\u097F]/,
    'Hinglish DSA must NOT be in Devanagari script'
  );
  assert.match(
    reply.spokenResponse,
    /DSA|Data Structures/i,
    'Must retain DSA/technical terms in English'
  );
  assert.match(reply.spokenResponse, /foundation|core|software/i);
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

  // Also test reverse switch: from English to Hinglish
  const historyEnglish = [
    { role: 'user', content: 'Explain APIs to me' },
    { role: 'assistant', content: 'An API allows two software systems to communicate.' },
  ];
  const switchToHinglish = 'Now explain in Hinglish';
  const analysisHinglish = analyzeLanguage(switchToHinglish, { messages: historyEnglish });
  assert.equal(analysisHinglish.isExplicit, true);
  assert.equal(analysisHinglish.responseLanguage, 'hinglish');
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

test('Scenario 8: Short Messages - "haan", "theek hai", "kyu?", "okay" inherit context language', () => {
  const hindiContext = [{ role: 'user', content: 'आप कैसे हो?' }];
  const hinglishContext = [{ role: 'user', content: 'Bhai mujhe DSA samjha de' }];
  const englishContext = [{ role: 'user', content: 'How are you doing today?' }];

  // 'theek hai' in Hindi context inherits Hindi Devanagari or Hinglish
  const res1 = analyzeLanguage('theek hai', { messages: hindiContext, previousLang: 'hi' });
  assert.equal(res1.responseLanguage, 'hi');

  // 'haan' in Hinglish context inherits Hinglish
  const res2 = analyzeLanguage('haan', { messages: hinglishContext, previousLang: 'hinglish' });
  assert.equal(res2.responseLanguage, 'hinglish');

  // 'okay' in English context inherits English
  const res3 = analyzeLanguage('okay', { messages: englishContext, previousLang: 'en' });
  assert.equal(res3.responseLanguage, 'en');

  // 'kyu?' in Hinglish context inherits Hinglish
  const res4 = analyzeLanguage('kyu?', { messages: hinglishContext, previousLang: 'hinglish' });
  assert.equal(res4.responseLanguage, 'hinglish');
});
