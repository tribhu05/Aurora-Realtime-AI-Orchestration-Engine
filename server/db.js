/**
 * @file server/db.js
 * High-performance, zero-dependency SQLite persistence layer for Aurora.
 * Uses Node.js built-in `node:sqlite` (DatabaseSync) to store:
 * 1. Conversation sessions and cross-session memory summaries.
 * 2. Real conversation turns with per-turn latency breakdowns, tokens, and costs.
 * 3. Telemetry events (barge-in interrupts, budget limits, fallbacks).
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolves the appropriate database file path based on runtime environment.
 * Uses /tmp/aurora.db when running in serverless environments (e.g. Vercel)
 * where the application root is read-only.
 *
 * @param {string} [customPath] - Optional explicit database path override.
 * @returns {string} Absolute path to the SQLite database file.
 */
export function getDbPath(customPath) {
  if (customPath) return customPath;
  if (process.env.AURORA_DB_PATH) return process.env.AURORA_DB_PATH;
  if (process.env.VERCEL) return '/tmp/aurora.db';
  return path.join(__dirname, '..', 'data', 'aurora.db');
}

/**
 * Initializes and manages SQLite database connections and statements.
 */
export class AuroraDatabase {
  /**
   * @param {string} [dbPath] - Database path or ':memory:' for tests.
   */
  constructor(dbPath) {
    this.dbPath = getDbPath(dbPath);
    this.isMemory = this.dbPath === ':memory:';

    if (!this.isMemory) {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new DatabaseSync(this.dbPath);
    this.initSchema();
  }

  /**
   * Creates core tables and indices.
   */
  initSchema() {
    this.db.exec('PRAGMA foreign_keys = ON;');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        total_turns INTEGER DEFAULT 0,
        total_prompt_tokens INTEGER DEFAULT 0,
        total_completion_tokens INTEGER DEFAULT 0,
        total_cost_usd REAL DEFAULT 0.0,
        active_speaker TEXT DEFAULT 'astra',
        active_model TEXT DEFAULT 'mistv3',
        summary TEXT DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS turns (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        generation INTEGER NOT NULL,
        role TEXT NOT NULL,
        user_text TEXT,
        assistant_text TEXT,
        spoken_text TEXT,
        response_mode TEXT,
        visual_type TEXT,
        visual_title TEXT,
        stt_ms REAL DEFAULT 0.0,
        llm_ms REAL DEFAULT 0.0,
        tts_ms REAL DEFAULT 0.0,
        barge_in_ms REAL DEFAULT 0.0,
        total_ms REAL DEFAULT 0.0,
        prompt_tokens INTEGER DEFAULT 0,
        completion_tokens INTEGER DEFAULT 0,
        cost_usd REAL DEFAULT 0.0,
        speaker TEXT,
        model_id TEXT,
        llm_model TEXT,
        interrupted INTEGER DEFAULT 0,
        fallback_used TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS telemetry_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        event_type TEXT NOT NULL,
        data_json TEXT,
        timestamp INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_telemetry_timestamp ON telemetry_events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
    `);
  }

  /**
   * Retrieves an existing session or creates a new one.
   *
   * @param {string} [sessionId] - Target session UUID.
   * @param {string} [speaker='astra'] - Default voice speaker.
   * @param {string} [model='mistv3'] - Default voice model.
   */
  formatSession(row) {
    if (!row) return null;
    return {
      ...row,
      speaker: row.active_speaker,
      model_id: row.active_model,
      modelId: row.active_model,
      turn_count: row.total_turns,
      turnCount: row.total_turns,
      total_tokens: (row.total_prompt_tokens || 0) + (row.total_completion_tokens || 0),
      totalTokens: (row.total_prompt_tokens || 0) + (row.total_completion_tokens || 0),
    };
  }

  /**
   * Retrieves an existing session or creates a new one.
   *
   * @param {string} [sessionId] - Optional existing session UUID.
   * @param {string} [defaultSpeaker='astra'] - Default voice speaker.
   * @param {string} [defaultModel='mistv3'] - Default TTS model ID.
   * @param {string} [title] - Optional custom session title.
   * @returns {object} The session record.
   */
  getOrCreateSession(sessionId, defaultSpeaker = 'astra', defaultModel = 'mistv3', title = null) {
    const id = sessionId || randomUUID();
    const speaker = defaultSpeaker || 'astra';
    const model = defaultModel || 'mistv3';

    const existing = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
    if (existing) {
      return this.formatSession(existing);
    }

    const now = Date.now();
    const sessionTitle =
      title ||
      `Conversation ${new Date(now).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;

    this.db
      .prepare(
        `
      INSERT INTO sessions (
        id, title, created_at, updated_at, total_turns,
        total_prompt_tokens, total_completion_tokens, total_cost_usd,
        active_speaker, active_model, summary
      ) VALUES (?, ?, ?, ?, 0, 0, 0, 0.0, ?, ?, '')
    `
      )
      .run(id, sessionTitle, now, now, speaker, model);

    return this.formatSession(this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id));
  }

  /**
   * Updates an existing session's metadata.
   */
  updateSession(sessionId, updates = {}) {
    const fields = [];
    const values = [];

    const speaker = updates.speaker !== undefined ? updates.speaker : updates.active_speaker;
    const model =
      updates.modelId !== undefined
        ? updates.modelId
        : updates.model !== undefined
          ? updates.model
          : updates.active_model;

    if (updates.title !== undefined) {
      fields.push('title = ?');
      values.push(updates.title);
    }
    if (speaker !== undefined) {
      fields.push('active_speaker = ?');
      values.push(speaker);
    }
    if (model !== undefined) {
      fields.push('active_model = ?');
      values.push(model);
    }
    if (updates.summary !== undefined) {
      fields.push('summary = ?');
      values.push(updates.summary);
    }

    fields.push('updated_at = ?');
    values.push(Date.now());
    values.push(sessionId);

    this.db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  /**
   * Records a completed or interrupted turn, updating session rollups atomically.
   */
  recordTurn(turn) {
    const id = turn.id || randomUUID();
    const sessionId = turn.sessionId;
    const now = turn.timestamp || Date.now();

    // Ensure session exists
    this.getOrCreateSession(sessionId, turn.speaker, turn.modelId);

    const promptTokens = Number(turn.promptTokens || 0);
    const completionTokens = Number(turn.completionTokens || 0);
    const costUsd = Number(turn.costUsd || 0.0);

    const assistantText =
      turn.assistantText ||
      (typeof turn.visualPayload === 'string'
        ? turn.visualPayload
        : turn.visualPayload?.content) ||
      turn.spokenText ||
      '';

    const visualType =
      turn.visualType ||
      (typeof turn.visualPayload === 'object' && turn.visualPayload?.type) ||
      'text';
    const visualTitle =
      turn.visualTitle ||
      (typeof turn.visualPayload === 'object' && turn.visualPayload?.title) ||
      '';

    this.db
      .prepare(
        `
      INSERT INTO turns (
        id, session_id, generation, role, user_text, assistant_text,
        spoken_text, response_mode, visual_type, visual_title,
        stt_ms, llm_ms, tts_ms, barge_in_ms, total_ms,
        prompt_tokens, completion_tokens, cost_usd,
        speaker, model_id, llm_model, interrupted, fallback_used, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        id,
        sessionId,
        turn.generation || 1,
        turn.role || 'assistant',
        turn.userText || '',
        assistantText,
        turn.spokenText || '',
        turn.responseMode || 'VOICE',
        visualType,
        visualTitle,
        Number(turn.sttMs || 0),
        Number(turn.llmMs || 0),
        Number(turn.ttsMs || 0),
        Number(turn.bargeInMs || 0),
        Number(turn.totalMs || 0),
        promptTokens,
        completionTokens,
        costUsd,
        turn.speaker || 'astra',
        turn.modelId || 'mistv3',
        turn.llmModel || '',
        turn.interrupted ? 1 : 0,
        turn.fallbackUsed || null,
        now
      );

    // Update session aggregates
    this.db
      .prepare(
        `
      UPDATE sessions SET
        total_turns = total_turns + 1,
        total_prompt_tokens = total_prompt_tokens + ?,
        total_completion_tokens = total_completion_tokens + ?,
        total_cost_usd = total_cost_usd + ?,
        updated_at = ?
      WHERE id = ?
    `
      )
      .run(promptTokens, completionTokens, costUsd, now, sessionId);

    // If first turn and title is default, set title based on first user query
    if (turn.userText && turn.userText.trim()) {
      const session = this.db
        .prepare('SELECT title, total_turns FROM sessions WHERE id = ?')
        .get(sessionId);
      if (session && session.total_turns <= 1) {
        const cleanTitle = turn.userText.trim().slice(0, 48);
        this.db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run(cleanTitle, sessionId);
      }
    }

    const recorded = this.db.prepare('SELECT * FROM turns WHERE id = ?').get(id);
    return (
      this.formatTurn(recorded) || {
        id,
        sessionId,
        generation: turn.generation || 1,
        turn_index: turn.generation || 1,
      }
    );
  }

  formatTurn(row) {
    if (!row) return null;
    return {
      ...row,
      turn_index: row.generation,
      turnIndex: row.generation,
    };
  }

  /**
   * Marks turns of a specific generation epoch or the latest turn as interrupted.
   *
   * @param {string} sessionId
   * @param {number} [generationOrBargeInMs=0]
   * @param {number} [bargeInMs=0]
   */
  markInterrupted(sessionId, generationOrBargeInMs = 0, bargeInMs = 0) {
    if (bargeInMs !== 0) {
      this.db
        .prepare(
          `
        UPDATE turns SET
          interrupted = 1,
          barge_in_ms = ?
        WHERE session_id = ? AND generation = ?
      `
        )
        .run(bargeInMs, sessionId, generationOrBargeInMs);
      return;
    }

    // Single numeric arg passed -> mark latest turn in session
    this.db
      .prepare(
        `
      UPDATE turns SET
        interrupted = 1,
        barge_in_ms = ?
      WHERE id = (
        SELECT id FROM turns WHERE session_id = ? ORDER BY created_at DESC LIMIT 1
      )
    `
      )
      .run(Number(generationOrBargeInMs) || 0, sessionId);
  }

  /**
   * Retrieves turns for a given session.
   *
   * @param {string} sessionId
   * @param {number} [limit=100]
   * @returns {Array<object>}
   */
  getSessionTurns(sessionId, limit = 100) {
    const rows = this.db
      .prepare(
        `
      SELECT * FROM turns
      WHERE session_id = ?
      ORDER BY created_at ASC
      LIMIT ?
    `
      )
      .all(sessionId, limit);
    return rows.map((r) => this.formatTurn(r));
  }

  /**
   * Formats turns into standard message history for the LLM context.
   */
  getSessionMessagesForContext(sessionId, limit = 10) {
    const turns = this.db
      .prepare(
        `
      SELECT user_text, assistant_text, response_mode, created_at
      FROM turns
      WHERE session_id = ? AND (user_text IS NOT NULL AND user_text != '')
      ORDER BY created_at DESC
      LIMIT ?
    `
      )
      .all(sessionId, limit);

    const messages = [];
    // Oldest first
    turns.reverse().forEach((t) => {
      if (t.user_text) {
        messages.push({ role: 'user', content: t.user_text });
      }
      if (t.assistant_text) {
        messages.push({ role: 'assistant', content: t.assistant_text });
      }
    });

    return messages;
  }

  /**
   * Lists all sessions with turn count and cost.
   */
  listSessions(limit = 20) {
    const rows = this.db
      .prepare(
        `
      SELECT
        id, title, created_at, updated_at, total_turns,
        total_prompt_tokens, total_completion_tokens, total_cost_usd,
        active_speaker, active_model, summary
      FROM sessions
      ORDER BY updated_at DESC
      LIMIT ?
    `
      )
      .all(limit);
    return rows.map((r) => this.formatSession(r));
  }

  /**
   * Deletes a session and cascading turns.
   */
  deleteSession(sessionId) {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  }

  /**
   * Records a raw telemetry event into the audit log.
   * Supports recordTelemetryEvent(sessionId, eventType, data) and recordTelemetryEvent(eventType, sessionId, data).
   */
  recordTelemetryEvent(first, second, data = {}) {
    let sessionId = null;
    let eventType = 'custom';
    let payload = data;

    if (
      typeof first === 'string' &&
      (first.length > 20 || first.includes('-') || first.startsWith('sess_'))
    ) {
      sessionId = first;
      eventType = second || 'custom';
    } else {
      eventType = first || 'custom';
      sessionId = typeof second === 'string' ? second : null;
      if (typeof second === 'object' && !Array.isArray(second) && Object.keys(data).length === 0) {
        payload = second;
      }
    }

    const dataJson = typeof payload === 'string' ? payload : JSON.stringify(payload);
    this.db
      .prepare(
        `
      INSERT INTO telemetry_events (session_id, event_type, data_json, timestamp)
      VALUES (?, ?, ?, ?)
    `
      )
      .run(sessionId || null, eventType, dataJson, Date.now());
  }

  /**
   * Calculates lifetime aggregate telemetry across all sessions and turns.
   */
  getAggregateTelemetry() {
    const sessionStats = this.db
      .prepare(
        `
      SELECT
        COUNT(*) as sessionCount,
        COALESCE(SUM(total_turns), 0) as totalTurns,
        COALESCE(SUM(total_prompt_tokens), 0) as totalPromptTokens,
        COALESCE(SUM(total_completion_tokens), 0) as totalCompletionTokens,
        COALESCE(SUM(total_cost_usd), 0.0) as totalCostUsd
      FROM sessions
    `
      )
      .get() || {
      sessionCount: 0,
      totalTurns: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalCostUsd: 0,
    };

    const turnStats = this.db
      .prepare(
        `
      SELECT
        COALESCE(AVG(stt_ms), 0.0) as avgSttMs,
        COALESCE(AVG(llm_ms), 0.0) as avgLlmMs,
        COALESCE(AVG(tts_ms), 0.0) as avgTtsMs,
        COALESCE(AVG(total_ms), 0.0) as avgTotalMs,
        COALESCE(AVG(barge_in_ms), 0.0) as avgBargeInMs,
        COALESCE(SUM(interrupted), 0) as totalInterruptions
      FROM turns
    `
      )
      .get() || {
      avgSttMs: 0,
      avgLlmMs: 0,
      avgTtsMs: 0,
      avgTotalMs: 0,
      avgBargeInMs: 0,
      totalInterruptions: 0,
    };

    const recentTurns = this.db
      .prepare(
        `
      SELECT
        id, session_id, generation, user_text, spoken_text,
        response_mode, stt_ms, llm_ms, tts_ms, barge_in_ms, total_ms,
        prompt_tokens, completion_tokens, cost_usd, speaker, model_id,
        interrupted, fallback_used, created_at
      FROM turns
      ORDER BY created_at DESC
      LIMIT 10
    `
      )
      .all();

    const recentEvents = this.db
      .prepare(
        `
      SELECT id, session_id, event_type, data_json, timestamp
      FROM telemetry_events
      ORDER BY timestamp DESC
      LIMIT 10
    `
      )
      .all()
      .map((e) => {
        try {
          return { ...e, data: JSON.parse(e.data_json) };
        } catch {
          return { ...e, data: e.data_json };
        }
      });

    const totalTokens = sessionStats.totalPromptTokens + sessionStats.totalCompletionTokens;
    const totalCostUsd = Number(sessionStats.totalCostUsd.toFixed(5));

    return {
      totalSessions: sessionStats.sessionCount,
      sessions: sessionStats,
      lifetime: {
        totalSessions: sessionStats.sessionCount,
        totalTurns: sessionStats.totalTurns,
        totalTokens,
        totalCostUsd,
        avgSttMs: Number(turnStats.avgSttMs.toFixed(1)),
        avgLlmMs: Number(turnStats.avgLlmMs.toFixed(1)),
        avgTtsMs: Number(turnStats.avgTtsMs.toFixed(1)),
        avgTotalMs: Number(turnStats.avgTotalMs.toFixed(1)),
        avgBargeInMs: Number(turnStats.avgBargeInMs.toFixed(2)),
        totalInterruptions: turnStats.totalInterruptions,
      },
      latencies: {
        avgSttMs: Number(turnStats.avgSttMs.toFixed(1)),
        avgLlmMs: Number(turnStats.avgLlmMs.toFixed(1)),
        avgTtsMs: Number(turnStats.avgTtsMs.toFixed(1)),
        avgTotalMs: Number(turnStats.avgTotalMs.toFixed(1)),
        avgBargeInMs: Number(turnStats.avgBargeInMs.toFixed(2)),
        totalInterruptions: turnStats.totalInterruptions,
      },
      tokens: {
        totalPromptTokens: sessionStats.totalPromptTokens,
        totalCompletionTokens: sessionStats.totalCompletionTokens,
        totalTokens,
        totalCostUsd,
      },
      recentTurns,
      recentEvents,
    };
  }

  /**
   * Health check verifying SQLite read and write capabilities.
   */
  healthCheck() {
    try {
      this.db.prepare('SELECT 1').get();
      return {
        ok: true,
        status: 'connected',
        mode: this.isMemory ? 'memory' : 'file',
        path: this.dbPath,
      };
    } catch (err) {
      return { ok: false, status: 'error', error: err.message };
    }
  }

  /**
   * Closes the database.
   */
  close() {
    this.db.close();
  }
}

// Default singleton instance
let defaultDbInstance = null;

/**
 * Returns the default singleton AuroraDatabase instance or an isolated instance if customPath is specified.
 *
 * @param {string} [customPath]
 * @returns {AuroraDatabase}
 */
export function getDb(customPath) {
  if (customPath) {
    return new AuroraDatabase(customPath);
  }
  if (!defaultDbInstance) {
    defaultDbInstance = new AuroraDatabase();
  }
  return defaultDbInstance;
}
