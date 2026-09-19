// tests/research.test.js
// Automated test suite for SerpApi Live Research Integration.
// Verifies trigger heuristics, query extraction, mock search execution,
// error fallbacks, timeout handling, generation fencing, and task integration.

import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import {
  isResearchNeeded,
  generateResearchQuery,
  normalizeSearchResults,
  formatResearchContextForLLM,
  formatSpokenResearchSummary,
  performLiveResearch,
} from '../server/research.js';
import { createAuroraServer, sanitizeError } from '../server/server.js';
import { executeScaffoldTask } from '../server/tasks.js';

// --- 1. Research Triggering Heuristics ---
test('Research Trigger - Explicit triggers detect research intent', () => {
  assert.equal(
    isResearchNeeded('Aurora, research the current recommended approach for TypeScript Express'),
    true
  );
  assert.equal(isResearchNeeded('What are the latest features in Node.js 24?'), true);
  assert.equal(isResearchNeeded('Check documentation for the modern Groq API'), true);
  assert.equal(
    isResearchNeeded('Create a TypeScript Express API using current best practices'),
    true
  );
  assert.equal(isResearchNeeded('Compare current libraries for WebSocket audio streaming'), true);
  assert.equal(isResearchNeeded('Look up recent changes in React 19'), true);
});

test('Research Trigger - Basic & elementary queries do NOT trigger research', () => {
  assert.equal(isResearchNeeded('Explain what a JavaScript function is.'), false);
  assert.equal(isResearchNeeded('Write a Python hello world program.'), false);
  assert.equal(isResearchNeeded('Calculate 25 * 40'), false);
  assert.equal(isResearchNeeded('Explain what an HTTP request is.'), false);
  assert.equal(isResearchNeeded('What is recursion?'), false);
  assert.equal(isResearchNeeded('What is gravity?'), false);
  assert.equal(isResearchNeeded(''), false);
  assert.equal(isResearchNeeded(null), false);
});

// --- 2. Query Generation & Cleaning ---
test('Research Query - Generates concise and relevant search queries', () => {
  const q1 = generateResearchQuery(
    'Aurora, please research the current recommended approach for TypeScript Express and then build a project'
  );
  assert.ok(q1.includes('TypeScript Express'));
  assert.ok(!q1.toLowerCase().startsWith('aurora'));
  assert.ok(!q1.toLowerCase().includes('please'));

  const q2 = generateResearchQuery('Can you look up the latest documentation for Groq API?');
  assert.ok(q2.includes('Groq API'));
  assert.ok(!q2.toLowerCase().includes('can you'));

  const q3 = generateResearchQuery('What are the best practices in 2026 for Express REST APIs?');
  assert.ok(q3.includes('Express REST APIs'));
});

// --- 3. Result Normalization & Deduplication ---
test('Result Normalization - Normalizes raw SerpApi results and deduplicates URLs', () => {
  const rawMock = {
    organic_results: [
      {
        title: 'Express 5.0 Guide',
        link: 'https://expressjs.com/en/guide.html',
        snippet: 'Official guide to Express routing and middleware.',
        source: 'expressjs.com',
      },
      {
        title: 'Express 5.0 Guide Duplicate',
        link: 'https://expressjs.com/en/guide.html',
        snippet: 'Duplicate URL should be filtered.',
      },
      {
        title: 'TypeScript Node Starter',
        link: 'https://github.com/microsoft/typescript-node-starter',
        snippet: 'A starter template for TypeScript and Node.',
        source: 'GitHub',
      },
    ],
  };

  const normalized = normalizeSearchResults(rawMock, 'Express TypeScript');
  assert.equal(normalized.query, 'Express TypeScript');
  assert.equal(normalized.results.length, 2, 'Deduplicated duplicate URLs');
  assert.equal(normalized.results[0].title, 'Express 5.0 Guide');
  assert.equal(normalized.results[0].url, 'https://expressjs.com/en/guide.html');
  assert.equal(normalized.results[0].source, 'expressjs.com');
  assert.equal(normalized.results[1].source, 'GitHub');
});

test('Result Normalization - Handles malformed, null, or empty data safely', () => {
  assert.deepEqual(normalizeSearchResults(null, 'test'), { query: 'test', results: [] });
  assert.deepEqual(normalizeSearchResults({}, 'test'), { query: 'test', results: [] });
  assert.deepEqual(normalizeSearchResults({ organic_results: 'invalid' }, 'test'), {
    query: 'test',
    results: [],
  });
});

// --- 4. LLM & Spoken Context Formatting ---
test('Context Formatting - Formats structured LLM prompt context correctly', () => {
  const data = {
    query: 'TypeScript Express best practices',
    results: [
      {
        title: 'Express TypeScript Starter',
        url: 'https://example.com/express-ts',
        snippet: 'Modern Express with strict TypeScript compiler setup.',
        source: 'example.com',
      },
    ],
  };

  const formatted = formatResearchContextForLLM(data);
  assert.ok(formatted.includes('LIVE WEB RESEARCH'));
  assert.ok(formatted.includes('TypeScript Express best practices'));
  assert.ok(formatted.includes('1. Express TypeScript Starter'));
  assert.ok(formatted.includes('https://example.com/express-ts'));
  assert.ok(formatted.includes('Modern Express with strict TypeScript compiler setup.'));

  const spokenLeadIn = formatSpokenResearchSummary(data);
  assert.ok(!spokenLeadIn.includes('http'));
  assert.ok(!spokenLeadIn.includes('***'));
  assert.ok(spokenLeadIn.includes('documentation') || spokenLeadIn.includes('sources'));
});

// --- 5. Mock Research Execution & Error Handling ---
test('Research Execution - Mock results return cleanly without network', async () => {
  const mockData = {
    organic_results: [
      {
        title: 'Node 24 Release',
        link: 'https://nodejs.org/release/v24',
        snippet: 'Node.js 24 introduces native TypeScript execution support.',
      },
    ],
  };

  const res = await performLiveResearch('Node 24 features', {
    mockResults: mockData,
  });

  assert.equal(res.ok, true);
  assert.equal(res.results.length, 1);
  assert.equal(res.results[0].title, 'Node 24 Release');
});

test('Research Execution - Missing API key gracefully falls back without crashing', async () => {
  const res = await performLiveResearch('Test query', {
    apiKey: '',
  });

  assert.equal(res.ok, false);
  assert.equal(res.results.length, 0);
  assert.ok(res.error.includes('SERPAPI_KEY is not configured'));
});

test('Research Execution - Network failure or 500 error handles cleanly', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 500,
    statusText: 'Internal Server Error',
  });

  const res = await performLiveResearch('Test query', {
    apiKey: 'test_valid_key_1234',
    fetchFn: mockFetch,
  });

  assert.equal(res.ok, false);
  assert.ok(res.error.includes('500'));
});

test('Research Execution - Timeout cleanly aborts without hanging', async () => {
  const hangingFetch = (_url, { signal }) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ ok: true, json: async () => ({}) }), 5000);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    });

  const t0 = Date.now();
  const res = await performLiveResearch('Timeout query', {
    apiKey: 'test_valid_key_1234',
    timeoutMs: 100,
    fetchFn: hangingFetch,
  });
  const duration = Date.now() - t0;

  assert.equal(res.ok, false);
  assert.equal(res.error, 'timeout');
  assert.ok(duration < 1000, `Expected duration < 1000ms, got ${duration}ms`);
});

test('Research Execution - AbortSignal cancels in-flight search immediately', async () => {
  const controller = new AbortController();
  const fetchMock = (_url, { signal }) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ ok: true, json: async () => ({}) }), 3000);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    });

  const promise = performLiveResearch('Abort query', {
    apiKey: 'test_valid_key_1234',
    signal: controller.signal,
    fetchFn: fetchMock,
  });

  // Trigger mid-flight barge-in abort
  setTimeout(() => controller.abort(), 50);
  const res = await promise;

  assert.equal(res.ok, false);
  assert.equal(res.error, 'aborted');
});

// --- 6. Task Engine Integration ---
test('Task Integration - executeScaffoldTask incorporates researchContext when provided', async () => {
  const events = [];
  const fakeWs = {};
  const fakeState = { generation: 1 };
  const mockResearch = {
    query: 'TypeScript Express current best practices',
    results: [
      {
        title: 'Express 5 Migration Guide',
        url: 'https://expressjs.com/5',
        snippet: 'Modern Express 5 with native promises and strict TS.',
      },
    ],
  };
  const researchContext = formatResearchContextForLLM(mockResearch);

  await executeScaffoldTask({
    ws: fakeWs,
    state: fakeState,
    myGen: 1,
    userText: 'Create a TypeScript Express REST API using current best practices',
    signal: new AbortController().signal,
    send: (_ws, msg) => events.push(msg),
    rimeConfig: { apiKey: '', mockAudio: true, speaker: 'astra', modelId: 'mistv3' },
    llmConfig: { provider: 'gemini', apiKey: '', model: 'gemini-3.5-flash-lite', mock: true },
    researchContext,
    researchData: mockResearch,
  });

  const started = events.find((e) => e.type === 'task_started');
  assert.ok(started, 'task_started event emitted');
  assert.equal(started.totalSteps, 6, 'Contains research step in 6-step workflow');
  assert.ok(started.steps[0].name.includes('Research current'));
  assert.ok(started.research, 'Research attached to task_started');

  const complete = events.find((e) => e.type === 'task_complete');
  assert.ok(complete, 'task_complete event emitted');
  assert.ok(complete.research, 'Research attached to task_complete');
  assert.equal(complete.research.query, 'TypeScript Express current best practices');
});

test('Task Integration - executeScaffoldTask baseline without research retains 5 steps', async () => {
  const events = [];
  await executeScaffoldTask({
    ws: {},
    state: { generation: 1 },
    myGen: 1,
    userText: 'Create an Express REST API in JavaScript',
    signal: new AbortController().signal,
    send: (_ws, msg) => events.push(msg),
    rimeConfig: { apiKey: '', mockAudio: true, speaker: 'astra', modelId: 'mistv3' },
    llmConfig: { provider: 'gemini', apiKey: '', model: 'gemini-3.5-flash-lite', mock: true },
  });

  const started = events.find((e) => e.type === 'task_started');
  assert.equal(started.totalSteps, 5, 'Standard scaffolding remains exactly 5 steps');
  assert.equal(started.research, null);
});

// --- 7. Full WebSocket Server Turn with SerpApi Mock ---
test('WebSocket Turn - Emits research_started, research_result, and attaches research to ai_text', async () => {
  const mockResearchResults = {
    organic_results: [
      {
        title: 'Node.js 24 Official Release Notes',
        link: 'https://nodejs.org/en/blog/release/v24.0.0',
        snippet: 'Node.js 24 brings built-in TypeScript support and updated V8 engine.',
        source: 'nodejs.org',
      },
    ],
  };

  const server = createAuroraServer({
    mock: true,
    quiet: true,
    serpapiEnabled: true,
    serpapiKey: 'test_serpapi_dummy_key_1234',
    mockResearchResults,
  });
  const { port } = await server.listen(0);
  const ws = new WebSocket(`ws://localhost:${port}`);

  try {
    const received = [];
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Turn timeout')), 6000);

      ws.on('open', () => {
        ws.send(
          JSON.stringify({
            type: 'query',
            text: 'What are the latest features in Node.js 24?',
            sessionId: 'test-research-session',
          })
        );
      });

      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        received.push(msg);
        if (msg.type === 'done') {
          clearTimeout(timeout);
          ws.close();
          resolve();
        }
      });

      ws.on('error', reject);
    });

    const researchStarted = received.find((m) => m.type === 'research_started');
    assert.ok(researchStarted, 'research_started event was received');
    assert.ok(researchStarted.query.length > 0);

    const researchResult = received.find((m) => m.type === 'research_result');
    assert.ok(researchResult, 'research_result event was received');
    assert.equal(researchResult.results.length, 1);
    assert.equal(researchResult.results[0].source, 'nodejs.org');

    const aiText = received.find((m) => m.type === 'ai_text');
    assert.ok(aiText, 'ai_text was received');
    assert.ok(aiText.research, 'Research payload attached to ai_text');
    assert.equal(aiText.research.results.length, 1);
  } finally {
    await server.close();
  }
});

test('WebSocket Turn - SERPAPI_ENABLED=false does NOT run research (baseline preservation)', async () => {
  const server = createAuroraServer({
    mock: true,
    quiet: true,
    serpapiEnabled: false,
  });
  const { port } = await server.listen(0);
  const ws = new WebSocket(`ws://localhost:${port}`);

  try {
    const received = [];
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Turn timeout')), 6000);

      ws.on('open', () => {
        ws.send(
          JSON.stringify({
            type: 'query',
            text: 'What are the latest features in Node.js 24?',
            sessionId: 'test-disabled-research-session',
          })
        );
      });

      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        received.push(msg);
        if (msg.type === 'done') {
          clearTimeout(timeout);
          ws.close();
          resolve();
        }
      });

      ws.on('error', reject);
    });

    const researchStarted = received.find((m) => m.type === 'research_started');
    assert.equal(
      researchStarted,
      undefined,
      'research_started should not be emitted when disabled'
    );

    const aiText = received.find((m) => m.type === 'ai_text');
    assert.ok(aiText, 'Normal ai_text response still produced');
    assert.equal(aiText.research, null);
  } finally {
    await server.close();
  }
});

// --- 8. Security & Zero Key Leakage ---
test('Security - SerpApi key is never leaked in errors, logs, or payload metadata', () => {
  const secretKey = 'test_super_secret_serpapi_key_9999';
  const leakedError = `Error connecting to SerpApi: api_key=${secretKey} forbidden`;
  const sanitized = sanitizeError(leakedError);

  assert.ok(!sanitized.includes('super_secret_serpapi'), 'SerpApi key masked in logs');
  assert.ok(sanitized.includes('***REDACTED***'));
});
