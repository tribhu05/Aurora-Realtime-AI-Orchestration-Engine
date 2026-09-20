/**
 * @file tests/language-consistency.test.js
 * Validates the 9 core Language Consistency Rules for Aurora Voice AI:
 * 1. Detect language from latest user command.
 * 2. Respond in the same language as user command.
 * 3. Hindi input -> natural Hindi (Devanagari).
 * 4. English input -> crisp English (Latin).
 * 5. Hinglish input -> conversational Hinglish (Roman/Latin).
 * 6. Mixed Hindi-English -> preserves natural balance.
 * 7 & 8. External search results translated and explained in detected language.
 * 9. Explicit directives strictly prioritized ("English mein batao", "Hindi mein batao", "Hinglish mein batao").
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeLanguage } from '../server/response-router.js';
import { buildLanguageInstruction, localFallbackReply } from '../server/llm.js';
import { executeScaffoldTask } from '../server/tasks.js';

test('Rule 1 & 4: English command detected as English and generates English response', () => {
  const query = 'How does an API gateway handle rate limiting?';
  const analysis = analyzeLanguage(query);

  assert.equal(analysis.detectedLanguage, 'en');
  assert.equal(analysis.responseLanguage, 'en');
  assert.equal(analysis.detectedScript, 'Latin');

  const instruction = buildLanguageInstruction(analysis);
  assert.match(instruction, /Current user language: English/);
  assert.match(instruction, /LANGUAGE REQUIREMENT: ENGLISH/);
  assert.match(instruction, /Respond in clear, crisp, natural fluent English/);

  const reply = localFallbackReply(query);
  assert.equal(reply.detectedLanguage, 'en');
  assert.doesNotMatch(
    reply.spokenResponse,
    /[\u0900-\u097F]/,
    'English must not contain Devanagari'
  );
});

test('Rule 1 & 3: Hindi (Devanagari) command detected as Hindi and generates Devanagari response', () => {
  const query = 'मुझे समझाइए कि एपीआई क्या होती है।';
  const analysis = analyzeLanguage(query);

  assert.equal(analysis.detectedLanguage, 'hi');
  assert.equal(analysis.responseLanguage, 'hi');
  assert.equal(analysis.detectedScript, 'Devanagari');

  const instruction = buildLanguageInstruction(analysis);
  assert.match(instruction, /Current user language: Hindi/);
  assert.match(instruction, /LANGUAGE REQUIREMENT: HINDI/);
  assert.match(instruction, /Devanagari script/);

  const reply = localFallbackReply(query);
  assert.equal(reply.detectedLanguage, 'hi');
  assert.match(reply.spokenResponse, /[\u0900-\u097F]/, 'Hindi must contain Devanagari characters');
});

test('Rule 1 & 5: Hinglish command detected as Hinglish and generates Roman script response', () => {
  const query = 'API kaise kaam karti hai? Thoda detail me samjhao.';
  const analysis = analyzeLanguage(query);

  assert.equal(analysis.detectedLanguage, 'hinglish');
  assert.equal(analysis.responseLanguage, 'hinglish');
  assert.equal(analysis.detectedScript, 'Latin');

  const instruction = buildLanguageInstruction(analysis);
  assert.match(instruction, /Current user language: Hinglish/);
  assert.match(instruction, /LANGUAGE REQUIREMENT: HINGLISH/);
  assert.match(instruction, /Roman\/Latin script only/i);

  const reply = localFallbackReply(query);
  assert.equal(reply.detectedLanguage, 'hinglish');
  assert.doesNotMatch(reply.spokenResponse, /[\u0900-\u097F]/, 'Hinglish must be in Roman script');
});

test('Rule 6: Mixed Hindi-English technical query preserves balance and technical identifiers', () => {
  const mixedQueries = [
    'Mera Node.js server start nahi ho raha, isko kaise fix karu?',
    'React components me state management kaise optimize kare?',
    'Bhai recursion ka base case kaise identify karte hain?',
  ];

  for (const q of mixedQueries) {
    const analysis = analyzeLanguage(q);
    assert.equal(analysis.responseLanguage, 'hinglish');
    assert.equal(analysis.detectedScript, 'Latin');
    assert.equal(analysis.isMixed, true, `Query "${q}" should be flagged as mixed`);

    const instruction = buildLanguageInstruction(analysis);
    assert.match(
      instruction,
      /Retain technical, programming, framework, and scientific terms in clean standard English/
    );
    assert.match(instruction, /Preserve the user's natural balance of Hindi and English/);
  }
});

test('Rule 7 & 8: Search translation requirement injected into prompt when researchContext is active', () => {
  // Turn with English search results for a Hindi query
  const hindiAnalysisWithSearch = {
    detectedLanguage: 'hi',
    responseLanguage: 'hi',
    detectedScript: 'Devanagari',
    hasResearchContext: true,
  };
  const hindiSearchPrompt = buildLanguageInstruction(hindiAnalysisWithSearch);
  assert.match(hindiSearchPrompt, /CRITICAL RESEARCH TRANSLATION REQUIREMENT/);
  assert.match(
    hindiSearchPrompt,
    /synthesize and translate all findings entirely into natural Hindi in Devanagari script/
  );
  assert.match(
    hindiSearchPrompt,
    /DO NOT answer in English simply because search results were retrieved in English/
  );

  // Turn with English search results for a Hinglish query
  const hinglishAnalysisWithSearch = {
    detectedLanguage: 'hinglish',
    responseLanguage: 'hinglish',
    detectedScript: 'Latin',
    hasResearchContext: true,
  };
  const hinglishSearchPrompt = buildLanguageInstruction(hinglishAnalysisWithSearch);
  assert.match(hinglishSearchPrompt, /CRITICAL RESEARCH TRANSLATION REQUIREMENT/);
  assert.match(
    hinglishSearchPrompt,
    /synthesize and translate all findings entirely into natural conversational Hinglish in Roman script/
  );
  assert.match(
    hinglishSearchPrompt,
    /DO NOT answer in English simply because search results were retrieved in English/
  );
});

test('Rule 9: Explicit language instructions take absolute precedence', () => {
  const historyHindi = [{ role: 'user', content: 'मुझे डेटाबेस के बारे में बताओ' }];
  const historyEnglish = [{ role: 'user', content: 'Explain databases to me' }];
  const historyHinglish = [{ role: 'user', content: 'Database ke baare me batao' }];

  // 1. "English mein batao" -> English
  const toEn1 = analyzeLanguage('English mein batao', { messages: historyHindi });
  assert.equal(toEn1.isExplicit, true);
  assert.equal(toEn1.responseLanguage, 'en');

  const toEn2 = analyzeLanguage('Ab English me explain kar', { messages: historyHinglish });
  assert.equal(toEn2.isExplicit, true);
  assert.equal(toEn2.responseLanguage, 'en');

  const toEn3 = analyzeLanguage('Can you reply in English please?', { messages: historyHindi });
  assert.equal(toEn3.isExplicit, true);
  assert.equal(toEn3.responseLanguage, 'en');

  // 2. "Hindi mein batao" -> Hindi
  const toHi1 = analyzeLanguage('Hindi mein batao', { messages: historyEnglish });
  assert.equal(toHi1.isExplicit, true);
  assert.equal(toHi1.responseLanguage, 'hi');

  const toHi2 = analyzeLanguage('Ab Hindi me samjhao', { messages: historyHinglish });
  assert.equal(toHi2.isExplicit, true);
  assert.equal(toHi2.responseLanguage, 'hi');

  const toHi3 = analyzeLanguage('Please explain in Hindi', { messages: historyEnglish });
  assert.equal(toHi3.isExplicit, true);
  assert.equal(toHi3.responseLanguage, 'hi');

  // 3. "Hinglish mein batao" -> Hinglish
  const toHing1 = analyzeLanguage('Hinglish mein batao', { messages: historyEnglish });
  assert.equal(toHing1.isExplicit, true);
  assert.equal(toHing1.responseLanguage, 'hinglish');

  const toHing2 = analyzeLanguage('Ab Hinglish me bolo', { messages: historyHindi });
  assert.equal(toHing2.isExplicit, true);
  assert.equal(toHing2.responseLanguage, 'hinglish');

  const toHing3 = analyzeLanguage('Please answer in Hinglish', { messages: historyHindi });
  assert.equal(toHing3.isExplicit, true);
  assert.equal(toHing3.responseLanguage, 'hinglish');
});

test('Task Scaffolding respects detected language for spoken announcements', async () => {
  // 1. English task prompt
  const resEn = await executeScaffoldTask({ prompt: 'create an express rest api' });
  assert.equal(resEn.success, true);
  assert.match(resEn.initialSpoken, /Starting the Express.*REST API/);
  assert.match(resEn.finalSpoken, /Your Express.*project is ready/);

  // 2. Hinglish task prompt
  const resHing = await executeScaffoldTask({ prompt: 'ek express rest api bana do' });
  assert.equal(resHing.success, true);
  assert.match(resHing.initialSpoken, /Maine Express.*project scaffold karna start kar diya hai/);
  assert.match(resHing.finalSpoken, /Aapka Express.*project ready hai/);

  // 3. Hindi task prompt
  const resHi = await executeScaffoldTask({ prompt: 'एक्सप्रेस रेस्ट एपीआई का प्रोजेक्ट बनाओ' });
  assert.equal(resHi.success, true);
  assert.match(resHi.initialSpoken, /मैंने एक्सप्रेस.*प्रोजेक्ट तैयार करना शुरू कर दिया है/);
  assert.match(resHi.finalSpoken, /आपका एक्सप्रेस.*प्रोजेक्ट तैयार है/);
});
