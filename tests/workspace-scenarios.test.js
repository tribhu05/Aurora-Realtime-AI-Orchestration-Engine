// tests/workspace-scenarios.test.js
// Automated test suite for Aurora's 5 default workspace suggestion scenarios.
// Validates visual chat output format, modality badges, and spoken audio brevity.
// Runs entirely offline on an ephemeral server with zero external secrets.

import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createAuroraServer } from '../server/server.js';

let server;
let wsUrl;

test.before(async () => {
  server = createAuroraServer({ mock: true, mockAudio: true, quiet: true });
  const { port } = await server.listen(0);
  wsUrl = `ws://localhost:${port}`;
});

test.after(async () => {
  if (server) await server.close();
});

function runScenario(query, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const messages = [];
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`Timeout waiting for query: "${query}"`));
    }, timeoutMs);

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      messages.push(msg);

      if (msg.type === 'handshake') {
        ws.send(JSON.stringify({ type: 'query', text: query, timestamp: Date.now() }));
      }

      if (msg.type === 'done' || msg.type === 'task_complete') {
        clearTimeout(timer);
        ws.close();
        resolve({
          messages,
          aiText: messages.find((m) => m.type === 'ai_text'),
          taskComplete: messages.find((m) => m.type === 'task_complete'),
        });
      }

      if (msg.type === 'error') {
        clearTimeout(timer);
        ws.close();
        reject(new Error(msg.message));
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

test('Workspace Scenario 1: Python Prime Checker generates code block', async () => {
  const { aiText } = await runScenario(
    'Write a Python program to check whether a number is prime.'
  );
  assert.ok(aiText, 'Received ai_text response');
  assert.equal(aiText.visualType, 'code', 'Visual type must be code');
  assert.equal(aiText.language, 'python', 'Language must be python');
  assert.equal(aiText.responseMode, 'TEXT', 'Response mode must be TEXT');
  assert.ok(aiText.text.includes('is_prime'), 'Code includes is_prime function');
  assert.ok(!aiText.spoken.includes('def is_prime'), 'Spoken audio does not read code aloud');
});

test('Workspace Scenario 2: Binary Search Concept generates clean concept explanation', async () => {
  const { aiText } = await runScenario('Explain binary search.');
  assert.ok(aiText, 'Received ai_text response');
  assert.ok(
    aiText.text.toLowerCase().includes('binary_search') ||
      aiText.text.toLowerCase().includes('binary search') ||
      aiText.spoken.toLowerCase().includes('binary search'),
    'Explanation text covers binary search'
  );
  assert.ok(!aiText.spoken.startsWith('{'), 'Spoken audio never leaks raw JSON');
});

test('Workspace Scenario 3: Comparison Table generates markdown table', async () => {
  const { aiText } = await runScenario('Compare Python and C++ in a table.');
  assert.ok(aiText, 'Received ai_text response');
  assert.equal(aiText.visualType, 'table', 'Visual type must be table');
  assert.ok(aiText.text.includes('| Feature |'), 'Visual text contains table header');
  assert.ok(aiText.text.includes('| :---'), 'Visual text contains table delimiter');
  assert.ok(!aiText.spoken.includes('|'), 'Spoken audio contains zero table pipe characters');
});

test('Workspace Scenario 4: Scaffold Express REST API for Todo App executes workflow', async () => {
  const { taskComplete } = await runScenario('Create an Express REST API for a todo app.', 15000);
  assert.ok(taskComplete, 'Received task_complete event');
  assert.ok(taskComplete.files && taskComplete.files.length > 0, 'Created files for todo app');
  assert.ok(taskComplete.primaryCode?.code.includes('/api/todos'), 'Contains /api/todos endpoints');
});

test('Workspace Scenario 5: Python Odd and Even Program generates code block', async () => {
  const { aiText } = await runScenario('Write a Python program for odd and even numbers.');
  assert.ok(aiText, 'Received ai_text response');
  assert.equal(aiText.visualType, 'code', 'Visual type must be code');
  assert.equal(aiText.language, 'python', 'Language must be python');
  assert.ok(
    aiText.text.includes('check_odd_even') || aiText.text.includes('% 2'),
    'Contains odd and even checking logic'
  );
  assert.ok(!aiText.spoken.includes('% 2'), 'Spoken audio does not read modulo operators aloud');
});
