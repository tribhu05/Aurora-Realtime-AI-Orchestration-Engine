// tests/db.test.js
// Automated test suite for Aurora SQLite persistence engine (server/db.js).
// Uses node:test and node:assert/strict with an in-memory SQLite database.

import test from 'node:test';
import assert from 'node:assert/strict';
import { getDb } from '../server/db.js';

test('SQLite DB - Lifecycle and Session Management', () => {
  const db = getDb(':memory:');

  const health = db.healthCheck();
  assert.strictEqual(health.ok, true);
  assert.strictEqual(health.mode, 'memory');

  // Create a session
  const session = db.getOrCreateSession(null, 'astra', 'mistv3', 'Test Session');
  assert.ok(session.id);
  assert.strictEqual(session.speaker, 'astra');
  assert.strictEqual(session.model_id, 'mistv3');
  assert.strictEqual(session.title, 'Test Session');
  assert.strictEqual(session.turn_count, 0);
  assert.strictEqual(session.total_tokens, 0);
  assert.strictEqual(session.total_cost_usd, 0);

  // Retrieve existing session
  const sameSession = db.getOrCreateSession(session.id);
  assert.strictEqual(sameSession.id, session.id);

  // Update session speaker and title
  db.updateSession(session.id, { speaker: 'nova', title: 'Updated Title' });
  const updated = db.getOrCreateSession(session.id);
  assert.strictEqual(updated.speaker, 'nova');
  assert.strictEqual(updated.title, 'Updated Title');

  // Record a turn
  const turn1 = db.recordTurn({
    sessionId: session.id,
    turnIndex: 1,
    userText: 'Hello Aurora',
    spokenText: 'Hello there! How can I assist you today?',
    visualPayload: { type: 'text', content: 'Hello there!' },
    audioRef: 'rime:nova',
    sttMs: 120,
    llmMs: 250,
    ttsMs: 180,
    bargeInMs: 0,
    totalMs: 550,
    promptTokens: 15,
    completionTokens: 25,
    totalTokens: 40,
    costUsd: 0.000045,
    modelId: 'mistv3',
    provider: 'gemini',
    speaker: 'nova',
  });

  assert.ok(turn1.id);
  assert.strictEqual(turn1.turn_index, 1);
  assert.strictEqual(turn1.user_text, 'Hello Aurora');
  assert.strictEqual(turn1.llm_ms, 250);

  // Check updated session metrics
  const sessionAfterTurn = db.getOrCreateSession(session.id);
  assert.strictEqual(sessionAfterTurn.turn_count, 1);
  assert.strictEqual(sessionAfterTurn.total_tokens, 40);
  assert.ok(sessionAfterTurn.total_cost_usd > 0);

  // Record a second turn
  db.recordTurn({
    sessionId: session.id,
    turnIndex: 2,
    userText: 'Write a quick function',
    spokenText: "I've placed the function in the workspace.",
    visualPayload: { type: 'code', content: 'function add(a, b) { return a + b; }' },
    sttMs: 80,
    llmMs: 310,
    ttsMs: 150,
    bargeInMs: 0,
    totalMs: 540,
    promptTokens: 30,
    completionTokens: 50,
    totalTokens: 80,
    costUsd: 0.00009,
    modelId: 'mistv3',
    provider: 'gemini',
    speaker: 'nova',
  });

  // Test context history retrieval
  const context = db.getSessionMessagesForContext(session.id, 10);
  assert.strictEqual(context.length, 4);
  assert.strictEqual(context[0].role, 'user');
  assert.strictEqual(context[0].content, 'Hello Aurora');
  assert.strictEqual(context[1].role, 'assistant');
  assert.strictEqual(context[2].role, 'user');
  assert.strictEqual(context[3].role, 'assistant');

  // Test interruption marking
  db.markInterrupted(session.id, 45);
  const turns = db.getSessionTurns(session.id);
  assert.strictEqual(turns.length, 2);
  assert.strictEqual(turns[1].interrupted, 1);
  assert.strictEqual(turns[1].barge_in_ms, 45);

  // Test telemetry event recording
  db.recordTelemetryEvent(session.id, 'latency_fallback', { reason: 'test_timeout' });
  const aggregate = db.getAggregateTelemetry();
  assert.strictEqual(aggregate.totalSessions, 1);
  assert.strictEqual(aggregate.lifetime.totalTurns, 2);
  assert.strictEqual(aggregate.lifetime.totalTokens, 120);
  assert.ok(aggregate.lifetime.avgLlmMs > 0);
  assert.ok(aggregate.lifetime.avgTtsMs > 0);

  // List sessions
  const sessions = db.listSessions(10);
  assert.strictEqual(sessions.length, 1);
  assert.strictEqual(sessions[0].id, session.id);

  // Delete session
  db.deleteSession(session.id);
  const emptySessions = db.listSessions(10);
  assert.strictEqual(emptySessions.length, 0);
  assert.strictEqual(db.getSessionTurns(session.id).length, 0);

  db.close();
});
