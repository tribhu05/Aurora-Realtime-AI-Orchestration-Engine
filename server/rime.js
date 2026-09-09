// server/rime.js
// Thin client around the official Rime TTS API.
// Returns null (instead of throwing) when no key is configured so the
// caller can gracefully fall back to browser-side speech synthesis.

const RIME_ENDPOINT = 'https://users.rime.ai/v1/rime-tts';

export const RIME_SPEAKERS = [
  { id: 'astra', name: 'Astra', style: 'Crisp, articulate, fast (Sub-100ms)', gender: 'Female', models: ['mistv3', 'coda'] },
  { id: 'luna', name: 'Luna', style: 'Warm, natural, conversational', gender: 'Female', models: ['mistv3', 'coda'] },
  { id: 'celeste', name: 'Celeste', style: 'Expressive, friendly, melodic', gender: 'Female', models: ['coda'] },
  { id: 'cove', name: 'Cove', style: 'Youthful, calm, smooth conversational', gender: 'Female', models: ['mistv3'] },
  { id: 'blaze', name: 'Blaze', style: 'Energetic, dynamic, engaging', gender: 'Male', models: ['mistv3'] },
  { id: 'breeze', name: 'Breeze', style: 'Calm, clear, natural pace', gender: 'Male', models: ['mistv3'] },
];

export const RIME_MODELS = [
  { id: 'mistv3', name: 'Mist v3', latency: '< 100ms', description: 'Engineered for real-time conversational turn-taking' },
  { id: 'coda', name: 'Coda', latency: '~ 250ms', description: 'Expressive and highly nuanced prosody' },
];

export async function synthesizeSpeech(text, config, signal) {
  const { apiKey, modelId = 'mistv3', speaker = 'astra', audioFormat = 'mp3', lang = 'en' } = config;

  if (!apiKey) {
    // No key configured -> let the caller fall back to local TTS.
    return null;
  }

  // Model adaptation: Celeste is on Coda; Cove, Blaze, Breeze are on Mist v3
  let effectiveModel = modelId;
  if (speaker === 'celeste') {
    effectiveModel = 'coda';
  } else if (['cove', 'blaze', 'breeze'].includes(speaker)) {
    effectiveModel = 'mistv3';
  }

  const res = await fetch(RIME_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: audioFormat === 'wav' ? 'audio/wav' : 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      speaker,
      modelId: effectiveModel,
      lang,
      audioFormat,
    }),
    signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Rime TTS error ${res.status}: ${body.slice(0, 200)}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

