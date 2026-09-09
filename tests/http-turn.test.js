// tests/http-turn.test.js
// Automated test suite for Aurora HTTP turn endpoints and Serverless fallback.
// Tests:
// 1. GET /config and /api/config
// 2. POST /api/turn validation (400 on empty text)
// 3. POST /api/turn conversational query (VOICE mode)
// 4. POST /api/turn code generation query (TEXT mode)
// 5. POST /api/turn scaffolding task (HYBRID mode)
// 6. POST /api/preview-tts voice preview
// Runs entirely offline with zero external secrets.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuroraServer } from '../server/server.js';

let server;
let baseUrl;

test.before(async () => {
  server = createAuroraServer({ mock: true, mockAudio: true, quiet: true });
  const { port } = await server.listen(0);
  baseUrl = `http://localhost:${port}`;
});

test.after(async () => {
  if (server) await server.close();
});

test('HTTP API - GET /config and /api/config return runtime settings', async () => {
  for (const path of ['/config', '/api/config']) {
    const res = await fetch(`${baseUrl}${path}`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(typeof data.rimeConfigured === 'boolean');
    assert.ok(typeof data.llmConfigured === 'boolean');
    assert.ok(typeof data.speaker === 'string');
    assert.ok(typeof data.modelId === 'string');
  }
});

test('HTTP API - POST /api/turn validates input', async () => {
  const res = await fetch(`${baseUrl}/api/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '' }),
  });
  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.strictEqual(data.ok, false);
});

test('HTTP API - POST /api/turn handles conversational query (VOICE modality)', async () => {
  const res = await fetch(`${baseUrl}/api/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: 'Tell me about the solar system',
    }),
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.ok, true);
  assert.strictEqual(data.responseMode, 'VOICE');
  assert.ok(data.spokenResponse.length > 0);
  assert.ok(!data.spokenResponse.startsWith('{'));
  assert.ok(data.visualResponse);
  assert.strictEqual(data.visualResponse.type, 'text');
});

test('HTTP API - POST /api/turn handles code query (TEXT modality)', async () => {
  const res = await fetch(`${baseUrl}/api/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: 'Write a Python program to check if a number is prime',
    }),
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.ok, true);
  assert.strictEqual(data.responseMode, 'TEXT');
  assert.ok(data.spokenResponse.length > 0);
  assert.ok(!data.spokenResponse.includes('def '));
  assert.ok(data.visualResponse);
  assert.strictEqual(data.visualResponse.type, 'code');
  assert.strictEqual(data.visualResponse.language, 'python');
  assert.ok(data.visualResponse.content.includes('def is_prime'));
});

test('HTTP API - POST /api/turn handles scaffolding task request (HYBRID modality)', async () => {
  const res = await fetch(`${baseUrl}/api/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: 'create an express rest api in typescript',
    }),
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.ok, true);
  assert.strictEqual(data.responseMode, 'HYBRID');
  assert.ok(data.spokenResponse.includes('Express'));
  assert.strictEqual(data.visualResponse.type, 'code');
  assert.strictEqual(data.visualResponse.language, 'typescript');
});

test('HTTP API - POST /api/preview-tts synthesizes sample voice audio', async () => {
  const res = await fetch(`${baseUrl}/api/preview-tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      speaker: 'astra',
      text: 'Voice preview testing',
    }),
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.ok, true);
  assert.ok(data.audio);
});
