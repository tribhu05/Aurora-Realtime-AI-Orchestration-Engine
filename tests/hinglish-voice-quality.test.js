// tests/hinglish-voice-quality.test.js
// Voice Quality & English Default Language Test Suite for Aurora Voice AI.

import test from 'node:test';
import assert from 'node:assert/strict';
import { RIME_SPEAKERS, RIME_MODELS, synthesizeSpeech } from '../server/rime.js';
import { buildLanguageInstruction } from '../server/llm.js';
import { analyzeLanguage } from '../server/response-router.js';

test('Voice Catalog Audit - includes native Hindi and Indian English voices', () => {
  const speakerIds = RIME_SPEAKERS.map((s) => s.id);

  assert.ok(speakerIds.includes('taru'), 'Must include Taru native Hindi voice');
  assert.ok(speakerIds.includes('nadi'), 'Must include Nadi native Hindi female voice');
  assert.ok(speakerIds.includes('hawa'), 'Must include Hawa Indian English code-switching voice');
  assert.ok(speakerIds.includes('hawk'), 'Must include Hawk Indian English mistv3 voice');
  assert.ok(speakerIds.includes('ironwood'), 'Must include Ironwood Indian English voice');

  const taru = RIME_SPEAKERS.find((s) => s.id === 'taru');
  assert.deepEqual(taru.models, ['coda'], 'Taru must use Coda multilingual model');
  assert.equal(taru.nativeLang, 'hi', 'Taru native language must be hi');

  const codaModel = RIME_MODELS.find((m) => m.id === 'coda');
  assert.ok(codaModel, 'Coda model must be registered');
  assert.match(codaModel.description, /Hindi & multilingual/i);
});

test('Pronunciation Controls - English default resolution for Roman queries', async () => {
  const romanTokens = [
    'Bhai',
    'Kya haal hai',
    'Samajh gaya',
    'Samjha deta hoon',
    'Aap kaise ho',
    'Mujhe batao',
    'Ye kaise kaam karta hai',
    'Chalo shuru karte hain',
  ];

  for (const token of romanTokens) {
    const analysis = analyzeLanguage(token);
    assert.equal(
      analysis.responseLanguage,
      'en',
      `Roman token "${token}" must default to English response language`
    );

    // Verify mock audio synthesis succeeds with taru on coda
    const audioBuf = await synthesizeSpeech(token, {
      speaker: 'taru',
      modelId: 'coda',
      lang: 'en',
      mockAudio: true,
    });
    assert.ok(
      audioBuf && audioBuf.byteLength > 0,
      `Audio synthesis for "${token}" must return non-empty buffer`
    );
  }
});

test('Test Phrases - English Default Instruction Guidance', () => {
  const testPhrases = [
    'Hello, how are you today?',
    'Explain binary search with a simple example.',
    'This API accepts requests and returns structured JSON responses.',
    'I understand. What is our next topic?',
    'Explain this concept in more detail please.',
  ];

  for (const phrase of testPhrases) {
    const analysis = analyzeLanguage(phrase);
    assert.equal(analysis.responseLanguage, 'en', `Phrase "${phrase}" must be detected as English`);

    const instruction = buildLanguageInstruction(analysis);
    assert.match(instruction, /Current user language: English/);
    assert.match(instruction, /clear, crisp, natural fluent English/i);
    assert.match(instruction, /LANGUAGE REQUIREMENT: ENGLISH/);
  }
});

test('Dynamic Model & Language Resolution in synthesizeSpeech', async () => {
  // Test 1: Devanagari text on Hindi-capable voice (taru) does NOT return null
  const hindiAudio = await synthesizeSpeech('नमस्ते, आप कैसे हैं?', {
    speaker: 'taru',
    modelId: 'coda',
    lang: 'hi',
    mockAudio: true,
  });
  assert.ok(
    hindiAudio && hindiAudio.byteLength > 0,
    'Hindi-capable voice must synthesize Devanagari'
  );

  // Test 2: Devanagari text on non-Hindi voice (cove on mistv3) falls back (returns null)
  const nonHindiAudio = await synthesizeSpeech('नमस्ते', {
    speaker: 'cove',
    modelId: 'mistv3',
    lang: 'en',
    mockAudio: false,
    apiKey: 'dummy-key',
  });
  assert.equal(
    nonHindiAudio,
    null,
    'Non-Hindi voice must return null on Devanagari for browser fallback'
  );
});
