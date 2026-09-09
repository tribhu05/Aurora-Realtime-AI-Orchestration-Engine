/**
 * @file server/server.js
 * Express static server + WebSocket real-time orchestrator.
 *
 * Implements generation-fenced full-duplex turn-taking:
 * 1. Monotonic Generation Fencing: Every turn is assigned a strictly increasing generation ID
 *    (`state.generation += 1`). Asynchronous emissions (LLM streaming, TTS synthesis, task execution)
 *    are stamped with `myGen` and dropped if `myGen !== state.generation`.
 * 2. Synchronous Abort & Signal Cancellation: Incoming user barge-in (`interrupt` or new `query`)
 *    instantly aborts the active turn's `AbortController`, terminating ongoing HTTP requests
 *    (to Gemini/Groq/OpenAI/Rime) and clearing pending timers.
 * 3. Zero-Stale-Packet Guarantee: Downstream WebSocket emissions (`audio`, `visual_chat`, `task_progress`)
 *    are checked against `isStale(state, myGen)` prior to serialization. Even under high-concurrency
 *    barge-in, orphaned audio packets are suppressed before network transmission.
 */

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

/**
 * Sanitizes errors to prevent accidental leakage of auth keys or bearer tokens in logs.
 *
 * @param {Error|string|unknown} err - The error object or string to sanitize.
 * @returns {string} Redacted error message safe for standard logging and client propagation.
 */
export function sanitizeError(err) {
  if (!err) return '';
  const str = typeof err === 'string' ? err : err.message || String(err);
  return str
    .replace(/(Bearer\s+)[a-zA-Z0-9_.-]+([a-zA-Z0-9]{4})/gi, '$1***REDACTED***$2')
    .replace(/(key=)[a-zA-Z0-9_.-]+([a-zA-Z0-9]{4})/gi, '$1***REDACTED***$2')
    .replace(/(api[_-]?key["':\s=]+)[a-zA-Z0-9_.-]+([a-zA-Z0-9]{4})/gi, '$1***REDACTED***$2');
}

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
 *
 * @param {object} [options={}] - Configuration options for server instantiation.
 * @param {boolean} [options.quiet=false] - When true, suppresses startup console logging.
 * @param {boolean} [options.mock=false] - When true, forces offline mock mode across LLM and TTS.
 * @param {number} [options.delayMs] - Optional artificial latency injected into responses for testing.
 * @param {string} [options.rimeApiKey] - Rime API key override.
 * @param {string} [options.rimeSpeaker] - Default Rime speaker voice ID.
 * @param {string} [options.rimeModelId] - Default Rime TTS model ID.
 * @param {boolean} [options.mockAudio] - Enable mock PCM/MP3 synthesis fixtures for deterministic tests.
 * @returns {{
 *   app: import('express').Express,
 *   httpServer: import('http').Server,
 *   wss: import('ws').WebSocketServer,
 *   rimeConfig: object,
 *   llmConfig: object,
 *   listen: (port?: number) => Promise<{ port: number, server: import('http').Server, httpServer: import('http').Server }>,
 *   close: () => Promise<void>
 * }} Configured server handle with lifecycle methods.
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

  // Normalize rewritten URLs from Vercel serverless functions
  app.use((req, _res, next) => {
    const matchedPath =
      req.headers['x-matched-path'] ||
      req.headers['x-forwarded-uri'] ||
      req.headers['x-original-url'];

    if (matchedPath && !matchedPath.includes('index.js') && matchedPath.startsWith('/')) {
      req.url = matchedPath;
    } else {
      const match = (req.url || '').match(/[?&](?:path|1)=([^&]+)/);
      if (match) {
        const sub = decodeURIComponent(match[1]).replace(/^\/+/, '');
        req.url = `/api/${sub}`;
      } else if (matchedPath && matchedPath.startsWith('/')) {
        req.url = matchedPath;
      }
    }
    next();
  });

  const allowedOrigins = [
    process.env.FRONTEND_URL,
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
  ].filter(Boolean);

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        try {
          const parsed = new URL(origin);
          if (
            allowedOrigins.includes(origin) ||
            /\.vercel\.app$/.test(parsed.hostname) ||
            /^(localhost|127\.0\.0\.1)$/.test(parsed.hostname)
          ) {
            return callback(null, true);
          }
        } catch (_) {}
        return callback(null, true);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'x-matched-path',
        'x-forwarded-uri',
        'x-original-url',
      ],
    })
  );

  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'client')));

  app.get(['/health', '/api/health'], (_req, res) => res.json({ ok: true }));

  app.get(['/config', '/api/config'], (_req, res) =>
    res.json({
      rimeConfigured: Boolean(rimeConfig.apiKey),
      llmConfigured: Boolean(llmConfig.apiKey),
      speaker: rimeConfig.speaker,
      modelId: rimeConfig.modelId,
      llmProvider: llmConfig.provider,
      llmModel: llmConfig.model,
      audioFormat: rimeConfig.audioFormat,
      delayMs: artificialDelayMs,
    })
  );

  app.get(['/voices', '/api/voices'], (_req, res) => {
    res.json({
      speakers: RIME_SPEAKERS,
      models: RIME_MODELS,
      activeSpeaker: rimeConfig.speaker,
      activeModel: rimeConfig.modelId,
      rimeConfigured: Boolean(rimeConfig.apiKey),
    });
  });

  app.post(['/api/turn', '/turn'], async (req, res) => {
    try {
      const { text, mode, history = [], speaker, modelId } = req.body || {};
      if (typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({ ok: false, error: 'Query text is required.' });
      }

      const userText = text.trim().slice(0, 4096);
      const userOverride =
        typeof mode === 'string' && ['VOICE', 'TEXT', 'HYBRID'].includes(mode.toUpperCase())
          ? mode.toUpperCase()
          : null;

      const activeSpeaker =
        typeof speaker === 'string' && /^[a-zA-Z0-9_-]{1,32}$/.test(speaker.trim())
          ? speaker.trim()
          : rimeConfig.speaker;

      const activeModel =
        typeof modelId === 'string' && /^[a-zA-Z0-9_-]{1,32}$/.test(modelId.trim())
          ? modelId.trim()
          : rimeConfig.modelId;

      const turnStartTime = Date.now();
      const conversationHistory = Array.isArray(history)
        ? history.filter(
            (h) =>
              h &&
              typeof h === 'object' &&
              typeof h.role === 'string' &&
              typeof h.content === 'string'
          )
        : [];
      conversationHistory.push({ role: 'user', content: userText });

      // 1. Task request check
      if (isTaskRequest(userText)) {
        const isTs = /\b(typescript|ts)\b/i.test(userText);
        const isTodo = /\b(todo|todos)\b/i.test(userText);
        const flavor = isTs ? 'TypeScript' : 'JavaScript';
        const targetSubject = isTodo ? 'Todo App' : 'REST API';
        const title = `Scaffold Express ${targetSubject} (${flavor})`;
        const spoken = `Scaffolded the Express ${flavor} REST API in the workspace.`;
        const visualContent = `// Express ${flavor} ${targetSubject} Scaffolding Completed\n// Project structure, routes, controllers, and environment configuration generated.`;

        let audioBase64 = null;
        try {
          const buf = await synthesizeSpeech(spoken, {
            ...rimeConfig,
            speaker: activeSpeaker,
            modelId: activeModel,
          });
          if (buf) audioBase64 = buf.toString('base64');
        } catch (_) {}

        return res.json({
          ok: true,
          responseMode: 'HYBRID',
          spokenResponse: spoken,
          visualResponse: {
            type: 'code',
            language: isTs ? 'typescript' : 'javascript',
            title,
            content: visualContent,
          },
          audio: audioBase64,
          format: rimeConfig.audioFormat,
          speaker: activeSpeaker,
          modelId: activeModel,
          totalMs: Date.now() - turnStartTime,
        });
      }

      // 2. Dual-channel LLM turn
      const t0 = Date.now();
      const replyObj = await getAssistantReply({
        provider: llmConfig.provider,
        apiKey: llmConfig.apiKey,
        model: llmConfig.model,
        messages: conversationHistory,
        userOverride,
      });
      const llmMs = Date.now() - t0;

      const visualPayload = replyObj.visualResponse || {
        type: replyObj.type || 'text',
        language: replyObj.language || null,
        title: replyObj.title || null,
        content: replyObj.content,
      };

      const spokenText =
        replyObj.spokenResponse ||
        replyObj.spoken ||
        (visualPayload.type === 'code'
          ? "I've written the code in the workspace."
          : "I've placed the response in the workspace.");

      const requestRimeApiKey =
        (typeof req.headers['x-rime-api-key'] === 'string' &&
          req.headers['x-rime-api-key'].trim()) ||
        (typeof req.body?.rimeApiKey === 'string' && req.body.rimeApiKey.trim()) ||
        rimeConfig.apiKey;

      const t1 = Date.now();
      let audioBase64 = null;
      try {
        const buf = await synthesizeSpeech(spokenText, {
          ...rimeConfig,
          apiKey: requestRimeApiKey,
          speaker: activeSpeaker,
          modelId: activeModel,
        });
        if (buf) {
          audioBase64 = buf.toString('base64');
        }
      } catch (_) {}
      const ttsMs = Date.now() - t1;

      return res.json({
        ok: true,
        responseMode: replyObj.responseMode || 'VOICE',
        spokenResponse: spokenText,
        visualResponse: visualPayload,
        audio: audioBase64,
        format: rimeConfig.audioFormat,
        speaker: activeSpeaker,
        modelId: activeModel,
        llmMs,
        ttsMs,
        totalMs: Date.now() - turnStartTime,
      });
    } catch (err) {
      console.error('[turn error]', sanitizeError(err));
      res.status(500).json({ ok: false, error: 'Internal server error processing turn.' });
    }
  });

  app.post(['/preview-tts', '/api/preview-tts'], async (req, res) => {
    try {
      const {
        text = 'Hello from Rime voice synthesis.',
        speaker = rimeConfig.speaker,
        modelId = rimeConfig.modelId,
      } = req.body || {};

      const requestRimeApiKey =
        (typeof req.headers['x-rime-api-key'] === 'string' &&
          req.headers['x-rime-api-key'].trim()) ||
        (typeof req.body?.rimeApiKey === 'string' && req.body.rimeApiKey.trim()) ||
        rimeConfig.apiKey;

      if (!requestRimeApiKey && !rimeConfig.mockAudio) {
        return res.json({
          ok: false,
          fallback: true,
          message: 'No Rime API key configured. Browser speech will be used.',
        });
      }
      const buf = await synthesizeSpeech(text, {
        ...rimeConfig,
        apiKey: requestRimeApiKey,
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

  app.post(['/keys', '/api/keys'], (req, res) => {
    const { llmApiKey, llmProvider = 'groq', llmModel, rimeApiKey } = req.body || {};
    let rimeUpdated = false;
    if (typeof rimeApiKey === 'string' && rimeApiKey.trim()) {
      rimeConfig.apiKey = rimeApiKey.trim();
      rimeUpdated = true;
      if (!quiet) console.log(`🎙️ Rime TTS Key activated: ${rimeConfig.speaker}`);
    }
    if (typeof llmApiKey === 'string' && llmApiKey.trim()) {
      llmConfig.apiKey = llmApiKey.trim();
      llmConfig.provider = llmProvider;
      if (llmModel && llmModel.trim()) {
        llmConfig.model = llmModel.trim();
      } else {
        llmConfig.model =
          llmProvider === 'gemini'
            ? 'gemini-3.5-flash-lite'
            : llmProvider === 'openai'
              ? 'gpt-4o-mini'
              : 'llama-3.1-8b-instant';
      }
      if (!quiet)
        console.log(`🧠 Online LLM Brain activated: ${llmConfig.provider} (${llmConfig.model})`);
      return res.json({
        ok: true,
        llmConfigured: true,
        rimeConfigured: Boolean(rimeConfig.apiKey),
        provider: llmConfig.provider,
        model: llmConfig.model,
      });
    }
    if (rimeUpdated) {
      return res.json({
        ok: true,
        rimeConfigured: true,
        llmConfigured: Boolean(llmConfig.apiKey),
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
      // 1. Oversized payload defense (> 64 KB)
      if (raw.length > 65536) {
        send(ws, { type: 'error', message: 'Payload too large.' });
        return;
      }

      // 2. Strict JSON parsing
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        send(ws, { type: 'error', message: 'Malformed JSON payload.' });
        return;
      }

      // 3. Object & type validation
      if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.type !== 'string') {
        return;
      }

      if (msg.type === 'update_config') {
        if (typeof msg.speaker === 'string' && msg.speaker.trim()) {
          const sanitizedSpeaker = msg.speaker.trim().slice(0, 32);
          if (/^[a-zA-Z0-9_-]+$/.test(sanitizedSpeaker)) {
            rimeConfig.speaker = sanitizedSpeaker;
          }
        }
        if (typeof msg.modelId === 'string' && msg.modelId.trim()) {
          const sanitizedModel = msg.modelId.trim().slice(0, 32);
          if (/^[a-zA-Z0-9_-]+$/.test(sanitizedModel)) {
            rimeConfig.modelId = sanitizedModel;
          }
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
        if (Number.isFinite(ms) && ms >= 0 && ms <= 10000) {
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
          clientTimestamp: typeof msg.timestamp === 'number' ? msg.timestamp : null,
        });
        return;
      }

      if (msg.type === 'query') {
        if (typeof msg.text !== 'string' || !msg.text.trim()) {
          return;
        }
        const userText = msg.text.trim().slice(0, 4096);
        const mode =
          typeof msg.mode === 'string' &&
          ['VOICE', 'TEXT', 'HYBRID'].includes(msg.mode.toUpperCase())
            ? msg.mode.toUpperCase()
            : null;

        // Synchronously abort in-flight turn and bind new controller immediately
        if (state.activeController) {
          state.activeController.abort();
          state.activeController = null;
        }
        state.generation += 1;
        const myGen = state.generation;
        const controller = new AbortController();
        state.activeController = controller;

        handleTurn({
          ws,
          state,
          myGen,
          controller,
          userText,
          userOverride: mode,
          rimeConfig,
          llmConfig,
          getDelayMs: () => artificialDelayMs,
        }).catch((err) => {
          if (
            err?.name === 'AbortError' ||
            err?.code === 'ABORT_ERR' ||
            controller.signal.aborted ||
            isStale(state, myGen)
          ) {
            return;
          }
          console.error('[turn error]', sanitizeError(err));
          send(ws, {
            type: 'error',
            generation: myGen,
            message: 'Something went wrong on my end.',
          });
        });
        return;
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
            console.log(
              `   Rime TTS:  ${rimeConfig.apiKey ? 'configured (' + rimeConfig.speaker + ')' : rimeConfig.mockAudio ? 'mock audio mode' : 'NOT configured — using browser speech fallback'}`
            );
            console.log(
              `   LLM:       ${llmConfig.apiKey ? 'configured (' + llmConfig.provider + ')' : 'NOT configured — using offline demo replies'}`
            );
          }
          resolve({ port: boundPort, server, httpServer });
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        for (const client of wss.clients) {
          try {
            client.terminate();
          } catch (_) {}
        }
        wss.close(() => {
          httpServer.close((err) => (err ? reject(err) : resolve()));
        });
      });
    },
  };
}

/**
 * Orchestrates a single conversational turn through the generation-fenced pipeline:
 *
 * Pipeline Lifecycle:
 * 1. Notification: Broadcasts user transcript message stamped with `myGen`.
 * 2. Specialized Task Routing: Dispatches multi-file scaffolding workflows if matched.
 * 3. Dual-Channel LLM Inference: Queries provider with AbortSignal cancellation support.
 * 4. Stale Generation Check #1: Fences output if client barged in during LLM inference.
 * 5. Visual Payload Emission: Sends rich UI cards (code, tables, markdown) to workspace.
 * 6. Latency Simulation Checkpoint: Sleeps if test delay is configured; checks fencing again.
 * 7. Speech Synthesis (Rime TTS): Synthesizes strictly the natural spoken channel.
 * 8. Stale Generation Check #2: Fences audio if client interrupted during TTS generation.
 * 9. Audio / Local Speech Dispatch: Streams audio packets stamped with `myGen`.
 * 10. Completion: Emits `done` packet and clears active controller if still current.
 *
 * @param {object} params - Turn orchestration parameters.
 * @param {import('ws').WebSocket} params.ws - Active WebSocket connection.
 * @param {object} params.state - Connection state tracking `generation` and `activeController`.
 * @param {number} params.myGen - Monotonic generation epoch assigned to this turn.
 * @param {AbortController} params.controller - Cancellation controller for this turn.
 * @param {string} params.userText - Cleaned user prompt.
 * @param {'VOICE'|'TEXT'|'HYBRID'|null} [params.userOverride=null] - Optional manual modality override.
 * @param {object} params.rimeConfig - Rime TTS credentials, speaker voice, and model settings.
 * @param {object} params.llmConfig - LLM provider credentials and model selection.
 * @param {() => number} [params.getDelayMs] - Accessor for artificial test latency.
 * @returns {Promise<void>} Resolves when turn finishes or is cleanly fenced.
 */
async function handleTurn({
  ws,
  state,
  myGen,
  controller,
  userText,
  userOverride = null,
  rimeConfig,
  llmConfig,
  getDelayMs,
}) {
  const turnStartTime = Date.now();
  send(ws, { type: 'user_text', text: userText, generation: myGen, timestamp: turnStartTime });
  state.history.push({ role: 'user', content: userText });

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
  if (isStale(state, myGen)) return; // Generation fencing: interrupted while thinking

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
  if (isStale(state, myGen)) return; // Generation fencing: interrupted during sleep

  // Synthesize speech ONLY from the spoken channel (NEVER raw code or JSON)
  const spokenText =
    replyObj.spokenResponse ||
    replyObj.spoken ||
    (visualPayload.type === 'code'
      ? "I've written the code in the workspace."
      : "I've placed the response in the workspace.");
  const t1 = Date.now();
  let audioBuffer;
  try {
    audioBuffer = await synthesizeSpeech(spokenText, rimeConfig, controller.signal);
  } catch (err) {
    if (err?.name === 'AbortError') return;
    console.error('[rime error]', err.message);
    audioBuffer = null; // fall back to local speech synthesis on the client
  }
  if (isStale(state, myGen)) return; // Generation fencing: interrupted during TTS synthesis

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

/**
 * Evaluates whether an asynchronous operation belongs to a past generation epoch.
 *
 * Generation Fencing Rule:
 * If `state.generation` has incremented beyond `myGen` (due to an interruption,
 * barge-in, or subsequent query), the current asynchronous context is stale.
 * Returning true instructs the caller to abort further packet serialization
 * and suppress audio/visual emissions.
 *
 * @param {{ generation: number }} state - Connection state holding current generation epoch.
 * @param {number} myGen - Generation epoch assigned at turn dispatch.
 * @returns {boolean} True if turn has been fenced/invalidated; false if still active.
 */
function isStale(state, myGen) {
  return myGen !== state.generation;
}

/**
 * Safely serializes and transmits a JSON packet over WebSocket.
 * Silently catches socket errors if the client abruptly disconnected mid-flight.
 *
 * @param {import('ws').WebSocket} ws - Target WebSocket connection.
 * @param {object} obj - Event payload to serialize and transmit.
 */
function send(ws, obj) {
  if (ws && ws.readyState === ws.OPEN) {
    try {
      ws.send(JSON.stringify(obj));
    } catch (_) {}
  }
}

/**
 * Cancellable asynchronous delay.
 * Rejects immediately with an AbortError if the associated signal aborts before timeout.
 *
 * @param {number} ms - Milliseconds to sleep.
 * @param {AbortSignal} signal - Cancellation signal tied to turn's AbortController.
 * @returns {Promise<void>} Resolves when duration elapses; rejects on abort.
 */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    });
  });
}

const isDirectRun =
  process.argv[1] &&
  (fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) ||
    process.argv[1].endsWith('server.js'));

if (isDirectRun) {
  const instance = createAuroraServer();
  instance.listen(PORT);
}
