// tests/interruption-test.js
// Automated test for Aurora's barge-in interruption and generation-fencing mechanism.
// Uses Node's built-in test runner (node:test) and strict assertions (node:assert/strict).
// Runs entirely standalone on an ephemeral port with mock mode (zero API keys required).

import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createAuroraServer } from '../server/server.js';

test('Barge-in Interruption & Generation Fencing lifecycle', async () => {
  // 1. Start isolated ephemeral server with deterministic mock audio & LLM
  const server = createAuroraServer({
    mock: true,
    mockAudio: true,
    delayMs: 300, // artificial delay to guarantee in-flight window for interruption
    quiet: true,
  });

  const { port } = await server.listen(0);
  const wsUrl = `ws://localhost:${port}`;

  try {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const messages = [];

      let turn1Gen = null;
      let turn2Gen = null;
      let interruptedAckReceived = false;
      let turn1AudioReceived = false;
      let turn2ReplyReceived = false;
      let turn2AudioReceived = false;
      let turn2DoneReceived = false;

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Test timed out waiting for barge-in lifecycle completion'));
      }, 15000);

      ws.on('open', () => {
        // Connected
      });

      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        messages.push(msg);

        if (msg.type === 'handshake') {
          assert.equal(msg.generation, 0, 'Initial handshake generation must be 0');
          // Start Turn 1
          ws.send(
            JSON.stringify({
              type: 'query',
              text: 'Tell me something interesting about space.',
              timestamp: Date.now(),
            })
          );
        }

        if (msg.type === 'user_text' && msg.text.includes('space')) {
          turn1Gen = msg.generation;
          assert.equal(turn1Gen, 1, 'Turn 1 generation should be 1');
        }

        if (msg.type === 'thinking' && msg.generation === turn1Gen && !interruptedAckReceived) {
          // Trigger instant barge-in interruption while thinking/delay is in-flight
          setTimeout(() => {
            ws.send(JSON.stringify({ type: 'interrupt', timestamp: Date.now() }));
          }, 50);
        }

        if (msg.type === 'interrupted') {
          interruptedAckReceived = true;
          assert.equal(msg.oldGeneration, 1, 'Interrupted oldGeneration must match Turn 1');
          assert.equal(msg.newGeneration, 2, 'Interrupted newGeneration must be incremented to 2');
          assert.ok(typeof msg.serverTimestamp === 'number', 'Server timestamp included');

          // Send Turn 2 recovery prompt immediately
          ws.send(
            JSON.stringify({
              type: 'query',
              text: 'Actually, tell me a short joke instead.',
              timestamp: Date.now(),
            })
          );
        }

        if (msg.type === 'user_text' && msg.text.includes('joke')) {
          turn2Gen = msg.generation;
          assert.ok(
            turn2Gen > 2,
            'Turn 2 generation must be strictly greater than interrupt generation'
          );
        }

        // Check if any audio from Turn 1 leaked through
        if (msg.type === 'audio' && msg.generation === turn1Gen) {
          turn1AudioReceived = true;
        }

        // Verify Turn 2 audio and content
        if (msg.type === 'ai_text' && msg.generation === turn2Gen) {
          turn2ReplyReceived = true;
          assert.ok(
            msg.text.toLowerCase().includes('joke') ||
              msg.text.toLowerCase().includes('latency') ||
              msg.text.toLowerCase().includes('cross the road'),
            'Turn 2 reply must answer the recovery joke query, not the cancelled space query'
          );
          assert.equal(msg.responseMode, 'VOICE', 'Joke should be classified as VOICE modality');
        }

        if (msg.type === 'audio' && msg.generation === turn2Gen) {
          turn2AudioReceived = true;
          assert.ok(msg.data && msg.data.length > 0, 'Turn 2 audio packet contains audio payload');
        }

        if (msg.type === 'done' && msg.generation === turn2Gen) {
          turn2DoneReceived = true;
          clearTimeout(timeout);
          ws.close();

          // Assertions
          assert.equal(interruptedAckReceived, true, 'Interruption must be acknowledged by server');
          assert.equal(
            turn1AudioReceived,
            false,
            'Turn 1 audio MUST be cancelled and NEVER emitted'
          );
          assert.equal(turn2ReplyReceived, true, 'Turn 2 reply must be generated');
          assert.equal(turn2AudioReceived, true, 'Turn 2 audio must be synthesized and delivered');
          assert.equal(turn2DoneReceived, true, 'Turn 2 done event must be emitted');

          resolve();
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  } finally {
    await server.close();
  }
});
