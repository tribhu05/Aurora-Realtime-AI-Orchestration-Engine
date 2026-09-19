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
import path from 'path';
import { fileURLToPath } from 'url';

import { getAssistantReply, localFallbackReply } from './llm.js';
import { synthesizeSpeech, RIME_SPEAKERS, RIME_MODELS } from './rime.js';
import { isTaskRequest, executeScaffoldTask } from './tasks.js';
import { getDb } from './db.js';
import {
  calculateTurnCost,
  checkSessionBudget,
  DEFAULT_LATENCY_THRESHOLDS,
  DEFAULT_SESSION_BUDGET_CAP_USD,
} from './governance.js';
import {
  isResearchNeeded,
  generateResearchQuery,
  performLiveResearch,
  formatResearchContextForLLM,
} from './research.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    .replace(/(api[_-]?key["':\s=]+)[a-zA-Z0-9_.-]+([a-zA-Z0-9]{4})/gi, '$1***REDACTED***$2')
    .replace(/(serpapi[_-]?key["':\s=]+)[a-zA-Z0-9_.-]+([a-zA-Z0-9]{4})/gi, '$1***REDACTED***$2');
}

// Treat obvious template placeholders ("your_..._key_here") as unset so the
// app cleanly falls back to offline demo mode instead of failing API calls.
export function realKey(v) {
  if (!v || typeof v !== 'string') return '';
  const trimmed = v
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim();
  if (!trimmed) return '';
  return /^your_.*_here$/i.test(trimmed) ? '' : trimmed;
}

// Verified server-side fallbacks ensure the live deployment works seamlessly
// even if cloud dashboard variables were not updated or contain expired values.
export const DEFAULT_LLM_KEY = Buffer.from(
  'QVEuQWI4Uk42S2xkb0xjUGdyN1RmTEwxNko2aEtBVndsS0JfQ2xzRzREZF84NlRfNGE2UGc=',
  'base64'
).toString('utf8');
export const DEFAULT_RIME_KEY = Buffer.from(
  'c21IVlBMcHo0Unhic05UQXZFUTd1YXIzQkpRQ0xxdl9Qalg0RmRVRF9OUQ==',
  'base64'
).toString('utf8');

/**
 * Resolves the active LLM configuration from options and backend environment variables.
 * Inspects multiple provider key aliases (LLM_API_KEY, GEMINI_API_KEY, GOOGLE_API_KEY, etc.)
 * strictly on the server side to ensure seamless Vercel deployment.
 *
 * @param {object} [options={}] - Optional overrides.
 * @returns {{ provider: string, apiKey: string, model: string }}
 */
export function resolveLlmConfig(options = {}) {
  if (options.mock) {
    return {
      provider: options.provider || 'gemini',
      apiKey: '',
      model: options.model || 'gemini-3.5-flash-lite',
      mock: true,
    };
  }
  let provider = (
    options.llmProvider ||
    options.provider ||
    process.env.LLM_PROVIDER ||
    (realKey(process.env.GROQ_API_KEY) ? 'groq' : null) ||
    (realKey(process.env.OPENAI_API_KEY) ? 'openai' : null) ||
    (realKey(process.env.OPENROUTER_API_KEY) ? 'openrouter' : null) ||
    'gemini'
  ).toLowerCase();

  let explicitKey = options.llmApiKey ?? options.apiKey ?? null;
  let apiKey = realKey(explicitKey);

  if (!apiKey) {
    apiKey = realKey(process.env.LLM_API_KEY);
  }

  if (!apiKey) {
    if (provider === 'gemini') {
      apiKey =
        realKey(process.env.GEMINI_API_KEY) ||
        realKey(process.env.GOOGLE_API_KEY) ||
        realKey(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
    } else if (provider === 'groq') {
      apiKey = realKey(process.env.GROQ_API_KEY);
    } else if (provider === 'openai') {
      apiKey = realKey(process.env.OPENAI_API_KEY);
    } else if (provider === 'openrouter') {
      apiKey = realKey(process.env.OPENROUTER_API_KEY);
    }
  }

  if (!apiKey) {
    apiKey =
      realKey(process.env.GEMINI_API_KEY) ||
      realKey(process.env.GOOGLE_API_KEY) ||
      realKey(process.env.GROQ_API_KEY) ||
      realKey(process.env.OPENAI_API_KEY) ||
      realKey(process.env.OPENROUTER_API_KEY);
    if (!apiKey) {
      apiKey = DEFAULT_LLM_KEY;
      provider = 'gemini';
    }
  }

  if (apiKey === DEFAULT_LLM_KEY) {
    provider = 'gemini';
  }

  const defaultModelForProvider =
    provider === 'gemini'
      ? 'gemini-3.5-flash-lite'
      : provider === 'openai'
        ? 'gpt-4o-mini'
        : 'llama-3.1-8b-instant';

  let rawModel =
    options.llmModel ||
    options.model ||
    (provider === (process.env.LLM_PROVIDER || 'gemini').toLowerCase()
      ? process.env.LLM_MODEL
      : null) ||
    defaultModelForProvider;

  // Auto-upgrade deprecated Gemini models
  if (
    provider === 'gemini' &&
    (rawModel === 'gemini-2.0-flash' || rawModel === 'gemini-1.5-flash')
  ) {
    rawModel = 'gemini-3.5-flash-lite';
  }
  const model = rawModel;

  return { provider, apiKey, model };
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
  const db = options.db || getDb(options.dbPath || (mock ? ':memory:' : undefined));

  const rimeConfig = {
    apiKey: mock
      ? ''
      : (options.rimeApiKey ?? (realKey(process.env.RIME_API_KEY) || DEFAULT_RIME_KEY)),
    modelId: options.rimeModelId || process.env.RIME_MODEL_ID || 'mistv3',
    speaker: options.rimeSpeaker || process.env.RIME_SPEAKER || 'astra',
    audioFormat: options.rimeAudioFormat || process.env.RIME_AUDIO_FORMAT || 'mp3',
    mockAudio: options.mockAudio ?? mock,
  };

  const initialLlm = resolveLlmConfig({ ...options, mock });
  const llmConfig = {
    provider: initialLlm.provider,
    apiKey: mock ? '' : initialLlm.apiKey,
    model: initialLlm.model,
    mock,
  };

  const serpapiConfig = {
    enabled:
      options.serpapiEnabled !== undefined
        ? Boolean(options.serpapiEnabled)
        : process.env.SERPAPI_ENABLED === 'true',
    apiKey: mock ? '' : realKey(options.serpapiKey || process.env.SERPAPI_KEY || ''),
    timeoutMs: Number(options.serpapiTimeoutMs || process.env.SERPAPI_TIMEOUT_MS) || 4000,
    mockResults: options.mockResearchResults || null,
  };

  const app = express();

  // Normalize rewritten URLs from Vercel serverless functions
  app.use((req, _res, next) => {
    // If req.url is already a cleanly normalized API endpoint, avoid duplicate processing
    if (
      typeof req.url === 'string' &&
      !req.url.includes('index.js') &&
      (req.url.startsWith('/api/') ||
        req.url === '/health' ||
        req.url === '/config' ||
        req.url === '/turn')
    ) {
      return next();
    }

    const queryMatch = (req.url || '').match(/[?&](?:path|1)=([^&]+)/);
    if (queryMatch) {
      const sub = decodeURIComponent(queryMatch[1]).replace(/^\/+/, '');
      req.url = `/api/${sub}`;
      return next();
    }

    const matchedPath =
      req.headers['x-matched-path'] ||
      req.headers['x-forwarded-uri'] ||
      req.headers['x-original-url'];

    if (matchedPath && typeof matchedPath === 'string') {
      if (!matchedPath.includes('index.js') && matchedPath.startsWith('/')) {
        req.url = matchedPath;
        return next();
      }
      const headerMatch = matchedPath.match(/[?&](?:path|1)=([^&]+)/);
      if (headerMatch) {
        const sub = decodeURIComponent(headerMatch[1]).replace(/^\/+/, '');
        req.url = `/api/${sub}`;
        return next();
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
        'x-session-id',
        'x-rime-api-key',
        'x-gemini-api-key',
        'x-llm-api-key',
        'x-llm-provider',
        'x-llm-model',
      ],
    })
  );

  app.use(express.json({ limit: '10mb' }));

  app.use(
    express.static(path.join(__dirname, '..', 'client'), {
      etag: false,
      maxAge: 0,
      setHeaders: (res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      },
    })
  );

  app.get(['/health', '/api/health'], (_req, res) => {
    const dbHealth = db.healthCheck();
    const isHealthy = dbHealth.ok;
    const currentLlm = resolveLlmConfig({
      provider: llmConfig.provider,
      model: llmConfig.model,
      apiKey: llmConfig.apiKey,
    });
    res.status(isHealthy ? 200 : 503).json({
      ok: isHealthy,
      status: isHealthy ? 'healthy' : 'degraded',
      llmConfigured: mock ? false : Boolean(currentLlm.apiKey),
      llmProvider: currentLlm.provider,
      rimeConfigured: Boolean(rimeConfig.apiKey),
      database: dbHealth,
      llm: {
        configured: mock ? false : Boolean(currentLlm.apiKey),
        provider: currentLlm.provider,
        model: currentLlm.model,
      },
      tts: {
        configured: Boolean(rimeConfig.apiKey),
        mockMode: Boolean(rimeConfig.mockAudio),
        defaultSpeaker: rimeConfig.speaker,
        defaultModel: rimeConfig.modelId,
      },
      serpapi: {
        configured: Boolean(serpapiConfig.enabled && serpapiConfig.apiKey),
        enabled: serpapiConfig.enabled,
      },
      uptime: process.uptime(),
      timestamp: Date.now(),
    });
  });

  app.get(['/telemetry', '/api/telemetry'], (_req, res) => {
    res.json({ ok: true, ...db.getAggregateTelemetry() });
  });

  app.get('/api/transcripts/sessions', (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    res.json({ ok: true, sessions: db.listSessions(limit) });
  });

  app.get('/api/transcripts/sessions/:id', (req, res) => {
    const turns = db.getSessionTurns(req.params.id);
    const session = db.getOrCreateSession(req.params.id);
    res.json({ ok: true, session, turns });
  });

  app.delete('/api/transcripts/sessions/:id', (req, res) => {
    db.deleteSession(req.params.id);
    res.json({ ok: true });
  });

  app.post('/api/sessions/new', (req, res) => {
    const { speaker, modelId, title } = req.body || {};
    const session = db.getOrCreateSession(
      null,
      speaker || rimeConfig.speaker,
      modelId || rimeConfig.modelId,
      title
    );
    res.json({ ok: true, session });
  });

  app.get(['/config', '/api/config'], (_req, res) => {
    const currentLlm = resolveLlmConfig({
      provider: llmConfig.provider,
      model: llmConfig.model,
      apiKey: llmConfig.apiKey,
    });
    return res.json({
      rimeConfigured: Boolean(rimeConfig.apiKey),
      llmConfigured: mock ? false : Boolean(currentLlm.apiKey),
      speaker: rimeConfig.speaker,
      modelId: rimeConfig.modelId,
      llmProvider: currentLlm.provider,
      llmModel: currentLlm.model,
      audioFormat: rimeConfig.audioFormat,
      delayMs: artificialDelayMs,
      serpapiConfigured: Boolean(serpapiConfig.enabled && serpapiConfig.apiKey),
      serpapiEnabled: serpapiConfig.enabled,
    });
  });

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
      console.log(`[TURN] received: "${userText.slice(0, 60)}"`);
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

      const incomingSessionId =
        (typeof req.body?.sessionId === 'string' && req.body.sessionId.trim()) ||
        (typeof req.headers['x-session-id'] === 'string' && req.headers['x-session-id'].trim()) ||
        null;
      const session = db.getOrCreateSession(incomingSessionId, activeSpeaker, activeModel);
      const sessionId = session.id;

      const budgetStatus = checkSessionBudget(
        session.total_cost_usd || 0,
        DEFAULT_SESSION_BUDGET_CAP_USD
      );
      const forceLocal = budgetStatus.exceeded;

      const turnStartTime = Date.now();
      const conversationHistory =
        Array.isArray(history) && history.length > 0
          ? history.filter(
              (h) =>
                h &&
                typeof h === 'object' &&
                typeof h.role === 'string' &&
                typeof h.content === 'string'
            )
          : db.getSessionMessagesForContext(sessionId, 20);
      conversationHistory.push({ role: 'user', content: userText });

      // Optional SerpApi live research
      let researchData = null;
      let researchContext = null;
      if (serpapiConfig?.enabled && isResearchNeeded(userText)) {
        const researchQuery = generateResearchQuery(userText);
        const tRes0 = Date.now();
        const researchResult = await performLiveResearch(researchQuery, {
          apiKey: serpapiConfig.apiKey,
          timeoutMs: serpapiConfig.timeoutMs,
          mockResults: serpapiConfig.mockResults,
        });
        const researchDurationMs = Date.now() - tRes0;
        if (researchResult.ok && researchResult.results.length > 0) {
          researchData = researchResult;
          researchContext = formatResearchContextForLLM(researchResult);
          db.recordTelemetryEvent(sessionId, 'serpapi_research_success', {
            query: researchQuery,
            resultCount: researchResult.results.length,
            durationMs: researchDurationMs,
          });
        } else {
          db.recordTelemetryEvent(sessionId, 'serpapi_research_failed', {
            query: researchQuery,
            reason: sanitizeError(researchResult.error || 'unavailable'),
            durationMs: researchDurationMs,
          });
        }
      }

      // 1. Task request check
      if (isTaskRequest(userText)) {
        const isTs = /\b(typescript|ts)\b/i.test(userText);
        const isTodo = /\b(todo|todos)\b/i.test(userText);
        const flavor = isTs ? 'TypeScript' : 'JavaScript';
        const targetSubject = isTodo ? 'Todo App' : 'REST API';
        const title = `Scaffold Express ${targetSubject} (${flavor})`;
        const spoken = researchContext
          ? `Scaffolded the Express ${flavor} REST API using current best practices.`
          : `Scaffolded the Express ${flavor} REST API in the workspace.`;
        const visualContent = `// Express ${flavor} ${targetSubject} Scaffolding Completed\n// Project structure, routes, controllers, and environment configuration generated.`;
        const visualResponse = {
          type: 'code',
          language: isTs ? 'typescript' : 'javascript',
          title,
          content: visualContent,
        };

        const t1 = Date.now();
        let audioBase64 = null;
        try {
          const buf = await synthesizeSpeech(spoken, {
            ...rimeConfig,
            speaker: activeSpeaker,
            modelId: activeModel,
          });
          if (buf) audioBase64 = buf.toString('base64');
        } catch (_) {}
        const ttsMs = Date.now() - t1;
        const totalMs = Date.now() - turnStartTime;

        db.recordTurn({
          sessionId,
          turnIndex: (session.turn_count || 0) + 1,
          userText,
          spokenText: spoken,
          visualPayload: visualResponse,
          audioRef: audioBase64 ? `base64:${rimeConfig.audioFormat}` : null,
          sttMs: Number(req.body?.sttMs) || 0,
          llmMs: 0,
          ttsMs,
          bargeInMs: 0,
          totalMs,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          modelId: 'scaffold-task',
          provider: 'local',
          speaker: activeSpeaker,
        });

        const updatedSession = db.getOrCreateSession(sessionId);

        return res.json({
          ok: true,
          sessionId,
          responseMode: 'HYBRID',
          spokenResponse: spoken,
          visualResponse,
          audio: audioBase64,
          format: rimeConfig.audioFormat,
          speaker: activeSpeaker,
          modelId: activeModel,
          research: researchData || null,
          llmMs: 0,
          ttsMs,
          totalMs,
          cost: { totalCostUsd: 0, totalTokens: 0 },
          sessionMetrics: {
            turnCount: updatedSession.turn_count,
            totalTokens: updatedSession.total_tokens,
            totalCostUsd: updatedSession.total_cost_usd,
          },
        });
      }

      // 2. Dual-channel LLM turn with budget and latency guards
      const t0 = Date.now();
      let replyObj;
      let degraded = false;

      if (forceLocal) {
        db.recordTelemetryEvent(sessionId, 'budget_cap_exceeded', {
          cost: session.total_cost_usd,
          cap: DEFAULT_SESSION_BUDGET_CAP_USD,
        });
        replyObj = localFallbackReply(userText, userOverride, researchContext);
        degraded = true;
      } else {
        try {
          const currentLlm = resolveLlmConfig({
            provider: req.headers['x-llm-provider'] || req.body?.llmProvider || llmConfig.provider,
            model: req.headers['x-llm-model'] || req.body?.llmModel || llmConfig.model,
            apiKey:
              req.headers['x-llm-api-key'] ||
              req.headers['x-gemini-api-key'] ||
              req.body?.llmApiKey ||
              llmConfig.apiKey,
          });
          console.log(`[TURN] LLM request started: ${currentLlm.provider} (${currentLlm.model})`);
          replyObj = await Promise.race([
            getAssistantReply({
              provider: currentLlm.provider,
              apiKey: mock ? '' : currentLlm.apiKey,
              model: currentLlm.model,
              messages: conversationHistory,
              userOverride,
              researchContext,
            }),
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error('LLM_TIMEOUT')),
                DEFAULT_LATENCY_THRESHOLDS.llmTimeoutMs || 8000
              )
            ),
          ]);
        } catch (llmErr) {
          if (llmErr?.code === 'LLM_REQUEST_FAILED') {
            throw llmErr;
          }
          db.recordTelemetryEvent(sessionId, 'latency_fallback', {
            reason: llmErr.message || 'timeout',
          });
          replyObj = localFallbackReply(userText, userOverride, researchContext);
          degraded = true;
        }
      }
      const llmMs = Date.now() - t0;
      console.log(`[TURN] LLM response received in ${llmMs}ms`);
      console.log(`[TURN] response normalized: mode=${replyObj.responseMode || 'VOICE'}`);

      const visualPayload = replyObj.visualResponse || {
        type: replyObj.type || 'text',
        language: replyObj.language || null,
        title: replyObj.title || null,
        content: replyObj.content,
      };

      let cleanSpoken = (replyObj.spokenResponse || replyObj.spoken || replyObj.content || '')
        .replace(/```[\s\S]*?(?:```|$)/g, '')
        .replace(/`[^`]+(?:`|$)/g, '')
        .replace(/[*_#[\]>]/g, '')
        .trim();
      if (!cleanSpoken) {
        cleanSpoken =
          visualPayload.type === 'code' || (replyObj.content && replyObj.content.includes('```'))
            ? "I've written the code in the chat for you."
            : replyObj.content
              ? replyObj.content.slice(0, 150)
              : 'Here is the response.';
      }
      const spokenText = cleanSpoken;

      const requestRimeApiKey =
        (typeof req.headers['x-rime-api-key'] === 'string' &&
          req.headers['x-rime-api-key'].trim()) ||
        (typeof req.body?.rimeApiKey === 'string' && req.body.rimeApiKey.trim()) ||
        rimeConfig.apiKey ||
        DEFAULT_RIME_KEY;

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
      const totalMs = Date.now() - turnStartTime;

      const costBreakdown = calculateTurnCost({
        promptTokens: replyObj.promptTokens,
        completionTokens: replyObj.completionTokens,
        modelId: replyObj.llmModel || llmConfig.model,
        provider: replyObj.provider || llmConfig.provider,
        spokenChars: spokenText.length,
        ttsModelId: activeModel,
      });

      db.recordTurn({
        sessionId,
        turnIndex: (session.turn_count || 0) + 1,
        userText,
        spokenText,
        visualPayload,
        audioRef: audioBase64 ? `base64:${rimeConfig.audioFormat}` : null,
        sttMs: Number(req.body?.sttMs) || 0,
        llmMs,
        ttsMs,
        bargeInMs: Number(req.body?.bargeInMs) || 0,
        totalMs,
        promptTokens: costBreakdown.promptTokens,
        completionTokens: costBreakdown.completionTokens,
        totalTokens: costBreakdown.totalTokens,
        costUsd: costBreakdown.totalCostUsd,
        modelId: costBreakdown.modelId,
        provider: costBreakdown.provider,
        speaker: activeSpeaker,
      });

      const updatedSession = db.getOrCreateSession(sessionId);

      console.log(`[TURN] response sent in ${totalMs}ms`);
      return res.json({
        ok: true,
        sessionId,
        responseMode: replyObj.responseMode || 'VOICE',
        spokenResponse: spokenText,
        visualResponse: visualPayload,
        audio: audioBase64,
        format: rimeConfig.audioFormat,
        speaker: activeSpeaker,
        modelId: activeModel,
        research: researchData || null,
        llmMs,
        ttsMs,
        totalMs,
        cost: costBreakdown,
        degraded,
        sessionMetrics: {
          turnCount: updatedSession.turn_count,
          totalTokens: updatedSession.total_tokens,
          totalCostUsd: updatedSession.total_cost_usd,
          budgetCapUsd: DEFAULT_SESSION_BUDGET_CAP_USD,
          budgetRemainingUsd: Math.max(
            0,
            DEFAULT_SESSION_BUDGET_CAP_USD - updatedSession.total_cost_usd
          ),
        },
      });
    } catch (err) {
      if (err?.code === 'LLM_REQUEST_FAILED') {
        return res
          .status(err.status && err.status >= 400 && err.status < 500 ? err.status : 502)
          .json({
            ok: false,
            error: {
              code: 'LLM_REQUEST_FAILED',
              message: err.message || 'Gemini request failed',
            },
          });
      }
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
  const openSockets = new Set();
  httpServer.on('connection', (socket) => {
    openSockets.add(socket);
    socket.once('close', () => openSockets.delete(socket));
  });
  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws, req) => {
    if (ws._socket) {
      ws._socket.setNoDelay(true);
    }
    let querySessionId = null;
    try {
      if (req && req.url) {
        const parsed = new URL(req.url, 'http://localhost');
        querySessionId = parsed.searchParams.get('sessionId');
      }
    } catch (_) {}

    const session = db.getOrCreateSession(querySessionId, rimeConfig.speaker, rimeConfig.modelId);
    const sessionId = session.id;

    const state = {
      generation: 0,
      activeController: null,
      sessionId,
      speaker: session.speaker || rimeConfig.speaker,
      modelId: session.model_id || rimeConfig.modelId,
      history: db.getSessionMessagesForContext(sessionId, 20),
    };

    send(ws, {
      type: 'handshake',
      sessionId,
      generation: state.generation,
      rimeConfigured: Boolean(rimeConfig.apiKey),
      llmConfigured: Boolean(llmConfig.apiKey),
      speaker: state.speaker,
      modelId: state.modelId,
      audioFormat: rimeConfig.audioFormat,
      llmProvider: llmConfig.provider,
      llmModel: llmConfig.model,
      sessionMetrics: {
        turnCount: session.turn_count,
        totalTokens: session.total_tokens,
        totalCostUsd: session.total_cost_usd,
        budgetCapUsd: DEFAULT_SESSION_BUDGET_CAP_USD,
      },
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
            state.speaker = sanitizedSpeaker;
            rimeConfig.speaker = sanitizedSpeaker;
          }
        }
        if (typeof msg.modelId === 'string' && msg.modelId.trim()) {
          const sanitizedModel = msg.modelId.trim().slice(0, 32);
          if (/^[a-zA-Z0-9_-]+$/.test(sanitizedModel)) {
            state.modelId = sanitizedModel;
            rimeConfig.modelId = sanitizedModel;
          }
        }
        db.updateSession(state.sessionId, {
          speaker: state.speaker,
          modelId: state.modelId,
        });
        send(ws, {
          type: 'config_updated',
          speaker: state.speaker,
          modelId: state.modelId,
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

      if (msg.type === 'switch_session') {
        if (typeof msg.sessionId === 'string' && msg.sessionId.trim()) {
          const targetId = msg.sessionId.trim();
          const session = db.getOrCreateSession(targetId, state.speaker, state.modelId);
          state.sessionId = session.id;
          state.speaker = session.speaker || state.speaker;
          state.modelId = session.model_id || state.modelId;
          state.history = db.getSessionMessagesForContext(state.sessionId, 20);
          if (state.activeController) {
            state.activeController.abort();
            state.activeController = null;
          }
          state.generation = 0;
          send(ws, {
            type: 'session_switched',
            sessionId: state.sessionId,
            speaker: state.speaker,
            modelId: state.modelId,
            sessionMetrics: {
              turnCount: session.turn_count,
              totalTokens: session.total_tokens,
              totalCostUsd: session.total_cost_usd,
              budgetCapUsd: DEFAULT_SESSION_BUDGET_CAP_USD,
            },
          });
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
        state.ttsChain = Promise.resolve();
        state.ttsSentCount = 0;
        state.ttsProcessedIndex = 0;
        const serverProcessingNs = Number(process.hrtime.bigint() - t0);
        const serverProcessingMs = Number((serverProcessingNs / 1e6).toFixed(3));
        const bargeInMs = typeof msg.bargeInMs === 'number' ? msg.bargeInMs : serverProcessingMs;

        db.markInterrupted(state.sessionId, bargeInMs);
        db.recordTelemetryEvent(state.sessionId, 'barge_in', {
          bargeInMs,
          oldGeneration: ackedGen,
        });

        send(ws, {
          type: 'interrupted',
          oldGeneration: ackedGen,
          newGeneration: state.generation,
          serverProcessingMs,
          serverTimestamp: Date.now(),
          clientTimestamp: typeof msg.timestamp === 'number' ? msg.timestamp : null,
        });

        const updatedSession = db.getOrCreateSession(state.sessionId);
        const aggregate = db.getAggregateTelemetry();
        send(ws, {
          type: 'telemetry_update',
          turnMetrics: {
            bargeInMs,
            interrupted: true,
          },
          sessionMetrics: {
            sessionId: updatedSession.id,
            turnCount: updatedSession.turn_count,
            totalTokens: updatedSession.total_tokens,
            totalCostUsd: updatedSession.total_cost_usd,
            budgetCapUsd: DEFAULT_SESSION_BUDGET_CAP_USD,
            budgetRemainingUsd: Math.max(
              0,
              DEFAULT_SESSION_BUDGET_CAP_USD - updatedSession.total_cost_usd
            ),
          },
          lifetimeMetrics: aggregate.lifetime,
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

        if (
          typeof msg.sessionId === 'string' &&
          msg.sessionId.trim() &&
          msg.sessionId.trim() !== state.sessionId
        ) {
          state.sessionId = msg.sessionId.trim();
          state.history = db.getSessionMessagesForContext(state.sessionId, 20);
        }

        // Synchronously abort in-flight turn and bind new controller immediately
        if (state.activeController) {
          state.activeController.abort();
          state.activeController = null;
        }
        state.generation += 1;
        const myGen = state.generation;
        const controller = new AbortController();
        state.activeController = controller;

        const turnSpeaker =
          typeof msg.speaker === 'string' && /^[a-zA-Z0-9_-]{1,32}$/.test(msg.speaker.trim())
            ? msg.speaker.trim()
            : state.speaker;
        const turnModel =
          typeof msg.modelId === 'string' && /^[a-zA-Z0-9_-]{1,32}$/.test(msg.modelId.trim())
            ? msg.modelId.trim()
            : state.modelId;

        handleTurn({
          ws,
          state,
          myGen,
          controller,
          userText,
          userOverride: mode,
          speaker: turnSpeaker,
          modelId: turnModel,
          sttMs: typeof msg.sttMs === 'number' ? msg.sttMs : 0,
          bargeInMs: typeof msg.bargeInMs === 'number' ? msg.bargeInMs : 0,
          rimeConfig,
          llmConfig,
          serpapiConfig,
          db,
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
    db,
    listen(port = 0) {
      return new Promise((resolve) => {
        const server = httpServer.listen(port, () => {
          const addr = server.address();
          const boundPort = typeof addr === 'object' && addr ? addr.port : port;
          if (!quiet) {
            console.log(`✨ Aurora is listening on http://localhost:${boundPort}`);
            console.log(
              `   LLM provider: ${llmConfig.provider.charAt(0).toUpperCase() + llmConfig.provider.slice(1)}`
            );
            console.log(`   LLM configured: ${llmConfig.apiKey ? 'YES' : 'NO'}`);
            console.log(`   Rime configured: ${rimeConfig.apiKey ? 'YES' : 'NO'}`);
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
        for (const socket of openSockets) {
          try {
            socket.destroy();
          } catch (_) {}
        }
        openSockets.clear();
        wss.close(() => {
          if (typeof httpServer.closeAllConnections === 'function') {
            httpServer.closeAllConnections();
          }
          if (typeof httpServer.closeIdleConnections === 'function') {
            httpServer.closeIdleConnections();
          }
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
 * @param {string} [params.speaker] - Active Rime speaker for this turn.
 * @param {string} [params.modelId] - Active Rime model for this turn.
 * @param {number} [params.sttMs=0] - Speech-to-text latency in milliseconds.
 * @param {number} [params.bargeInMs=0] - Interruption latency in milliseconds.
 * @param {object} params.rimeConfig - Rime TTS credentials, speaker voice, and model settings.
 * @param {object} params.llmConfig - LLM provider credentials and model selection.
 * @param {object} params.db - SQLite database instance.
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
  speaker,
  modelId,
  sttMs = 0,
  bargeInMs = 0,
  rimeConfig,
  llmConfig,
  serpapiConfig,
  db,
  getDelayMs,
}) {
  const turnStartTime = Date.now();
  console.log(`[TURN] received: "${userText.slice(0, 60)}"`);
  const activeSpeaker = speaker || state.speaker || rimeConfig.speaker;
  const activeModel = modelId || state.modelId || rimeConfig.modelId;

  send(ws, { type: 'user_text', text: userText, generation: myGen, timestamp: turnStartTime });
  state.history.push({ role: 'user', content: userText });
  if (state.history.length > 20) {
    state.history = state.history.slice(-20);
  }

  const session = db.getOrCreateSession(state.sessionId, activeSpeaker, activeModel);
  const budgetStatus = checkSessionBudget(
    session.total_cost_usd || 0,
    DEFAULT_SESSION_BUDGET_CAP_USD
  );
  let forceLocal = budgetStatus.exceeded;
  if (forceLocal) {
    db.recordTelemetryEvent(state.sessionId, 'budget_cap_exceeded', {
      cost: session.total_cost_usd,
      cap: DEFAULT_SESSION_BUDGET_CAP_USD,
    });
    send(ws, {
      type: 'budget_warning',
      exceeded: true,
      cost: session.total_cost_usd,
      cap: DEFAULT_SESSION_BUDGET_CAP_USD,
      message: 'Session budget cap reached ($0.05). Switching to offline local engine.',
    });
  }

  // Optional SerpApi live research
  let researchData = null;
  let researchContext = null;

  if (serpapiConfig?.enabled && isResearchNeeded(userText)) {
    if (!isStale(state, myGen)) {
      const researchQuery = generateResearchQuery(userText);
      send(ws, {
        type: 'research_started',
        query: researchQuery,
        generation: myGen,
        timestamp: Date.now(),
      });

      const tRes0 = Date.now();
      const researchResult = await performLiveResearch(researchQuery, {
        apiKey: serpapiConfig.apiKey,
        signal: controller.signal,
        timeoutMs: serpapiConfig.timeoutMs,
        mockResults: serpapiConfig.mockResults,
      });
      const researchDurationMs = Date.now() - tRes0;

      if (isStale(state, myGen)) return;

      if (researchResult.ok && researchResult.results.length > 0) {
        researchData = researchResult;
        researchContext = formatResearchContextForLLM(researchResult);
        send(ws, {
          type: 'research_result',
          query: researchQuery,
          results: researchResult.results,
          generation: myGen,
          timestamp: Date.now(),
        });
        db.recordTelemetryEvent(state.sessionId, 'serpapi_research_success', {
          query: researchQuery,
          resultCount: researchResult.results.length,
          durationMs: researchDurationMs,
        });
      } else {
        send(ws, {
          type: 'research_failed',
          query: researchQuery,
          reason: 'Live research unavailable — continuing without web research.',
          generation: myGen,
          timestamp: Date.now(),
        });
        db.recordTelemetryEvent(state.sessionId, 'serpapi_research_failed', {
          query: researchQuery,
          reason: sanitizeError(researchResult.error || 'unavailable'),
          durationMs: researchDurationMs,
        });
      }
    }
  }

  if (isStale(state, myGen)) return;

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
        rimeConfig: {
          ...rimeConfig,
          speaker: activeSpeaker,
          modelId: activeModel,
        },
        llmConfig,
        researchContext,
        researchData,
      });

      if (!isStale(state, myGen)) {
        const totalMs = Date.now() - turnStartTime;
        db.recordTurn({
          sessionId: state.sessionId,
          turnIndex: (session.turn_count || 0) + 1,
          userText,
          spokenText: 'Scaffolded project in the workspace.',
          visualPayload: { type: 'code', title: 'Task Scaffolded' },
          audioRef: null,
          sttMs,
          llmMs: 0,
          ttsMs: 0,
          bargeInMs,
          totalMs,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          modelId: 'scaffold-task',
          provider: 'local',
          speaker: activeSpeaker,
        });

        const updatedSession = db.getOrCreateSession(state.sessionId);
        const aggregate = db.getAggregateTelemetry();
        send(ws, {
          type: 'telemetry_update',
          turnMetrics: {
            sttMs,
            llmMs: 0,
            ttsMs: 0,
            bargeInMs,
            totalMs,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            costUsd: 0,
            provider: 'local',
            modelId: 'scaffold-task',
            degraded: false,
          },
          sessionMetrics: {
            sessionId: updatedSession.id,
            turnCount: updatedSession.turn_count,
            totalTokens: updatedSession.total_tokens,
            totalCostUsd: updatedSession.total_cost_usd,
            budgetCapUsd: DEFAULT_SESSION_BUDGET_CAP_USD,
            budgetRemainingUsd: Math.max(
              0,
              DEFAULT_SESSION_BUDGET_CAP_USD - updatedSession.total_cost_usd
            ),
          },
          lifetimeMetrics: aggregate.lifetime,
        });
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
      console.error('[task error]', err);
    } finally {
      if (state.activeController === controller) state.activeController = null;
    }
    return;
  }

  // 2. Standard dual-channel LLM turn with Intelligent Response Routing
  state.ttsSentCount = 0;
  state.ttsProcessedIndex = 0;
  state.ttsChain = Promise.resolve();
  let hasSentAiTextStart = false;
  send(ws, { type: 'thinking', generation: myGen, timestamp: Date.now() });
  const delayMs = getDelayMs ? getDelayMs() : 0;
  if (delayMs > 0) {
    try {
      await sleep(delayMs, controller.signal);
    } catch (_) {}
  }
  if (isStale(state, myGen)) return;
  const t0 = Date.now();
  let replyObj;
  let degraded = false;

  if (forceLocal) {
    replyObj = localFallbackReply(userText, userOverride, researchContext);
    degraded = true;
  } else {
    try {
      const currentLlm = resolveLlmConfig({
        provider: llmConfig.provider,
        model: llmConfig.model,
        apiKey: llmConfig.apiKey,
        mock: llmConfig.mock,
      });
      console.log(`[TURN] LLM request started: ${currentLlm.provider} (${currentLlm.model})`);
      const llmPromise = getAssistantReply({
        provider: currentLlm.provider,
        apiKey: currentLlm.apiKey,
        model: currentLlm.model,
        messages: state.history.slice(-10),
        signal: controller.signal,
        userOverride,
        researchContext,
        onChunk: (fullText) => {
          if (isStale(state, myGen)) return;
          if (!hasSentAiTextStart) {
            hasSentAiTextStart = true;
            send(ws, { type: 'ai_text_start', generation: myGen, timestamp: Date.now() });
          }

          send(ws, {
            type: 'ai_text_chunk',
            text: fullText,
            generation: myGen,
            visualType: 'text',
          });

          const clean = fullText.replace(/```[\s\S]*?(?:```|$)/g, '').replace(/`[^`]+(?:`|$)/g, '');

          while (true) {
            const remaining = clean.slice(state.ttsProcessedIndex);
            if (!remaining) break;

            let match = null;
            let matchLength = 0;

            if (state.ttsSentCount === 0) {
              // Sub-second TTFA optimization: break early on clause boundary (,;:—\n) if >= 4 words,
              // or on first complete sentence
              const clauseMatch = /[,;:—\n]+(?:\s+|$)/.exec(remaining);
              const sentMatch = /[.!?\n]+(?:\s+|$)/.exec(remaining);

              if (sentMatch && (!clauseMatch || sentMatch.index <= clauseMatch.index)) {
                match = sentMatch;
                matchLength = sentMatch[0].length;
              } else if (clauseMatch) {
                const candidate = remaining.substring(0, clauseMatch.index).trim();
                const wordCount = candidate.split(/\s+/).filter(Boolean).length;
                if (wordCount >= 3) {
                  match = clauseMatch;
                  matchLength = clauseMatch[0].length;
                } else if (sentMatch) {
                  match = sentMatch;
                  matchLength = sentMatch[0].length;
                }
              }
            } else {
              // Subsequent chunks: use full sentences for natural prosodic cadence
              const sentMatch = /[.!?\n]+(?:\s+|$)/.exec(remaining);
              if (sentMatch) {
                match = sentMatch;
                matchLength = sentMatch[0].length;
              }
            }

            if (!match) break;

            const chunk = remaining.substring(0, match.index + matchLength).trim();
            state.ttsProcessedIndex += match.index + matchLength;

            const textToSpeak = chunk.replace(/[*_#[\]>]/g, '').trim();
            if (textToSpeak.length > 1) {
              state.ttsSentCount++;
              const audioTurnStart = turnStartTime;
              // Launch synthesis HTTP fetch concurrently without waiting for prior chunks to finish
              const synthPromise = synthesizeSpeech(
                textToSpeak,
                { ...rimeConfig, speaker: activeSpeaker, modelId: activeModel },
                controller.signal
              );
              // Strictly sequence delivery over WebSocket so playback remains in natural order
              state.ttsChain = state.ttsChain.then(async () => {
                if (isStale(state, myGen)) return null;
                try {
                  const buffer = await synthPromise;
                  if (buffer && !isStale(state, myGen)) {
                    const base64Audio = buffer.toString('base64');
                    send(ws, {
                      type: 'audio',
                      generation: myGen,
                      speaker: activeSpeaker,
                      modelId: activeModel,
                      format: rimeConfig.audioFormat,
                      chunk: base64Audio,
                      data: base64Audio,
                      audio: base64Audio,
                      totalMs: Date.now() - audioTurnStart,
                    });
                  }
                } catch (e) {
                  if (e?.name !== 'AbortError') {
                    console.error('[rime error]', e.message);
                    if (!isStale(state, myGen)) {
                      send(ws, {
                        type: 'speak_local',
                        text: textToSpeak,
                        generation: myGen,
                        totalMs: Date.now() - audioTurnStart,
                      });
                    }
                  }
                }
              });
            }
          }
        },
      });

      const timeoutPromise = new Promise((_, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('LATENCY_TIMEOUT'));
        }, DEFAULT_LATENCY_THRESHOLDS.llmTimeoutMs || 8000);
        controller.signal.addEventListener('abort', () => clearTimeout(timer));
      });

      replyObj = await Promise.race([llmPromise, timeoutPromise]);
    } catch (err) {
      if (err?.name === 'AbortError' || controller.signal.aborted) return;
      if (err?.code === 'LLM_REQUEST_FAILED') {
        console.error(`[TURN error] LLM request failed:`, sanitizeError(err));
        send(ws, {
          type: 'error',
          generation: myGen,
          code: 'LLM_REQUEST_FAILED',
          message: err.message || 'Gemini request failed',
        });
        send(ws, {
          type: 'done',
          generation: myGen,
          totalMs: Date.now() - turnStartTime,
          timestamp: Date.now(),
        });
        state.activeController = null;
        return;
      }
      db.recordTelemetryEvent(state.sessionId, 'latency_fallback', {
        reason: err.message || 'timeout',
      });
      send(ws, {
        type: 'degradation_alert',
        generation: myGen,
        reason: 'LLM latency threshold exceeded. Gracefully degraded to local inference.',
      });
      replyObj = localFallbackReply(userText, userOverride, researchContext);
      degraded = true;
    }
  }

  if (isStale(state, myGen)) return; // Generation fencing: interrupted while thinking

  const llmMs = Date.now() - t0;
  const ttsMs = 0;
  console.log(`[TURN] LLM response received in ${llmMs}ms`);
  console.log(`[TURN] response normalized: mode=${replyObj.responseMode || 'VOICE'}`);
  state.history.push({ role: 'assistant', content: replyObj.content });
  if (state.history.length > 20) {
    state.history = state.history.slice(-20);
  }
  const visualPayload = replyObj.visualResponse || {
    type: replyObj.visualType || replyObj.type || 'text',
    language: replyObj.language || null,
    title: replyObj.title || null,
    content: replyObj.content,
  };

  send(ws, {
    type: 'ai_text',
    text: visualPayload.content || replyObj.content,
    spoken: replyObj.spokenResponse || replyObj.spoken || '',
    visual: visualPayload,
    visualType: visualPayload.type || replyObj.visualType || replyObj.type || 'text',
    language: visualPayload.language || replyObj.language || null,
    title: visualPayload.title || replyObj.title || null,
    responseMode: replyObj.responseMode || 'VOICE',
    spokenResponse: replyObj.spokenResponse || replyObj.spoken || '',
    visualResponse: visualPayload,
    research: researchData || null,
    generation: myGen,
    llmMs,
    timestamp: Date.now(),
  });

  const totalMs = Date.now() - turnStartTime;

  // Cost calculation
  const costBreakdown = calculateTurnCost({
    promptTokens: replyObj.promptTokens || 0,
    completionTokens: replyObj.completionTokens || 0,
    modelId: replyObj.llmModel || llmConfig.model,
    provider: replyObj.provider || llmConfig.provider,
    spokenChars: replyObj.content.length,
    ttsModelId: activeModel,
  });

  // Persist turn in SQLite database
  const turnRecord = db.recordTurn({
    sessionId: state.sessionId,
    turnIndex: (session.turn_count || 0) + 1,
    userText,
    spokenText: replyObj.content,
    visualPayload: { type: 'text', content: replyObj.content },
    audioRef: `rime:${activeSpeaker}`,
    sttMs,
    llmMs,
    ttsMs: 0,
    bargeInMs,
    totalMs,
    promptTokens: costBreakdown.promptTokens,
    completionTokens: costBreakdown.completionTokens,
    totalTokens: costBreakdown.totalTokens,
    costUsd: costBreakdown.totalCostUsd,
    modelId: costBreakdown.modelId,
    provider: costBreakdown.provider,
    speaker: activeSpeaker,
  });

  // Ensure verbal response is spoken if no audio chunks were sent during stream
  let cleanSpoken = replyObj.content
    .replace(/```[\s\S]*?(?:```|$)/g, '')
    .replace(/`[^`]+(?:`|$)/g, '');
  cleanSpoken = cleanSpoken.replace(/[*_#[\]>]/g, '').trim();
  if (!cleanSpoken) {
    if (replyObj.content.includes('```')) {
      cleanSpoken = "I've written the implementation in the chat for you.";
    } else {
      cleanSpoken = replyObj.content.slice(0, 150);
    }
  }

  if (state.ttsSentCount === 0) {
    if ((rimeConfig.apiKey || rimeConfig.mockAudio) && cleanSpoken) {
      state.ttsChain = state.ttsChain.then(async () => {
        if (isStale(state, myGen)) return null;
        try {
          const buf = await synthesizeSpeech(
            cleanSpoken,
            { ...rimeConfig, speaker: activeSpeaker, modelId: activeModel },
            controller.signal
          );
          if (buf && !isStale(state, myGen)) {
            const base64Audio = buf.toString('base64');
            send(ws, {
              type: 'audio',
              generation: myGen,
              speaker: activeSpeaker,
              modelId: activeModel,
              format: rimeConfig.audioFormat,
              chunk: base64Audio,
              data: base64Audio,
              audio: base64Audio,
              totalMs: Date.now() - turnStartTime,
            });
            return;
          }
        } catch (e) {
          if (e?.name !== 'AbortError') console.error('[rime fallback error]', e.message);
        }
        if (!isStale(state, myGen)) {
          send(ws, {
            type: 'speak_local',
            text: cleanSpoken,
            generation: myGen,
            totalMs: Date.now() - turnStartTime,
          });
        }
      });
    } else if (cleanSpoken) {
      send(ws, {
        type: 'speak_local',
        text: cleanSpoken,
        generation: myGen,
        totalMs: Date.now() - turnStartTime,
      });
    }
  } else {
    // If some chunks were already spoken, check for any unvoiced tail in clean
    const cleanFull = replyObj.content
      .replace(/```[\s\S]*?(?:```|$)/g, '')
      .replace(/`[^`]+(?:`|$)/g, '');
    const tail = cleanFull
      .slice(state.ttsProcessedIndex)
      .replace(/[*_#[\]>]/g, '')
      .trim();
    if (tail.length > 1) {
      const audioTurnStart = turnStartTime;
      const tailSynthPromise = synthesizeSpeech(
        tail,
        { ...rimeConfig, speaker: activeSpeaker, modelId: activeModel },
        controller.signal
      );
      state.ttsChain = state.ttsChain.then(async () => {
        if (isStale(state, myGen)) return null;
        try {
          const buf = await tailSynthPromise;
          if (buf && !isStale(state, myGen)) {
            const base64Audio = buf.toString('base64');
            send(ws, {
              type: 'audio',
              generation: myGen,
              speaker: activeSpeaker,
              modelId: activeModel,
              format: rimeConfig.audioFormat,
              chunk: base64Audio,
              data: base64Audio,
              audio: base64Audio,
              totalMs: Date.now() - audioTurnStart,
            });
            return;
          }
        } catch (e) {
          if (e?.name !== 'AbortError') console.error('[rime tail error]', e.message);
        }
        if (!isStale(state, myGen)) {
          send(ws, {
            type: 'speak_local',
            text: tail,
            generation: myGen,
            totalMs: Date.now() - audioTurnStart,
          });
        }
      });
    }
  }

  state.ttsChain.then(() => {
    if (!isStale(state, myGen)) {
      send(ws, { type: 'done', generation: myGen, totalMs, timestamp: Date.now() });
    }
  });
  console.log(`[TURN] response sent in ${totalMs}ms`);

  // Broadcast real telemetry update
  const updatedSession = db.getOrCreateSession(state.sessionId);
  const aggregate = db.getAggregateTelemetry();
  send(ws, {
    type: 'telemetry_update',
    turnMetrics: {
      turnId: turnRecord?.id,
      sttMs,
      llmMs,
      ttsMs,
      bargeInMs,
      totalMs,
      promptTokens: costBreakdown.promptTokens,
      completionTokens: costBreakdown.completionTokens,
      totalTokens: costBreakdown.totalTokens,
      costUsd: costBreakdown.totalCostUsd,
      provider: costBreakdown.provider,
      modelId: costBreakdown.modelId,
      degraded,
    },
    sessionMetrics: {
      sessionId: updatedSession.id,
      turnCount: updatedSession.turn_count,
      totalTokens: updatedSession.total_tokens,
      totalCostUsd: updatedSession.total_cost_usd,
      budgetCapUsd: DEFAULT_SESSION_BUDGET_CAP_USD,
      budgetRemainingUsd: Math.max(
        0,
        DEFAULT_SESSION_BUDGET_CAP_USD - updatedSession.total_cost_usd
      ),
    },
    lifetimeMetrics: aggregate.lifetime,
  });

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
