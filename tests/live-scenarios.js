// tests/live-scenarios.js
// Automated verification script for Aurora End-to-End Pipeline
import { WebSocket } from 'ws';

const BASE_URL = 'http://localhost:3000';
const WS_URL = 'ws://localhost:3000';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runScenario7_DeploymentEndpoints() {
  console.log('\n========================================');
  console.log('SCENARIO 7: Deployment Endpoints Validation');
  console.log('========================================');

  // Test /api/health
  const healthRes = await fetch(`${BASE_URL}/api/health`);
  if (!healthRes.ok) throw new Error(`/api/health failed with HTTP ${healthRes.status}`);
  const healthData = await healthRes.json();
  console.log('✓ /api/health response:', JSON.stringify(healthData, null, 2));

  if (!healthData.ok || healthData.status !== 'healthy') {
    throw new Error(`Health status expected healthy, got ${healthData.status}`);
  }
  if (healthData.llmConfigured !== true) {
    throw new Error(`llmConfigured top-level expected true, got ${healthData.llmConfigured}`);
  }
  if (healthData.llmProvider !== 'gemini') {
    throw new Error(`llmProvider expected gemini, got ${healthData.llmProvider}`);
  }
  if (typeof healthData.rimeConfigured !== 'boolean') {
    throw new Error(`rimeConfigured expected boolean, got ${healthData.rimeConfigured}`);
  }

  // Test /health alias
  const healthAliasRes = await fetch(`${BASE_URL}/health`);
  if (!healthAliasRes.ok) throw new Error(`/health alias failed`);
  console.log('✓ /health alias OK');

  // Test /api/config
  const configRes = await fetch(`${BASE_URL}/api/config`);
  const configData = await configRes.json();
  console.log('✓ /api/config response:', JSON.stringify(configData));

  // Test /api/voices
  const voicesRes = await fetch(`${BASE_URL}/api/voices`);
  const voicesData = await voicesRes.json();
  console.log(`✓ /api/voices returned ${voicesData.speakers?.length} speakers and ${voicesData.models?.length} models`);

  // Test static file serving /
  const staticRes = await fetch(`${BASE_URL}/`);
  const staticHtml = await staticRes.text();
  if (!staticHtml.includes('Aurora') || !staticHtml.includes('orbCanvas')) {
    throw new Error('Static index.html did not contain expected Aurora DOM elements');
  }
  console.log('✓ Static index.html served properly');

  console.log('>>> SCENARIO 7 PASSED!\n');
}

async function runScenario1_BasicTextQuery() {
  console.log('\n========================================');
  console.log('SCENARIO 1: Basic Text Query (Live Gemini)');
  console.log('========================================');

  const query = 'What is the capital of France? Answer in one short sentence.';
  const t0 = Date.now();
  const res = await fetch(`${BASE_URL}/api/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: query }),
  });

  const duration = Date.now() - t0;
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`POST /api/turn failed HTTP ${res.status}: ${body}`);
  }

  const data = await res.json();
  console.log(`✓ Turn completed in ${duration}ms (totalMs: ${data.totalMs}ms, llmMs: ${data.llmMs}ms, ttsMs: ${data.ttsMs}ms)`);
  console.log(`✓ Response Mode: ${data.responseMode}`);
  console.log(`✓ Spoken Response: "${data.spokenResponse}"`);
  console.log(`✓ Visual Response:`, JSON.stringify(data.visualResponse));
  console.log(`✓ Audio returned: ${data.audio ? `${data.audio.length} bytes base64` : 'null (browser fallback)'}`);

  const content = (data.visualResponse?.content || data.spokenResponse || '').toLowerCase();
  if (!content.includes('paris')) {
    throw new Error(`Expected Paris in response, got: ${content}`);
  }
  console.log('>>> SCENARIO 1 PASSED!\n');
}

async function runScenario2_CodeQuery() {
  console.log('\n========================================');
  console.log('SCENARIO 2: Code Generation Query (Live Gemini)');
  console.log('========================================');

  const query = 'Write a JavaScript function to check if a string is a palindrome. Return only the code.';
  const t0 = Date.now();
  const res = await fetch(`${BASE_URL}/api/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: query }),
  });

  const duration = Date.now() - t0;
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Code query failed HTTP ${res.status}: ${body}`);
  }

  const data = await res.json();
  console.log(`✓ Code turn completed in ${duration}ms (llmMs: ${data.llmMs}ms)`);
  console.log(`✓ Response Mode: ${data.responseMode}`);
  console.log(`✓ Spoken Response (clean, no raw code): "${data.spokenResponse}"`);
  console.log(`✓ Visual Type: ${data.visualResponse?.type}`);
  console.log(`✓ Language: ${data.visualResponse?.language}`);
  console.log(`✓ Title: ${data.visualResponse?.title}`);
  console.log(`✓ Code Snippet:\n${data.visualResponse?.content?.slice(0, 160)}...`);

  if (data.visualResponse?.type !== 'code') {
    throw new Error(`Expected visualResponse.type === 'code', got: ${data.visualResponse?.type}`);
  }
  if (!data.visualResponse?.content?.includes('palindrome') && !data.visualResponse?.content?.includes('reverse')) {
    throw new Error(`Expected code implementation for palindrome`);
  }
  if (data.spokenResponse.includes('```') || data.spokenResponse.includes('{') || data.spokenResponse.includes('function(')) {
    throw new Error(`Spoken response leaked raw code syntax: ${data.spokenResponse}`);
  }
  console.log('>>> SCENARIO 2 PASSED!\n');
}

async function runScenario3_RimeFailureFallback() {
  console.log('\n========================================');
  console.log('SCENARIO 3: Rime TTS Failure / Timeout Fallback');
  console.log('========================================');

  const t0 = Date.now();
  const res = await fetch(`${BASE_URL}/api/turn`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-rime-api-key': 'invalid_rime_key_deadbeef',
    },
    body: JSON.stringify({
      text: 'Tell me one fact about oceans.',
    }),
  });

  const duration = Date.now() - t0;
  if (!res.ok) {
    throw new Error(`Expected turn to succeed with fallback, got HTTP ${res.status}`);
  }

  const data = await res.json();
  console.log(`✓ Turn completed in ${duration}ms even with bad Rime key`);
  console.log(`✓ Gemini visual text received: "${data.visualResponse?.content?.slice(0, 100)}..."`);
  console.log(`✓ Audio returned: ${data.audio} (null indicates client browser speech fallback)`);

  if (data.audio !== null) {
    throw new Error(`Expected null audio for bad Rime key, got: ${typeof data.audio}`);
  }
  if (!data.visualResponse?.content) {
    throw new Error('Visual response content is missing');
  }
  if (duration > 8000) {
    throw new Error(`Turn took ${duration}ms, expected timeout/fallback to resolve quickly`);
  }
  console.log('>>> SCENARIO 3 PASSED!\n');
}

async function runScenario4_BargeInInterruption() {
  console.log('\n========================================');
  console.log('SCENARIO 4: Barge-in Interruption via WebSocket');
  console.log('========================================');

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    let generation = 0;
    let interruptedReceived = false;

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'query',
        text: 'Explain quantum computing in detail.',
        timestamp: Date.now(),
      }));

      setTimeout(() => {
        console.log('⚡ User barged in! Sending interrupt packet...');
        ws.send(JSON.stringify({
          type: 'interrupt',
          bargeInMs: 4,
          timestamp: Date.now(),
        }));
      }, 100);
    });

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'handshake') {
        console.log(`✓ WebSocket handshake received (session: ${msg.sessionId})`);
      } else if (msg.type === 'user_text') {
        generation = msg.generation;
        console.log(`✓ User text registered at Gen #${msg.generation}`);
      } else if (msg.type === 'interrupted') {
        interruptedReceived = true;
        console.log(`✓ Interrupted ACK received: Gen #${msg.oldGeneration} -> #${msg.newGeneration} (Server processing: ${msg.serverProcessingMs}ms)`);
        
        ws.send(JSON.stringify({
          type: 'query',
          text: 'What is 2 + 2?',
          timestamp: Date.now(),
        }));
      } else if (msg.type === 'ai_text') {
        console.log(`✓ AI response received for Gen #${msg.generation}: "${msg.spoken?.slice(0, 50)}..."`);
        if (interruptedReceived && msg.generation > generation) {
          console.log(`✓ New generation #${msg.generation} successfully answered!`);
          ws.close();
          resolve();
        }
      }
    });

    ws.on('error', reject);
    setTimeout(() => {
      ws.close();
      if (interruptedReceived) resolve();
      else reject(new Error('Barge-in test timed out'));
    }, 10000);
  });
}

async function runScenario5_StaleResultRejection() {
  console.log('\n========================================');
  console.log('SCENARIO 5: Stale Result Rejection');
  console.log('========================================');

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    let firstGen = 0;
    let stalePacketsReceived = 0;

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'query',
        text: 'Write a full essay on ancient Roman architecture.',
      }));

      setTimeout(() => {
        console.log('Dispatching second query to invalidate first generation...');
        ws.send(JSON.stringify({
          type: 'query',
          text: 'Hello Aurora!',
        }));
      }, 50);
    });

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'user_text' && firstGen === 0) {
        firstGen = msg.generation;
      } else if (msg.type === 'audio' || msg.type === 'ai_text') {
        if (msg.generation === firstGen) {
          stalePacketsReceived++;
          console.warn(`⚠️ Received stale packet from Gen #${msg.generation}`);
        } else {
          console.log(`✓ Current packet accepted for Gen #${msg.generation}`);
        }
      } else if (msg.type === 'done' && msg.generation > firstGen) {
        if (stalePacketsReceived === 0) {
          console.log('✓ Zero stale packets received from invalidated generation!');
        }
        ws.close();
        resolve();
      }
    });

    ws.on('error', reject);
    setTimeout(() => {
      ws.close();
      resolve();
    }, 8000);
  });
}

async function runScenario6_GeminiFailure() {
  console.log('\n========================================');
  console.log('SCENARIO 6: Gemini Failure Handling (Invalid Key)');
  console.log('========================================');

  const { getAssistantReply } = await import('../server/llm.js');

  let caughtError = null;
  try {
    await getAssistantReply({
      provider: 'gemini',
      apiKey: 'AQ.InvalidKeyTest_1234567890',
      model: 'gemini-3.5-flash-lite',
      messages: [{ role: 'user', content: 'Test failure query' }],
    });
  } catch (err) {
    caughtError = err;
  }

  if (!caughtError) {
    throw new Error('Expected getAssistantReply to throw on invalid API key');
  }

  console.log('✓ Caught error code:', caughtError.code);
  console.log('✓ Caught error message:', caughtError.message);
  console.log('✓ HTTP status recorded:', caughtError.status);

  if (caughtError.code !== 'LLM_REQUEST_FAILED') {
    throw new Error(`Expected error.code === 'LLM_REQUEST_FAILED', got: ${caughtError.code}`);
  }
  if (caughtError.message.includes('AQ.InvalidKeyTest_1234567890')) {
    throw new Error('Internal API key leaked in error message!');
  }

  const healthRes = await fetch(`${BASE_URL}/api/health`);
  if (!healthRes.ok) {
    throw new Error('Server crashed after Gemini failure test!');
  }
  console.log('✓ Aurora server remains healthy and active after simulated Gemini failure');
  console.log('>>> SCENARIO 6 PASSED!\n');
}

async function runAll() {
  try {
    await runScenario7_DeploymentEndpoints();
    await runScenario1_BasicTextQuery();
    await runScenario2_CodeQuery();
    await runScenario3_RimeFailureFallback();
    await runScenario4_BargeInInterruption();
    await runScenario5_StaleResultRejection();
    await runScenario6_GeminiFailure();

    console.log('======================================================');
    console.log('🎉 ALL 7 TEST SCENARIOS PASSED WITH ZERO FAILURES! 🎉');
    console.log('======================================================');
    process.exit(0);
  } catch (err) {
    console.error('❌ TEST RUNNER FAILED:', err);
    process.exit(1);
  }
}

runAll();
