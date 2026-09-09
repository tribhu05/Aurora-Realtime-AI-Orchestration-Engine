// tests/unit/security-validation.test.js
// Automated test suite for security validation, error sanitization,
// and edge-case race condition resilience.

import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createAuroraServer, sanitizeError } from '../../server/server.js';

test('Security & Validation - sanitizeError redacts sensitive tokens', () => {
  const secretError = 'Unauthorized: Bearer sk-ant-api03-1234567890abcdef12345678 is invalid';
  const redacted = sanitizeError(secretError);
  assert.ok(!redacted.includes('1234567890abcdef'), 'Sensitive token characters redacted');
  assert.ok(redacted.includes('***REDACTED***'), 'Contains REDACTED marker');

  const keyParamError = 'Failed to fetch from https://api.example.com?key=AIzaSyD9876543210zyx';
  const redactedKey = sanitizeError(keyParamError);
  assert.ok(!redactedKey.includes('9876543210zyx'), 'API key param redacted');
  assert.ok(redactedKey.includes('***REDACTED***'));

  const jsonKeyError = '{"apiKey": "groq_sec_999888777666555444"}';
  const redactedJson = sanitizeError(jsonKeyError);
  assert.ok(!redactedJson.includes('999888777666'), 'JSON key value redacted');
});

test('Security & Validation - Rejects oversized payloads (> 64 KB)', async () => {
  const server = createAuroraServer({ mock: true, quiet: true });
  const { port } = await server.listen(0);
  const ws = new WebSocket(`ws://localhost:${port}`);

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Timeout'));
      }, 5000);

      ws.on('open', () => {
        // Send 70 KB payload
        const hugeText = 'A'.repeat(70000);
        ws.send(JSON.stringify({ type: 'query', text: hugeText }));
      });

      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'error' && msg.message === 'Payload too large.') {
          clearTimeout(timeout);
          ws.close();
          resolve();
        }
      });

      ws.on('error', reject);
    });
  } finally {
    await server.close();
  }
});

test('Security & Validation - Rejects malformed or non-object payloads', async () => {
  const server = createAuroraServer({ mock: true, quiet: true });
  const { port } = await server.listen(0);
  const ws = new WebSocket(`ws://localhost:${port}`);

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Timeout'));
      }, 5000);

      ws.on('open', () => {
        // Send broken JSON
        ws.send('{ broken_json_payload: true,');
      });

      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'error' && msg.message === 'Malformed JSON payload.') {
          clearTimeout(timeout);
          ws.close();
          resolve();
        }
      });

      ws.on('error', reject);
    });
  } finally {
    await server.close();
  }
});

test('Security & Validation - Sanitizes update_config against injection strings', async () => {
  const server = createAuroraServer({ mock: true, quiet: true });
  const { port } = await server.listen(0);
  const ws = new WebSocket(`ws://localhost:${port}`);

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Timeout'));
      }, 5000);

      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'handshake') {
          // Send malicious speaker string
          ws.send(JSON.stringify({
            type: 'update_config',
            speaker: '<script>alert(1)</script>',
            modelId: '../../etc/passwd',
          }));
        }

        if (msg.type === 'config_updated') {
          clearTimeout(timeout);
          // Malicious inputs should be rejected, preserving valid previous configs
          assert.equal(msg.speaker, 'astra', 'Illegal speaker rejected');
          assert.equal(msg.modelId, 'mistv3', 'Illegal modelId rejected');
          ws.close();
          resolve();
        }
      });

      ws.on('error', reject);
    });
  } finally {
    await server.close();
  }
});

test('Security & Validation - Resilient against rapid double-interrupts', async () => {
  const server = createAuroraServer({ mock: true, mockAudio: true, delayMs: 400, quiet: true });
  const { port } = await server.listen(0);
  const ws = new WebSocket(`ws://localhost:${port}`);

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Timeout on rapid double-interrupt test'));
      }, 8000);

      let interruptAcks = 0;

      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());

        if (msg.type === 'handshake') {
          ws.send(JSON.stringify({ type: 'query', text: 'Explain gravity in detail', timestamp: Date.now() }));
        }

        if (msg.type === 'thinking') {
          // Send 2 interrupts in immediate back-to-back sequence
          ws.send(JSON.stringify({ type: 'interrupt', timestamp: Date.now() }));
          ws.send(JSON.stringify({ type: 'interrupt', timestamp: Date.now() }));
        }

        if (msg.type === 'interrupted') {
          interruptAcks++;
          if (interruptAcks === 2) {
            clearTimeout(timeout);
            ws.close();
            resolve();
          }
        }
      });

      ws.on('error', reject);
    });
  } finally {
    await server.close();
  }
});

test('Security & Validation - Clean abort on abrupt client disconnect mid-flight', async () => {
  const server = createAuroraServer({ mock: true, mockAudio: true, delayMs: 500, quiet: true });
  const { port } = await server.listen(0);
  const ws = new WebSocket(`ws://localhost:${port}`);

  try {
    await new Promise((resolve, reject) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'handshake') {
          ws.send(JSON.stringify({ type: 'query', text: 'Explain general relativity', timestamp: Date.now() }));
        }

        if (msg.type === 'thinking') {
          // Abruptly terminate connection while in-flight
          ws.terminate();
          setTimeout(resolve, 300);
        }
      });

      ws.on('error', () => {
        // Ignored during intentional termination
      });
    });
  } finally {
    await server.close();
  }
});
