// server/rime.js
// Thin client around the official Rime TTS API.
// Returns null (instead of throwing) when no key is configured so the
// caller can gracefully fall back to browser-side speech synthesis.

const RIME_ENDPOINT = 'https://users.rime.ai/v1/rime-tts';

export const RIME_SPEAKERS = [
  {
    id: 'taru',
    name: 'Taru (Hindi & Hinglish)',
    style: 'Native Hindi male, natural Indian cadence & bilingual code-switching',
    gender: 'Male',
    models: ['coda'],
    nativeLang: 'hi',
  },
  {
    id: 'nadi',
    name: 'Nadi (Hindi & Hinglish)',
    style: 'Native Hindi female, balanced, expressive & natural prosody',
    gender: 'Female',
    models: ['coda'],
    nativeLang: 'hi',
  },
  {
    id: 'hawa',
    name: 'Hawa (Indian English)',
    style: 'Indian English, comfortable with code-switching & technical terms',
    gender: 'Female',
    models: ['coda'],
    nativeLang: 'en',
  },
  {
    id: 'hawk',
    name: 'Hawk (Indian English)',
    style: 'Friendly Indian male voice, warm, approachable (<400ms)',
    gender: 'Male',
    models: ['mistv3'],
    nativeLang: 'en',
  },
  {
    id: 'ironwood',
    name: 'Ironwood (Indian English)',
    style: 'Professional Indian male voice, polished and steady',
    gender: 'Male',
    models: ['mistv3'],
    nativeLang: 'en',
  },
  {
    id: 'astra',
    name: 'Astra',
    style: 'Crisp, articulate, fast (Sub-100ms)',
    gender: 'Female',
    models: ['mistv3', 'coda'],
    nativeLang: 'en',
  },
  {
    id: 'luna',
    name: 'Luna',
    style: 'Warm, natural, conversational',
    gender: 'Female',
    models: ['mistv3', 'coda'],
    nativeLang: 'en',
  },
  {
    id: 'celeste',
    name: 'Celeste',
    style: 'Expressive, friendly, melodic',
    gender: 'Female',
    models: ['coda'],
    nativeLang: 'en',
  },
  {
    id: 'cove',
    name: 'Cove',
    style: 'Youthful, calm, smooth conversational',
    gender: 'Female',
    models: ['mistv3'],
    nativeLang: 'en',
  },
  {
    id: 'blaze',
    name: 'Blaze',
    style: 'Energetic, dynamic, engaging',
    gender: 'Male',
    models: ['mistv3'],
    nativeLang: 'en',
  },
  {
    id: 'breeze',
    name: 'Breeze',
    style: 'Calm, clear, natural pace',
    gender: 'Male',
    models: ['mistv3'],
    nativeLang: 'en',
  },
];

export const RIME_MODELS = [
  {
    id: 'mistv3',
    name: 'Mist v3',
    latency: '< 100ms',
    description: 'Engineered for real-time conversational turn-taking',
  },
  {
    id: 'coda',
    name: 'Coda',
    latency: '~ 250ms',
    description: 'Expressive and highly nuanced prosody, supports Hindi & multilingual',
  },
];

/**
 * Synthesizes spoken text into audio bytes using Rime TTS API.
 * Designed for real-time full-duplex operation with AbortSignal cancellation support.
 *
 * @param {string} text - Clean spoken utterance (sanitized of code or markdown syntax).
 * @param {object} config - Synthesis configuration.
 * @param {string} [config.apiKey] - Rime API authentication token. If empty, returns null.
 * @param {string} [config.modelId='mistv3'] - Rime model identifier ('mistv3' or 'coda').
 * @param {string} [config.speaker='astra'] - Speaker persona voice ID.
 * @param {string} [config.audioFormat='mp3'] - Output audio format ('mp3' or 'wav').
 * @param {string} [config.lang='en'] - Target language code.
 * @param {boolean} [config.mockAudio=false] - When true, returns deterministic mock audio buffer for testing.
 * @param {AbortSignal} [signal] - AbortSignal connected to the turn's AbortController.
 * @returns {Promise<Buffer|null>} Audio buffer if successful, or null if API key is unset.
 */
export async function synthesizeSpeech(text, config, signal) {
  const {
    apiKey,
    modelId = 'mistv3',
    speaker = 'astra',
    audioFormat = 'mp3',
    lang = 'en',
    mockAudio = false,
  } = config || {};

  // Model adaptation: Coda models vs Mist v3 models
  let effectiveModel = modelId;
  if (['celeste', 'taru', 'nadi', 'hawa'].includes(speaker)) {
    effectiveModel = 'coda';
  } else if (['cove', 'blaze', 'breeze', 'hawk', 'ironwood'].includes(speaker)) {
    effectiveModel = 'mistv3';
  }

  const hasDevanagari = typeof text === 'string' && /[\u0900-\u097F]/.test(text);
  const isHindiCapableVoice = ['taru', 'nadi'].includes(speaker) || effectiveModel === 'coda';

  // If text contains Devanagari and voice is not Hindi-capable, fall back to browser speech
  if (hasDevanagari && !isHindiCapableVoice) {
    return null;
  }

  if (mockAudio) {
    // Deterministic mock audio buffer for offline testing and CI
    return Buffer.alloc(128, 0xaa);
  }

  if (!apiKey) {
    // No key configured -> let the caller fall back to local TTS.
    return null;
  }

  // Effective language code: use 'hi' for Hindi-capable voices on Hindi/Hinglish content
  let effectiveLang = lang;
  if (
    hasDevanagari ||
    (['taru', 'nadi'].includes(speaker) && (lang === 'hi' || lang === 'hinglish'))
  ) {
    effectiveLang = 'hi';
  }

  const timeoutMs = 3500;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  try {
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
        lang: effectiveLang,
        audioFormat,
      }),
      signal: combinedSignal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const safeBody = body
        .replace(/(Bearer\s+)[a-zA-Z0-9_.-]+([a-zA-Z0-9]{4})/gi, '$1***REDACTED***$2')
        .replace(/(key=)[a-zA-Z0-9_.-]+([a-zA-Z0-9]{4})/gi, '$1***REDACTED***$2');
      console.warn(`[Rime TTS warning] HTTP ${res.status}: ${safeBody.slice(0, 100)}`);
      return null;
    }

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    if (signal?.aborted) {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    }
    console.warn(
      `[Rime TTS warning] Synthesis timed out or failed (${err.message}). Falling back to browser speech.`
    );
    return null;
  }
}
