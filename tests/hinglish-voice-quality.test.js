// tests/hinglish-voice-quality.test.js
// Voice Quality & Hinglish Pronunciation Test Suite for Aurora Voice AI.

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

test('Pronunciation Controls - Section 3 Hinglish Tokens in mock & configuration', async () => {
  const section3Tokens = [
    'Bhai',
    'Kya haal hai',
    'Samajh gaya',
    'Samjha deta hoon',
    'Aap kaise ho',
    'Mujhe batao',
    'Ye kaise kaam karta hai',
    'Chalo shuru karte hain',
  ];

  for (const token of section3Tokens) {
    const analysis = analyzeLanguage(token);
    assert.equal(
      analysis.responseLanguage,
      'hinglish',
      `Token "${token}" must be recognized as Hinglish`
    );

    // Verify mock audio synthesis succeeds with taru on coda
    const audioBuf = await synthesizeSpeech(token, {
      speaker: 'taru',
      modelId: 'coda',
      lang: 'hi',
      mockAudio: true,
    });
    assert.ok(
      audioBuf && audioBuf.byteLength > 0,
      `Audio synthesis for "${token}" must return non-empty buffer`
    );
  }
});

test('Section 6 Test Phrases - Text Normalization & Cadence Guidance', () => {
  const section6Phrases = [
    'Bhai, kya haal hai? Aaj kya kar rahe ho?',
    'Chalo, binary search ko simple example se samajhte hain.',
    'Ye API request leti hai aur response return karti hai.',
    'Samajh gaya bhai. Ab next topic kya hai?',
    'Mujhe ye concept thoda aur clearly samjha do.',
  ];

  for (const phrase of section6Phrases) {
    const analysis = analyzeLanguage(phrase);
    assert.equal(
      analysis.responseLanguage,
      'hinglish',
      `Phrase "${phrase}" must be detected as Hinglish`
    );

    const instruction = buildLanguageInstruction(analysis);
    assert.match(instruction, /Current user language: Hinglish/);
    assert.match(instruction, /natural Indian conversational rhythm/i);
    assert.match(instruction, /simple way mein samajhte hain/i);
    assert.match(instruction, /Do NOT convert Hinglish to Devanagari script/);
    assert.match(instruction, /standard English/);
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
