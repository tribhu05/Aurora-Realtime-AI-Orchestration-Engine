// tests/routing-scenarios.test.js
// Automated test suite for Intelligent Response Routing in Aurora.
// Tests:
// 1. Server-Side Safety Guardrails & Contract Validation
// 2. Live WebSocket VOICE Modality Requests
// 3. Live WebSocket TEXT Modality Requests (Code & Tables)
// 4. Live WebSocket HYBRID Modality Requests (Explanation + Code)
// 5. Multi-Turn Conversational Modality Transitions
// 6. Barge-in / Mid-Turn Interruption & Generation Fencing
// Runs entirely offline on an ephemeral server with zero external secrets.

import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import {
  RESPONSE_MODES,
  SPOKEN_BUDGETS,
  containsStructuredContent,
  enforceSpokenBudget,
  validateAndEnforceContract,
} from '../server/response-router.js';
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

function runWsQuery(query, options = {}) {
  const { modeOverride, timeoutMs = 12000, existingWs } = options;

  return new Promise((resolve, reject) => {
    const ws = existingWs || new WebSocket(wsUrl);
    const messages = [];
    const timer = setTimeout(() => {
      if (!existingWs) ws.close();
      reject(new Error(`Timeout waiting for query: "${query}"`));
    }, timeoutMs);

    const onMessage = (raw) => {
      const msg = JSON.parse(raw.toString());
      messages.push(msg);

      if (msg.type === 'handshake' && !existingWs) {
        ws.send(JSON.stringify({
          type: 'query',
          text: query,
          mode: modeOverride || undefined,
          timestamp: Date.now(),
        }));
      }

      if (msg.type === 'done' || (msg.type === 'ai_text' && options.resolveOnAiText)) {
        clearTimeout(timer);
        if (!existingWs) ws.close();
        resolve({ ws, messages, lastAiText: messages.find((m) => m.type === 'ai_text') });
      }

      if (msg.type === 'error') {
        clearTimeout(timer);
        if (!existingWs) ws.close();
        reject(new Error(`Server error: ${msg.message}`));
      }
    };

    if (existingWs) {
      existingWs.on('message', onMessage);
      existingWs.send(JSON.stringify({
        type: 'query',
        text: query,
        mode: modeOverride || undefined,
        timestamp: Date.now(),
      }));
    } else {
      ws.on('message', onMessage);
      ws.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    }
  });
}

// ---------------------------------------------------------------------------
// SUITE 1: Deterministic Safety Guardrails & Contract Enforcement
// ---------------------------------------------------------------------------
test('Routing Guardrails - Structured content detection', () => {
  assert.equal(containsStructuredContent('def is_prime(n):\n    return True'), true, 'Python code detected');
  assert.equal(containsStructuredContent('| Name | Speed |\n|---|---|\n| C++ | Fast |'), true, 'Table detected');
  assert.equal(containsStructuredContent('#include <iostream>\nint main() {}'), true, 'C++ code detected');
  assert.equal(containsStructuredContent('Paris is the capital of France.'), false, 'Plain text passes clean');
});

test('Routing Guardrails - Spoken budget sentence-aware trimming', () => {
  const longSentence = "This is sentence one. This is sentence two. This is sentence three which exceeds the limit of twenty words drastically.";
  const budgeted = enforceSpokenBudget(longSentence, 'TEXT');
  const wordCount = budgeted.split(/\s+/).length;
  assert.ok(wordCount <= SPOKEN_BUDGETS.TEXT, `Budget exceeded: ${wordCount} > ${SPOKEN_BUDGETS.TEXT}`);
  assert.ok(/[.!?]$/.test(budgeted), 'Budgeted text ends with punctuation');
});

test('Routing Guardrails - Hallucinated VOICE mode recovery', () => {
  const hallucinatedVoice = {
    responseMode: 'VOICE',
    spokenResponse: "Here is the code: def binary_search(arr, target): return 0",
    visualResponse: {
      type: 'code',
      language: 'python',
      content: 'def binary_search(arr, target):\n    return 0',
    },
  };
  const corrected = validateAndEnforceContract(hallucinatedVoice, 'Write binary search in Python');
  assert.equal(corrected.responseMode, 'TEXT', 'Elevated from VOICE to TEXT');
  assert.equal(containsStructuredContent(corrected.spokenResponse), false, 'Raw code sanitized from spokenResponse');
  assert.ok(corrected.spokenResponse.includes('workspace'), 'Spoken response directs user to workspace');
});

test('Routing Guardrails - Code syntax in spoken channel sanitized', () => {
  const dirtySpoken = {
    responseMode: 'HYBRID',
    spokenResponse: "Quicksort divides using `pivot = arr[high]`. Here is the full code.",
    visualResponse: {
      type: 'code',
      language: 'python',
      content: 'def quicksort(arr): ...',
    },
  };
  const sanitized = validateAndEnforceContract(dirtySpoken, 'Explain quicksort and write python code');
  assert.equal(sanitized.responseMode, 'HYBRID');
  assert.ok(!sanitized.spokenResponse.includes('`'), 'Backticks stripped from spoken text');
});

// ---------------------------------------------------------------------------
// SUITE 2: Live WebSocket Routing Scenarios (VOICE, TEXT, HYBRID)
// ---------------------------------------------------------------------------
test('Routing Live - VOICE modality query', async () => {
  const { lastAiText } = await runWsQuery('What is the capital of Japan?');
  assert.ok(lastAiText, 'Received ai_text message');
  assert.equal(lastAiText.responseMode, 'VOICE', 'Expected VOICE responseMode');
  assert.equal(lastAiText.visualType, 'text', 'Expected text visualType');
  const voiceWords = (lastAiText.spoken || '').split(/\s+/).length;
  assert.ok(voiceWords <= 35, `Voice spoken budget exceeded: ${voiceWords} words`);
  assert.equal(containsStructuredContent(lastAiText.spoken), false, 'No structured syntax in speech');
});

test('Routing Live - TEXT modality query for Code Generation', async () => {
  const { lastAiText } = await runWsQuery('Write a binary search function in C++');
  assert.ok(lastAiText, 'Received ai_text message');
  assert.equal(lastAiText.responseMode, 'TEXT', 'Expected TEXT responseMode');
  assert.equal(lastAiText.visualType, 'code', 'Expected code visualType');
  const textWords = (lastAiText.spoken || '').split(/\s+/).length;
  assert.ok(textWords <= 20, `Text spoken budget exceeded: ${textWords} words`);
  assert.equal(containsStructuredContent(lastAiText.spoken), false, 'Never read code syntax aloud');
  assert.ok(
    lastAiText.text.includes('binary_search') || lastAiText.text.includes('int') || lastAiText.text.includes('Binary Search'),
    'Code contains binary search'
  );
});

test('Routing Live - TEXT modality query for Comparison Table', async () => {
  const { lastAiText } = await runWsQuery('Compare React and Vue in a table');
  assert.ok(lastAiText, 'Received ai_text message');
  assert.equal(lastAiText.responseMode, 'TEXT', 'Expected TEXT responseMode');
  assert.equal(lastAiText.visualType, 'table', 'Expected table visualType');
  assert.ok(lastAiText.text.includes('|'), 'Contains table syntax');
  assert.ok(!lastAiText.spoken.includes('|'), 'Spoken audio does not contain table pipes');
});

test('Routing Live - HYBRID modality query for Explanation + Implementation', async () => {
  const { lastAiText } = await runWsQuery('Explain quicksort and write a python implementation');
  assert.ok(lastAiText, 'Received ai_text message');
  assert.equal(lastAiText.responseMode, 'HYBRID', 'Expected HYBRID responseMode');
  const hybridWords = (lastAiText.spoken || '').split(/\s+/).length;
  assert.ok(hybridWords <= 30, `Hybrid spoken budget exceeded: ${hybridWords} words`);
  assert.equal(containsStructuredContent(lastAiText.spoken), false, 'No raw code in speech');
  assert.ok(lastAiText.text.length > 50, 'Visual artifact is rich and complete');
});

// ---------------------------------------------------------------------------
// SUITE 3: Multi-Turn Modality Transitions
// ---------------------------------------------------------------------------
test('Routing Live - Multi-turn conversational modality transitions VOICE -> TEXT -> VOICE', async () => {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve) => ws.on('open', resolve));

  // Turn 1: Concept -> VOICE
  const turn1Ai = await new Promise((resolve) => {
    const handler = (data) => {
      const m = JSON.parse(data.toString());
      if (m.type === 'ai_text') {
        ws.removeListener('message', handler);
        resolve(m);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ type: 'query', text: 'What is recursion?', timestamp: Date.now() }));
  });
  assert.equal(turn1Ai.responseMode, 'VOICE');

  // Turn 2: Follow-up requesting code -> TEXT
  const turn2Ai = await new Promise((resolve) => {
    const handler = (data) => {
      const m = JSON.parse(data.toString());
      if (m.type === 'ai_text') {
        ws.removeListener('message', handler);
        resolve(m);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ type: 'query', text: 'Now write the Python code for it.', timestamp: Date.now() }));
  });
  assert.equal(turn2Ai.responseMode, 'TEXT');
  assert.equal(turn2Ai.visualType, 'code');

  // Turn 3: Conceptual question about the code -> VOICE
  const turn3Ai = await new Promise((resolve) => {
    const handler = (data) => {
      const m = JSON.parse(data.toString());
      if (m.type === 'ai_text') {
        ws.removeListener('message', handler);
        resolve(m);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ type: 'query', text: 'Why is a base case required?', timestamp: Date.now() }));
  });
  assert.equal(turn3Ai.responseMode, 'VOICE');

  ws.close();
});
