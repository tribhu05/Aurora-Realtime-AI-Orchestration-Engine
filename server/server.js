// server/server.js
// Express static server + WebSocket voice orchestrator.
// Implements generation-fenced turn-taking: every AI turn gets a
// strictly increasing generationId, and an in-flight turn can be
// aborted the instant the user barges in.

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

import { getAssistantReply } from './llm.js';
import { synthesizeSpeech, RIME_SPEAKERS, RIME_MODELS } from './rime.js';
import { isTaskRequest, executeScaffoldTask } from './tasks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;
let ARTIFICIAL_DELAY_MS = Number(process.env.ARTIFICIAL_DELAY_MS || 0);

// Treat obvious template placeholders ("your_..._key_here") as unset so the
// app cleanly falls back to offline demo mode instead of failing API calls.
function realKey(v) {
  if (!v) return '';
  return /^your_.*_here$/i.test(v.trim()) ? '' : v.trim();
}

const RIME_CONFIG = {
  apiKey: realKey(process.env.RIME_API_KEY),
  modelId: process.env.RIME_MODEL_ID || 'mistv3',
  speaker: process.env.RIME_SPEAKER || 'astra',
  audioFormat: process.env.RIME_AUDIO_FORMAT || 'mp3',
};

const LLM_CONFIG = {
  provider: process.env.LLM_PROVIDER || 'gemini',
  apiKey: realKey(process.env.LLM_API_KEY),
  model: process.env.LLM_MODEL || 'gemini-3.5-flash-lite',
};

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'client')));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/config', (_req, res) =>
  res.json({
    rimeConfigured: Boolean(RIME_CONFIG.apiKey),
    llmConfigured: Boolean(LLM_CONFIG.apiKey),
    speaker: RIME_CONFIG.speaker,
    modelId: RIME_CONFIG.modelId,
    llmProvider: LLM_CONFIG.provider,
    llmModel: LLM_CONFIG.model,
    delayMs: ARTIFICIAL_DELAY_MS,
  })
);

app.get('/api/voices', (_req, res) => {
  res.json({
    speakers: RIME_SPEAKERS,
    models: RIME_MODELS,
    activeSpeaker: RIME_CONFIG.speaker,
    activeModel: RIME_CONFIG.modelId,
    rimeConfigured: Boolean(RIME_CONFIG.apiKey),
  });
});

app.post('/api/preview-tts', async (req, res) => {
  try {
    const { text = 'Hello from Rime voice synthesis.', speaker = RIME_CONFIG.speaker, modelId = RIME_CONFIG.modelId } = req.body;
    if (!RIME_CONFIG.apiKey) {
      return res.json({ ok: false, fallback: true, message: 'No Rime API key configured. Browser speech will be used.' });
    }
    const buf = await synthesizeSpeech(text, {
      ...RIME_CONFIG,
      speaker,
      modelId,
    });
    if (!buf) {
      return res.json({ ok: false, fallback: true });
    }
    res.json({
      ok: true,
      audio: buf.toString('base64'),
      format: RIME_CONFIG.audioFormat,
      speaker,
      modelId,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/keys', (req, res) => {
  const { llmApiKey, llmProvider = 'groq', llmModel } = req.body;
  if (typeof llmApiKey === 'string' && llmApiKey.trim()) {
    LLM_CONFIG.apiKey = llmApiKey.trim();
    LLM_CONFIG.provider = llmProvider;
    if (llmModel && llmModel.trim()) {
      LLM_CONFIG.model = llmModel.trim();
    } else {
      LLM_CONFIG.model = llmProvider === 'gemini' ? 'gemini-3.5-flash-lite' : (llmProvider === 'openai' ? 'gpt-4o-mini' : 'llama-3.1-8b-instant');
    }
    console.log(`🧠 Online LLM Brain activated: ${LLM_CONFIG.provider} (${LLM_CONFIG.model})`);
    return res.json({
      ok: true,
      llmConfigured: true,
      provider: LLM_CONFIG.provider,
      model: LLM_CONFIG.model,
    });
  }
  res.json({ ok: false, error: 'API key is required' });
});

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  if (ws._socket) {
    ws._socket.setNoDelay(true);
  }
  const sessionId = randomUUID();
  const state = {
    generation: 0,
    activeController: null,
    history: [], // only what the user actually heard / said
  };

  send(ws, {
    type: 'handshake',
    sessionId,
    generation: state.generation,
    rimeConfigured: Boolean(RIME_CONFIG.apiKey),
    llmConfigured: Boolean(LLM_CONFIG.apiKey),
    speaker: RIME_CONFIG.speaker,
    modelId: RIME_CONFIG.modelId,
    audioFormat: RIME_CONFIG.audioFormat,
    llmProvider: LLM_CONFIG.provider,
    llmModel: LLM_CONFIG.model,
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'update_config') {
      if (typeof msg.speaker === 'string' && msg.speaker.trim()) {
        RIME_CONFIG.speaker = msg.speaker.trim();
      }
      if (typeof msg.modelId === 'string' && msg.modelId.trim()) {
        RIME_CONFIG.modelId = msg.modelId.trim();
      }
      send(ws, {
        type: 'config_updated',
        speaker: RIME_CONFIG.speaker,
        modelId: RIME_CONFIG.modelId,
      });
      return;
    }

    if (msg.type === 'set_delay') {
      const ms = Number(msg.delayMs);
      if (!isNaN(ms) && ms >= 0 && ms <= 10000) {
        ARTIFICIAL_DELAY_MS = ms;
        send(ws, { type: 'delay_updated', delayMs: ARTIFICIAL_DELAY_MS });
      }
      return;
    }

    if (msg.type === 'interrupt') {
      const ackedGen = state.generation;
      if (state.activeController) {
        state.activeController.abort();
        state.activeController = null;
      }
      state.generation += 1;
      send(ws, {
        type: 'interrupted',
        oldGeneration: ackedGen,
        newGeneration: state.generation,
        serverTimestamp: Date.now(),
        clientTimestamp: msg.timestamp || null,
      });
      return;
    }

    if (msg.type === 'query' && typeof msg.text === 'string' && msg.text.trim()) {
      // A fresh query always cancels whatever was in flight first.
      if (state.activeController) {
        state.activeController.abort();
        state.activeController = null;
      }
      state.generation += 1;
      const myGen = state.generation;
      handleTurn(ws, state, myGen, msg.text.trim()).catch((err) => {
        if (err?.name === 'AbortError') return;
        console.error('[turn error]', err);
        send(ws, { type: 'error', generation: myGen, message: 'Something went wrong on my end.' });
      });
    }
  });

  ws.on('close', () => {
    if (state.activeController) state.activeController.abort();
  });
});

async function handleTurn(ws, state, myGen, userText) {
  const turnStartTime = Date.now();
  send(ws, { type: 'user_text', text: userText, generation: myGen, timestamp: turnStartTime });
  state.history.push({ role: 'user', content: userText });

  const controller = new AbortController();
  state.activeController = controller;

  // 1. Task execution routing
  if (isTaskRequest(userText)) {
    try {
      await executeScaffoldTask({
        ws,
        state,
        myGen,
        userText,
        signal: controller.signal,
        send,
        rimeConfig: RIME_CONFIG,
      });
    } catch (err) {
      if (err?.name === 'AbortError') return;
      console.error('[task error]', err);
    } finally {
      if (state.activeController === controller) state.activeController = null;
    }
    return;
  }

  // 2. Standard dual-channel LLM turn
  send(ws, { type: 'thinking', generation: myGen, timestamp: Date.now() });

  const t0 = Date.now();
  let replyObj;
  try {
    replyObj = await getAssistantReply({
      provider: LLM_CONFIG.provider,
      apiKey: LLM_CONFIG.apiKey,
      model: LLM_CONFIG.model,
      messages: state.history,
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') return;
    throw err;
  }
  if (isStale(state, myGen)) return; // interrupted while thinking

  const llmMs = Date.now() - t0;
  state.history.push({ role: 'assistant', content: replyObj.content });

  // Send visual chat payload to client
  send(ws, {
    type: 'ai_text',
    text: replyObj.content,
    spoken: replyObj.spoken,
    visualType: replyObj.type,
    language: replyObj.language,
    title: replyObj.title,
    generation: myGen,
    llmMs,
    timestamp: Date.now(),
  });

  if (ARTIFICIAL_DELAY_MS > 0) {
    await sleep(ARTIFICIAL_DELAY_MS, controller.signal);
  }
  if (isStale(state, myGen)) return;

  // Synthesize speech ONLY from the spoken channel!
  const spokenText = replyObj.spoken || replyObj.content;
  const t1 = Date.now();
  let audioBuffer = null;
  try {
    audioBuffer = await synthesizeSpeech(spokenText, RIME_CONFIG, controller.signal);
  } catch (err) {
    if (err?.name === 'AbortError') return;
    console.error('[rime error]', err.message);
    audioBuffer = null; // fall back to local speech synthesis on the client
  }
  if (isStale(state, myGen)) return;

  const ttsMs = Date.now() - t1;
  const totalMs = Date.now() - turnStartTime;

  if (audioBuffer) {
    send(ws, {
      type: 'audio',
      generation: myGen,
      speaker: RIME_CONFIG.speaker,
      modelId: RIME_CONFIG.modelId,
      format: RIME_CONFIG.audioFormat,
      data: audioBuffer.toString('base64'),
      ttsMs,
      llmMs,
      totalMs,
      timestamp: Date.now(),
    });
  } else {
    // Graceful fallback: no Rime key or Rime failed -> speak locally in-browser.
    send(ws, {
      type: 'speak_local',
      text: spokenText,
      generation: myGen,
      llmMs,
      totalMs,
      timestamp: Date.now(),
    });
  }

  send(ws, { type: 'done', generation: myGen, totalMs, timestamp: Date.now() });
  state.activeController = null;
}

function isStale(state, myGen) {
  return myGen !== state.generation;
}

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    });
  });
}

httpServer.listen(PORT, () => {
  console.log(`✨ Aurora is listening on http://localhost:${PORT}`);
  console.log(`   Rime TTS:  ${RIME_CONFIG.apiKey ? 'configured (' + RIME_CONFIG.speaker + ')' : 'NOT configured — using browser speech fallback'}`);
  console.log(`   LLM:       ${LLM_CONFIG.apiKey ? 'configured (' + LLM_CONFIG.provider + ')' : 'NOT configured — using offline demo replies'}`);
});
