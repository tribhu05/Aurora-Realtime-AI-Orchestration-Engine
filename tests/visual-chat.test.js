// tests/visual-chat.test.js
// Automated test suite for Aurora's Visual Chat & Output System.
// Tests:
// 1. Spoken vs Visual Separation for Code (C++ reverse string)
// 2. Structured Comparison Table (C++ vs Python)
// 3. Multi-Step Task Scaffolding (Express REST API)
// 4. Mid-Flight Task Barge-In & Switching (Cancel JS -> Switch to TS)
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

function queryWs(text) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const messages = [];
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`Timeout on query: "${text}"`));
    }, 10000);

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      messages.push(msg);

      if (msg.type === 'handshake') {
        ws.send(JSON.stringify({ type: 'query', text, timestamp: Date.now() }));
      }

      if (msg.type === 'done') {
        clearTimeout(timeout);
        ws.close();
        resolve({
          messages,
          aiText: messages.find((m) => m.type === 'ai_text'),
          done: msg,
        });
      }

      if (msg.type === 'error') {
        clearTimeout(timeout);
        ws.close();
        reject(new Error(msg.message));
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

test('Visual Chat - Code generation separates code block from spoken audio', async () => {
  const { aiText } = await queryWs('Write a C++ program to reverse a string.');
  assert.ok(aiText, 'ai_text message received');
  assert.equal(aiText.visualType, 'code', 'Visual type must be code');
  assert.equal(aiText.language, 'cpp', 'Language must be cpp');
  assert.equal(aiText.responseMode, 'TEXT', 'Response mode must be TEXT');

  // Spoken channel safety: NEVER read code aloud
  assert.ok(!aiText.spoken.includes('#include'), 'Spoken text must not include #include');
  assert.ok(!aiText.spoken.includes('cout'), 'Spoken text must not include cout');
  assert.ok(!aiText.spoken.startsWith('{'), 'Spoken text must not start with JSON brace');
  assert.ok(
    aiText.spoken.includes('workspace') || aiText.spoken.includes('chat'),
    'Spoken text confirms placement in workspace'
  );

  // Visual channel completeness
  assert.ok(
    aiText.text.includes('#include <iostream>'),
    'Code text contains standard library include'
  );
  assert.ok(aiText.text.includes('reverse'), 'Code text contains reverse logic');
});

test('Visual Chat - Comparison table renders markdown table with concise speech', async () => {
  const { aiText } = await queryWs('Compare C++ and Python in a table.');
  assert.ok(aiText, 'ai_text message received');
  assert.equal(aiText.visualType, 'table', 'Visual type must be table');
  assert.equal(aiText.responseMode, 'TEXT', 'Response mode must be TEXT');

  // Table syntax check
  assert.ok(
    aiText.text.includes('| Feature | C++ | Python |'),
    'Visual content contains markdown table headers'
  );
  assert.ok(
    aiText.text.includes('| :--- | :--- | :--- |'),
    'Visual content contains table delimiter'
  );

  // Spoken channel check
  assert.ok(!aiText.spoken.includes('|'), 'Spoken text must never read table pipes aloud');
  assert.ok(
    aiText.spoken.includes('workspace') || aiText.spoken.includes('comparison'),
    'Spoken text acknowledges table in workspace'
  );
});

test('Visual Chat - Multi-step task scaffolding streams progress and completes with artifacts', async () => {
  const result = await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const messages = [];
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Timeout on task scaffolding test'));
    }, 12000);

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      messages.push(msg);

      if (msg.type === 'handshake') {
        ws.send(
          JSON.stringify({
            type: 'query',
            text: 'Create an Express REST API in JavaScript',
            timestamp: Date.now(),
          })
        );
      }

      if (msg.type === 'task_complete') {
        clearTimeout(timeout);
        ws.close();
        resolve(messages);
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  const taskStarted = result.find((m) => m.type === 'task_started');
  assert.ok(taskStarted, 'Received task_started event');
  assert.equal(taskStarted.flavor, 'JavaScript');
  assert.ok(taskStarted.totalSteps > 0, 'Task has defined steps');

  const progressEvents = result.filter((m) => m.type === 'task_progress');
  assert.ok(progressEvents.length >= 2, 'Received streaming task_progress events');

  const taskComplete = result.find((m) => m.type === 'task_complete');
  assert.ok(taskComplete, 'Received task_complete event');
  assert.ok(taskComplete.files && taskComplete.files.length > 0, 'Created project files');
  assert.ok(taskComplete.primaryCode, 'Generated primary code artifact');
  assert.equal(taskComplete.primaryCode.language, 'javascript');
});

test('Visual Chat - Mid-flight task barge-in cancels active task and recovers to new task', async () => {
  const result = await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const messages = [];
    let switched = false;

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Timeout on mid-flight task barge-in test'));
    }, 15000);

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      messages.push(msg);

      if (msg.type === 'handshake') {
        // Start JS task
        ws.send(
          JSON.stringify({
            type: 'query',
            text: 'Create an Express REST API in JavaScript',
            timestamp: Date.now(),
          })
        );
      }

      // Interrupt on first progress event
      if (msg.type === 'task_progress' && !switched) {
        switched = true;
        ws.send(JSON.stringify({ type: 'interrupt', timestamp: Date.now() }));
        setTimeout(() => {
          ws.send(
            JSON.stringify({
              type: 'query',
              text: 'Wait! Scaffold an Express REST API in TypeScript instead',
              timestamp: Date.now(),
            })
          );
        }, 50);
      }

      if (msg.type === 'task_complete' && switched && msg.primaryCode?.language === 'typescript') {
        clearTimeout(timeout);
        ws.close();
        resolve(messages);
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  const interruptedAck = result.find((m) => m.type === 'interrupted');
  assert.ok(interruptedAck, 'Interruption acknowledged during active task execution');

  const finalComplete = result.filter((m) => m.type === 'task_complete').pop();
  assert.ok(finalComplete, 'Final task completion event received');
  assert.equal(
    finalComplete.primaryCode.language,
    'typescript',
    'Recovered task completed in TypeScript'
  );
});
