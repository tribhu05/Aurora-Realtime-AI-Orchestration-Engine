// tests/sliding-window-cpp.test.js
// Verifies that multi-turn code requests like "I want it in C++"
// return clean, syntax-highlighted code blocks with zero raw JSON leakage.
// Runs entirely offline on an ephemeral server with zero external secrets.

import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createAuroraServer } from '../server/server.js';

test('Multi-turn C++ code generation eliminates raw JSON leakage', async () => {
  const server = createAuroraServer({ mock: true, mockAudio: true, quiet: true });
  const { port } = await server.listen(0);
  const wsUrl = `ws://localhost:${port}`;

  try {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const messages = [];

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Timeout waiting for sliding window C++ test'));
      }, 10000);

      let turn = 0;

      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        messages.push(msg);

        if (msg.type === 'handshake') {
          turn = 1;
          ws.send(
            JSON.stringify({
              type: 'query',
              text: 'Explain sliding window algorithm',
              timestamp: Date.now(),
            })
          );
        }

        if (msg.type === 'ai_text' && turn === 1) {
          turn = 2;
          ws.send(
            JSON.stringify({
              type: 'query',
              text: 'I want it in C++',
              timestamp: Date.now(),
            })
          );
        } else if (msg.type === 'ai_text' && turn === 2) {
          clearTimeout(timeout);
          ws.close();

          try {
            // Strict assertions against raw JSON leakage
            assert.equal(msg.visualType, 'code', 'Visual type must be "code"');
            assert.ok(
              msg.language === 'cpp' || msg.language === 'c++',
              `Language should be cpp, got: ${msg.language}`
            );
            assert.ok(
              !msg.text.trim().startsWith('{'),
              'CRITICAL: msg.text must NOT start with raw JSON brace'
            );
            assert.ok(
              !msg.text.includes('"spoken"'),
              'CRITICAL: msg.text must NOT contain "spoken" JSON key'
            );
            assert.ok(
              !msg.text.includes('"visualResponse"'),
              'CRITICAL: msg.text must NOT contain "visualResponse" JSON key'
            );
            assert.ok(
              !msg.text.includes('"content"'),
              'CRITICAL: msg.text must NOT contain "content" JSON key'
            );
            assert.ok(
              msg.text.includes('#include') ||
                msg.text.includes('vector') ||
                msg.text.includes('int '),
              'msg.text must contain actual C++ code'
            );

            assert.ok(
              !msg.spoken.trim().startsWith('{'),
              'CRITICAL: msg.spoken must NOT start with raw JSON brace'
            );
            assert.ok(
              !msg.spoken.includes('#include'),
              'CRITICAL: msg.spoken must NOT speak C++ #include syntax'
            );
            assert.ok(
              !msg.spoken.includes('"spoken"'),
              'CRITICAL: msg.spoken must NOT contain JSON keys'
            );

            resolve();
          } catch (err) {
            reject(err);
          }
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
