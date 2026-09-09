// tests/routing-scenarios.test.js
// Comprehensive test suite for Intelligent Response Routing in Aurora.
// Tests:
// 1. Server-Side Safety Guardrails & Contract Validation
// 2. Live WebSocket VOICE Modality Requests
// 3. Live WebSocket TEXT Modality Requests
// 4. Live WebSocket HYBRID Modality Requests
// 5. Multi-Turn Conversational Modality Transitions
// 6. Barge-in / Mid-Turn Interruption & Generation Fencing

import assert from 'node:assert';
import WebSocket from 'ws';
import {
  RESPONSE_MODES,
  SPOKEN_BUDGETS,
  containsStructuredContent,
  enforceSpokenBudget,
  deterministicClassify,
  validateAndEnforceContract,
} from '../server/response-router.js';

const WS_URL = 'ws://localhost:3000';

function runWsQuery(query, options = {}) {
  const { modeOverride, timeoutMs = 25000, existingWs, existingGen } = options;

  return new Promise((resolve, reject) => {
    const ws = existingWs || new WebSocket(WS_URL);
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
function testGuardrails() {
  console.log('\n==================================================');
  console.log('TEST SUITE 1: Server-Side Safety Guardrails & Contract Enforcement');
  console.log('==================================================');

  // Test 1.1: containsStructuredContent detection
  console.log('-> 1.1: Testing containsStructuredContent detector...');
  assert.strictEqual(containsStructuredContent('def is_prime(n):\n    return True'), true, 'Python code detected');
  assert.strictEqual(containsStructuredContent('| Name | Speed |\n|---|---|\n| C++ | Fast |'), true, 'Table detected');
  assert.strictEqual(containsStructuredContent('#include <iostream>\nint main() {}'), true, 'C++ code detected');
  assert.strictEqual(containsStructuredContent('Paris is the capital of France.'), false, 'Plain text passes clean');
  console.log('   ✅ Structured content detection verified');

  // Test 1.2: enforceSpokenBudget sentence-aware trimming
  console.log('-> 1.2: Testing enforceSpokenBudget sentence-aware trimming...');
  const longSentence = "This is sentence one. This is sentence two. This is sentence three which exceeds the limit of twenty words drastically.";
  const budgeted = enforceSpokenBudget(longSentence, 'TEXT');
  const wordCount = budgeted.split(/\s+/).length;
  assert.ok(wordCount <= SPOKEN_BUDGETS.TEXT, `Budget exceeded: ${wordCount} > ${SPOKEN_BUDGETS.TEXT}`);
  assert.ok(/[.!?]$/.test(budgeted), 'Budgeted text ends with punctuation');
  console.log(`   ✅ Spoken budget enforced: "${budgeted}" (${wordCount} words)`);

  // Test 1.3: Model misclassification recovery (Model returns VOICE, but generated code)
  console.log('-> 1.3: Testing safety correction on hallucinated VOICE mode with code...');
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
  assert.strictEqual(corrected.responseMode, 'TEXT', 'Elevated from VOICE to TEXT');
  assert.strictEqual(containsStructuredContent(corrected.spokenResponse), false, 'Raw code sanitized from spokenResponse');
  assert.ok(corrected.spokenResponse.includes('workspace'), 'Spoken response directs user to workspace');
  console.log(`   ✅ Corrected misclassification: Mode=${corrected.responseMode}, Spoken="${corrected.spokenResponse}"`);

  // Test 1.4: Code syntax in spoken channel sanitized
  console.log('-> 1.4: Testing code sanitization in spoken channel...');
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
  assert.strictEqual(sanitized.responseMode, 'HYBRID');
  assert.ok(!sanitized.spokenResponse.includes('`'), 'Backticks stripped from spoken text');
  console.log(`   ✅ Spoken channel sanitized: "${sanitized.spokenResponse}"`);

  // Test 1.5: User mode override
  console.log('-> 1.5: Testing user mode override...');
  const overridden = validateAndEnforceContract(
    { responseMode: 'VOICE', spokenResponse: 'Polymorphism is the ability of objects to take on different forms.', visualResponse: { type: 'text', content: 'Polymorphism details' } },
    'What is polymorphism?',
    [],
    'TEXT'
  );
  assert.strictEqual(overridden.responseMode, 'TEXT', 'Explicit user override honoured');
  console.log(`   ✅ User override to TEXT successfully honoured`);
}

// ---------------------------------------------------------------------------
// SUITE 2: Live WebSocket Routing Scenarios (VOICE, TEXT, HYBRID)
// ---------------------------------------------------------------------------
async function testLiveRoutingScenarios() {
  console.log('\n==================================================');
  console.log('TEST SUITE 2: Live WebSocket Routing Scenarios');
  console.log('==================================================');

  // Scenario 2.1: VOICE Modality
  console.log('\n-> 2.1: Testing VOICE modality ("What is the capital of Japan?")...');
  const voiceResult = await runWsQuery('What is the capital of Japan?');
  const voiceAi = voiceResult.lastAiText;
  assert.ok(voiceAi, 'Received ai_text message');
  console.log('   Response Mode:', voiceAi.responseMode);
  console.log('   Spoken:', voiceAi.spoken);
  console.log('   Visual Type:', voiceAi.visualType);
  assert.strictEqual(voiceAi.responseMode, 'VOICE', 'Expected VOICE responseMode');
  assert.strictEqual(voiceAi.visualType, 'text', 'Expected text visualType');
  const voiceWords = (voiceAi.spoken || '').split(/\s+/).length;
  assert.ok(voiceWords <= 35, `Voice spoken budget exceeded: ${voiceWords} words`);
  assert.strictEqual(containsStructuredContent(voiceAi.spoken), false, 'No structured syntax in speech');
  console.log('   ✅ SCENARIO 2.1 PASSED (VOICE)');

  // Scenario 2.2: TEXT Modality - Code Generation
  console.log('\n-> 2.2: Testing TEXT modality ("Write a binary search in C++")...');
  const textResult = await runWsQuery('Write a binary search function in C++');
  const textAi = textResult.lastAiText;
  assert.ok(textAi, 'Received ai_text message');
  console.log('   Response Mode:', textAi.responseMode);
  console.log('   Spoken:', textAi.spoken);
  console.log('   Visual Type:', textAi.visualType);
  console.log('   Language:', textAi.language);
  assert.strictEqual(textAi.responseMode, 'TEXT', 'Expected TEXT responseMode');
  assert.strictEqual(textAi.visualType, 'code', 'Expected code visualType');
  const textWords = (textAi.spoken || '').split(/\s+/).length;
  assert.ok(textWords <= 20, `Text spoken budget exceeded: ${textWords} words`);
  assert.strictEqual(containsStructuredContent(textAi.spoken), false, 'Never read code syntax aloud');
  assert.ok(textAi.text.includes('binary_search') || textAi.text.includes('int'), 'Code contains binary search');
  console.log('   ✅ SCENARIO 2.2 PASSED (TEXT - Code Generation)');

  // Scenario 2.3: TEXT Modality - Comparison Table
  console.log('\n-> 2.3: Testing TEXT modality ("Compare React and Vue in a markdown table")...');
  const tableResult = await runWsQuery('Compare React and Vue in a table');
  const tableAi = tableResult.lastAiText;
  assert.ok(tableAi, 'Received ai_text message');
  console.log('   Response Mode:', tableAi.responseMode);
  console.log('   Spoken:', tableAi.spoken);
  console.log('   Visual Type:', tableAi.visualType);
  assert.strictEqual(tableAi.responseMode, 'TEXT', 'Expected TEXT responseMode');
  assert.strictEqual(tableAi.visualType, 'table', 'Expected table visualType');
  assert.ok(tableAi.text.includes('|'), 'Contains table syntax');
  assert.ok(!tableAi.spoken.includes('|'), 'Spoken audio does not contain table pipes');
  console.log('   ✅ SCENARIO 2.3 PASSED (TEXT - Table)');

  // Scenario 2.4: HYBRID Modality - Explanation + Implementation
  console.log('\n-> 2.4: Testing HYBRID modality ("Explain quicksort and provide Python code")...');
  const hybridResult = await runWsQuery('Explain quicksort and write a python implementation');
  const hybridAi = hybridResult.lastAiText;
  assert.ok(hybridAi, 'Received ai_text message');
  console.log('   Response Mode:', hybridAi.responseMode);
  console.log('   Spoken:', hybridAi.spoken);
  console.log('   Visual Type:', hybridAi.visualType);
  assert.strictEqual(hybridAi.responseMode, 'HYBRID', 'Expected HYBRID responseMode');
  const hybridWords = (hybridAi.spoken || '').split(/\s+/).length;
  assert.ok(hybridWords <= 30, `Hybrid spoken budget exceeded: ${hybridWords} words`);
  assert.strictEqual(containsStructuredContent(hybridAi.spoken), false, 'No raw code in speech');
  assert.ok(hybridAi.text.length > 50, 'Visual artifact is rich and complete');
  console.log('   ✅ SCENARIO 2.4 PASSED (HYBRID)');
}

// ---------------------------------------------------------------------------
// SUITE 3: Multi-Turn Modality Transitions
// ---------------------------------------------------------------------------
async function testMultiTurnTransitions() {
  console.log('\n==================================================');
  console.log('TEST SUITE 3: Multi-Turn Conversational Modality Transitions');
  console.log('==================================================');

  const ws = new WebSocket(WS_URL);
  await new Promise((resolve) => ws.on('open', resolve));

  // Wait for handshake
  let currentGen = 0;
  await new Promise((resolve) => {
    ws.on('message', function onH(data) {
      const m = JSON.parse(data.toString());
      if (m.type === 'handshake') {
        currentGen = m.generation;
        ws.removeListener('message', onH);
        resolve();
      }
    });
  });

  // Turn 1: Concept -> VOICE
  console.log('-> Turn 1: "What is recursion?" (Expecting VOICE)');
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
  console.log(`   Turn 1: Mode=${turn1Ai.responseMode}, VisualType=${turn1Ai.visualType}`);
  assert.strictEqual(turn1Ai.responseMode, 'VOICE');

  // Turn 2: Follow-up requesting code -> TEXT
  console.log('-> Turn 2: "Now write the Python code for it." (Expecting TEXT)');
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
  console.log(`   Turn 2: Mode=${turn2Ai.responseMode}, VisualType=${turn2Ai.visualType}`);
  assert.strictEqual(turn2Ai.responseMode, 'TEXT');
  assert.strictEqual(turn2Ai.visualType, 'code');

  // Turn 3: Conceptual question about the code -> VOICE
  console.log('-> Turn 3: "Why is a base case required?" (Expecting VOICE)');
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
  console.log(`   Turn 3: Mode=${turn3Ai.responseMode}, VisualType=${turn3Ai.visualType}`);
  assert.strictEqual(turn3Ai.responseMode, 'VOICE');

  ws.close();
  console.log('   ✅ SUITE 3 PASSED: Dynamic multi-turn transitions VOICE -> TEXT -> VOICE verified');
}

// ---------------------------------------------------------------------------
// SUITE 4: Barge-In Interruption with Generation Fencing
// ---------------------------------------------------------------------------
async function testBargeInWithRouting() {
  console.log('\n==================================================');
  console.log('TEST SUITE 4: Barge-In Interruption & Generation Fencing');
  console.log('==================================================');

  const ws = new WebSocket(WS_URL);
  await new Promise((resolve) => ws.on('open', resolve));

  // Set artificial network delay of 1200ms to test interruption mid-flight
  ws.send(JSON.stringify({ type: 'set_delay', delayMs: 1200 }));
  await new Promise((r) => setTimeout(r, 100));

  let turn1Gen = 0;
  let turn2Gen = 0;
  let receivedTurn1Audio = false;
  let receivedTurn2Audio = false;

  const messages = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    messages.push(m);

    if (m.type === 'user_text' && m.text.includes('Turn 1')) {
      turn1Gen = m.generation;
    }
    if (m.type === 'user_text' && m.text.includes('Turn 2')) {
      turn2Gen = m.generation;
    }
    if (m.type === 'audio' && m.generation === turn1Gen) {
      receivedTurn1Audio = true;
    }
    if (m.type === 'audio' && m.generation === turn2Gen) {
      receivedTurn2Audio = true;
    }
  });

  // Start Turn 1
  console.log('-> Sending Turn 1 query...');
  ws.send(JSON.stringify({ type: 'query', text: 'Turn 1: Explain the theory of relativity in detail', timestamp: Date.now() }));

  // Wait 250ms while LLM is generating, then send barge-in interruption with Turn 2
  await new Promise((r) => setTimeout(r, 250));
  console.log('-> Triggering immediate Barge-in interrupt with Turn 2...');
  const tInterrupt = Date.now();
  ws.send(JSON.stringify({ type: 'interrupt', timestamp: tInterrupt }));
  ws.send(JSON.stringify({ type: 'query', text: 'Turn 2: What is 2 plus 2?', timestamp: Date.now() }));

  // Wait for Turn 2 completion
  await new Promise((resolve) => {
    const checkDone = setInterval(() => {
      const turn2Done = messages.some((m) => m.type === 'done' && m.generation === turn2Gen && turn2Gen > 0);
      if (turn2Done) {
        clearInterval(checkDone);
        resolve();
      }
    }, 100);
  });

  // Restore artificial delay to 0
  ws.send(JSON.stringify({ type: 'set_delay', delayMs: 0 }));
  ws.close();

  assert.strictEqual(receivedTurn1Audio, false, 'Turn 1 audio was strictly fenced and cancelled');
  const interruptedMsg = messages.find((m) => m.type === 'interrupted');
  assert.ok(interruptedMsg, 'Received interrupted ACK from server');
  console.log(`   ⚡ Interrupted ACK confirmed: Gen #${interruptedMsg.oldGeneration} -> #${interruptedMsg.newGeneration}`);
  console.log('   ✅ SUITE 4 PASSED: Barge-in interruption & generation fencing 100% verified');
}

// ---------------------------------------------------------------------------
// Main Runner
// ---------------------------------------------------------------------------
async function main() {
  console.log('🚀 RUNNING AURORA INTELLIGENT ROUTING TEST SUITE');
  try {
    testGuardrails();
    await testLiveRoutingScenarios();
    await testMultiTurnTransitions();
    await testBargeInWithRouting();

    console.log('\n==================================================');
    console.log('🎉 ALL 4 ROUTING TEST SUITES PASSED SUCCESSFULLY!');
    console.log('==================================================\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ TEST SUITE FAILED:', err);
    process.exit(1);
  }
}

main();
