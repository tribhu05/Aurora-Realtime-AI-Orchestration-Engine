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

// Treat obvious template placeholders ("your_..._key_here") as unset so the
// app cleanly falls back to offline demo mode instead of failing API calls.
function realKey(v) {
  if (!v) return '';
  return /^your_.*_here$/i.test(v.trim()) ? '' : v.trim();
}

/**
 * Creates an Aurora HTTP + WebSocket Server instance.
 * Supports running on ephemeral ports (port: 0) and deterministic mock mode
 * for CI and automated testing without real API secrets.
 */
export function createAuroraServer(options = {}) {
  const quiet = options.quiet ?? false;
  const mock = options.mock ?? false;
  let artificialDelayMs = options.delayMs ?? Number(process.env.ARTIFICIAL_DELAY_MS || 0);

  const rimeConfig = {
    apiKey: mock ? '' : (options.rimeApiKey ?? realKey(process.env.RIME_API_KEY)),
    modelId: options.rimeModelId || process.env.RIME_MODEL_ID || 'mistv3',
    speaker: options.rimeSpeaker || process.env.RIME_SPEAKER || 'astra',
    audioFormat: options.rimeAudioFormat || process.env.RIME_AUDIO_FORMAT || 'mp3',
    mockAudio: options.mockAudio ?? mock,
  };

  const llmConfig = {
    provider: options.llmProvider || process.env.LLM_PROVIDER || 'gemini',
    apiKey: mock ? '' : (options.llmApiKey ?? realKey(process.env.LLM_API_KEY)),
    model: options.llmModel || process.env.LLM_MODEL || 'gemini-3.5-flash-lite',
  };

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'client')));

  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.get('/config', (_req, res) =>
    res.json({
      rimeConfigured: Boolean(rimeConfig.apiKey),
      llmConfigured: Boolean(llmConfig.apiKey),
      speaker: rimeConfig.speaker,
      modelId: rimeConfig.modelId,
      llmProvider: llmConfig.provider,
      llmModel: llmConfig.model,
      delayMs: artificialDelayMs,
    })
  );

  app.get('/api/voices', (_req, res) => {
    res.json({
      speakers: RIME_SPEAKERS,
      models: RIME_MODELS,
      activeSpeaker: rimeConfig.speaker,
      activeModel: rimeConfig.modelId,
      rimeConfigured: Boolean(rimeConfig.apiKey),
    });
  });

  app.post('/api/preview-tts', async (req, res) => {
    try {
      const { text = 'Hello from Rime voice synthesis.', speaker = rimeConfig.speaker, modelId = rimeConfig.modelId } = req.body;
      if (!rimeConfig.apiKey && !rimeConfig.mockAudio) {
        return res.json({ ok: false, fallback: true, message: 'No Rime API key configured. Browser speech will be used.' });
      }
      const buf = await synthesizeSpeech(text, {
        ...rimeConfig,
        speaker,
        modelId,
      });
      if (!buf) {
        return res.json({ ok: false, fallback: true });
      }
      res.json({
        ok: true,
        audio: buf.toString('base64'),
        format: rimeConfig.audioFormat,
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
      llmConfig.apiKey = llmApiKey.trim();
      llmConfig.provider = llmProvider;
      if (llmModel && llmModel.trim()) {
        llmConfig.model = llmModel.trim();
      } else {
        llmConfig.model = llmProvider === 'gemini' ? 'gemini-3.5-flash-lite' : (llmProvider === 'openai' ? 'gpt-4o-mini' : 'llama-3.1-8b-instant');
      }
      if (!quiet) console.log(`🧠 Online LLM Brain activated: ${llmConfig.provider} (${llmConfig.model})`);
      return res.json({
        ok: true,
        llmConfigured: true,
        provider: llmConfig.provider,
        model: llmConfig.model,
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
      rimeConfigured: Boolean(rimeConfig.apiKey),
      llmConfigured: Boolean(llmConfig.apiKey),
      speaker: rimeConfig.speaker,
      modelId: rimeConfig.modelId,
      audioFormat: rimeConfig.audioFormat,
      llmProvider: llmConfig.provider,
      llmModel: llmConfig.model,
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
          rimeConfig.speaker = msg.speaker.trim();
        }
        if (typeof msg.modelId === 'string' && msg.modelId.trim()) {
          rimeConfig.modelId = msg.modelId.trim();
        }
        send(ws, {
          type: 'config_updated',
          speaker: rimeConfig.speaker,
          modelId: rimeConfig.modelId,
        });
        return;
      }

      if (msg.type === 'set_delay') {
        const ms = Number(msg.delayMs);
        if (!isNaN(ms) && ms >= 0 && ms <= 10000) {
          artificialDelayMs = ms;
          send(ws, { type: 'delay_updated', delayMs: artificialDelayMs });
        }
        return;
      }

      if (msg.type === 'interrupt') {
        const t0 = process.hrtime.bigint();
        const ackedGen = state.generation;
        if (state.activeController) {
          state.activeController.abort();
          state.activeController = null;
        }
        state.generation += 1;
        const serverProcessingNs = Number(process.hrtime.bigint() - t0);
        const serverProcessingMs = Number((serverProcessingNs / 1e6).toFixed(3));
        send(ws, {
          type: 'interrupted',
          oldGeneration: ackedGen,
          newGeneration: state.generation,
          serverProcessingMs,
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
        handleTurn({
          ws,
          state,
          myGen,
          userText: msg.text.trim(),
          userOverride: msg.mode,
          rimeConfig,
          llmConfig,
          getDelayMs: () => artificialDelayMs,
        }).catch((err) => {
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

  return {
    app,
    httpServer,
    wss,
    rimeConfig,
    llmConfig,
    listen(port = 0) {
      return new Promise((resolve) => {
        const server = httpServer.listen(port, () => {
          const addr = server.address();
          const boundPort = typeof addr === 'object' && addr ? addr.port : port;
          if (!quiet) {
            console.log(`✨ Aurora is listening on http://localhost:${boundPort}`);
            console.log(`   Rime TTS:  ${rimeConfig.apiKey ? 'configured (' + rimeConfig.speaker + ')' : (rimeConfig.mockAudio ? 'mock audio mode' : 'NOT configured — using browser speech fallback')}`);
            console.log(`   LLM:       ${llmConfig.apiKey ? 'configured (' + llmConfig.provider + ')' : 'NOT configured — using offline demo replies'}`);
          }
          resolve({ port: boundPort, server, httpServer });
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        for (const client of wss.clients) {
          try { client.terminate(); } catch (_) {}
        }
        wss.close(() => {
          httpServer.close((err) => (err ? reject(err) : resolve()));
        });
      });
    },
  };
}

async function handleTurn({ ws, state, myGen, userText, userOverride = null, rimeConfig, llmConfig, getDelayMs }) {
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
        rimeConfig,
      });
    } catch (err) {
      if (err?.name === 'AbortError') return;
      console.error('[task error]', err);
    } finally {
      if (state.activeController === controller) state.activeController = null;
    }
    return;
  }

  // 2. Standard dual-channel LLM turn with Intelligent Response Routing
  send(ws, { type: 'thinking', generation: myGen, timestamp: Date.now() });

  const t0 = Date.now();
  let replyObj;
  try {
    replyObj = await getAssistantReply({
      provider: llmConfig.provider,
      apiKey: llmConfig.apiKey,
      model: llmConfig.model,
      messages: state.history,
      signal: controller.signal,
      userOverride,
    });
  } catch (err) {
    if (err?.name === 'AbortError') return;
    throw err;
  }
  if (isStale(state, myGen)) return; // interrupted while thinking

  const llmMs = Date.now() - t0;
  state.history.push({ role: 'assistant', content: replyObj.content });

  // Send visual chat payload to client with modality routing metadata
  const visualPayload = replyObj.visualResponse || {
    type: replyObj.type || 'text',
    language: replyObj.language || null,
    title: replyObj.title || null,
    content: replyObj.content,
  };

  send(ws, {
    type: 'ai_text',
    text: visualPayload.content || replyObj.content,
    spoken: replyObj.spokenResponse || replyObj.spoken,
    visual: visualPayload,
    visualType: visualPayload.type || replyObj.visualType || replyObj.type || 'text',
    language: visualPayload.language || replyObj.language || null,
    title: visualPayload.title || replyObj.title || null,
    responseMode: replyObj.responseMode || 'VOICE',
    spokenResponse: replyObj.spokenResponse || replyObj.spoken,
    visualResponse: visualPayload,
    generation: myGen,
    llmMs,
    timestamp: Date.now(),
  });

  const delayMs = getDelayMs ? getDelayMs() : 0;
  if (delayMs > 0) {
    await sleep(delayMs, controller.signal);
  }
  if (isStale(state, myGen)) return;

  // Synthesize speech ONLY from the spoken channel (NEVER raw code or JSON)
  const spokenText = replyObj.spokenResponse || replyObj.spoken || (
    visualPayload.type === 'code' ? "I've written the code in the workspace." : "I've placed the response in the workspace."
  );
  const t1 = Date.now();
  let audioBuffer = null;
  try {
    audioBuffer = await synthesizeSpeech(spokenText, rimeConfig, controller.signal);
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
      speaker: rimeConfig.speaker,
      modelId: rimeConfig.modelId,
      format: rimeConfig.audioFormat,
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
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
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

const isDirectRun = process.argv[1] && (
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) ||
  process.argv[1].endsWith('server.js')
);

if (isDirectRun) {
  const instance = createAuroraServer();
  instance.listen(PORT);
}
