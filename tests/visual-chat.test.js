// tests/visual-chat.test.js
// Automated test suite for Aurora's Visual Chat & Output System.
// Tests:
// 1. Spoken vs Visual Separation (Spoken brevity, visual richness)
// 2. Code Generation (C++ reverse string -> visualType: code, language: cpp)
// 3. Table Generation (Language comparison -> visualType: table)
// 4. Task Execution (Scaffold Express REST API -> task_started, progress, complete)
// 5. Mid-Flight Task Barge-in (Cancel in-flight task A and switch cleanly to task B)

import WebSocket from 'ws';

const URL = 'ws://localhost:3000';

async function runVisualChatTestSuite() {
  console.log('====================================================');
  console.log('🧪 RUNNING AURORA VISUAL CHAT & OUTPUT TEST SUITE');
  console.log(`📡 Connecting to: ${URL}`);
  console.log('====================================================\n');

  const ws = new WebSocket(URL);

  let currentGen = 0;
  let testStep = 0;
  let taskProgressCount = 0;

  ws.on('open', () => {
    console.log('✓ WebSocket connected successfully.\n');
  });

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());

    switch (msg.type) {
      case 'handshake':
        currentGen = msg.generation;
        console.log(`[HANDSHAKE] Gen: #${currentGen}, TTS: ${msg.rimeConfigured}, LLM: ${msg.llmConfigured}`);
        startTest1();
        break;

      case 'ai_text':
        handleAiText(msg);
        break;

      case 'task_started':
        console.log(`  -> [TASK STARTED] ${msg.title} (${msg.totalSteps} steps)`);
        break;

      case 'task_progress':
        taskProgressCount++;
        console.log(`  -> [TASK PROGRESS] Step ${msg.stepIndex + 1}: ${msg.details}`);
        if (testStep === 4 && taskProgressCount === 2) {
          // Mid-flight task barge-in: Interrupt and switch to TypeScript!
          console.log('\n  -> ⚡ USER BARGE-IN MID-TASK! "WAIT! Use TypeScript instead"');
          ws.send(JSON.stringify({ type: 'interrupt' }));
          setTimeout(() => {
            testStep = 5;
            ws.send(JSON.stringify({ type: 'query', text: 'Wait! Scaffold an Express REST API in TypeScript instead' }));
          }, 50);
        }
        break;

      case 'task_complete':
        console.log(`  -> [TASK COMPLETE] ${msg.title}`);
        if (msg.primaryCode) {
          console.log(`     Primary Code: ${msg.primaryCode.filename} (${msg.primaryCode.language}) - ${msg.primaryCode.code.length} bytes`);
        }
        if (testStep === 3) {
          console.log('✅ TEST 3 PASSED: Task execution completed with streaming progress and code scaffolding.\n');
          startTest4();
        } else if (testStep === 5) {
          if (msg.primaryCode?.language === 'typescript') {
            console.log('✅ TEST 5 PASSED: Barge-in cancelled JavaScript task and cleanly completed TypeScript task!\n');
            finishSuite();
          } else {
            console.error('❌ TEST 5 FAILED: Expected TypeScript code but got:', msg.primaryCode?.language);
            process.exit(1);
          }
        }
        break;

      case 'interrupted':
        console.log(`  -> [INTERRUPT ACK] Gen #${msg.oldGeneration} cancelled -> #${msg.newGeneration}`);
        break;
    }
  });

  function startTest1() {
    testStep = 1;
    console.log('--- TEST 1: C++ Code Request (Visual Code Block + Short Spoken Summary) ---');
    ws.send(JSON.stringify({ type: 'query', text: 'Write a C++ program to reverse a string.' }));
  }

  function startTest2() {
    testStep = 2;
    console.log('--- TEST 2: Comparison Table Request (Visual Table + Short Spoken Summary) ---');
    ws.send(JSON.stringify({ type: 'query', text: 'Compare C++ and Python in a table.' }));
  }

  function startTest3() {
    testStep = 3;
    console.log('--- TEST 3: Multi-Step Task (Express REST API Scaffolding) ---');
    ws.send(JSON.stringify({ type: 'query', text: 'Create an Express REST API in JavaScript' }));
  }

  function startTest4() {
    testStep = 4;
    taskProgressCount = 0;
    console.log('--- TEST 4 & 5: Task Barge-In Interruption & Recovery ---');
    console.log('  -> Starting JavaScript scaffolding task...');
    ws.send(JSON.stringify({ type: 'query', text: 'Create an Express REST API in JavaScript' }));
  }

  function handleAiText(msg) {
    if (testStep === 1) {
      console.log(`  -> Visual Type: "${msg.visualType}", Language: "${msg.language}"`);
      console.log(`  -> Spoken (Rime TTS): "${msg.spoken}"`);
      console.log(`  -> Code Length: ${msg.text.length} characters`);

      if (msg.visualType === 'code' && (msg.language === 'cpp' || msg.language === 'c++')) {
        if (msg.spoken && !msg.spoken.includes('#include') && !msg.spoken.includes('cout')) {
          console.log('✅ TEST 1 PASSED: Code separated cleanly from spoken channel!\n');
          startTest2();
          return;
        }
      }
      console.error('❌ TEST 1 FAILED:', msg);
      process.exit(1);
    }

    if (testStep === 2) {
      console.log(`  -> Visual Type: "${msg.visualType}"`);
      console.log(`  -> Spoken (Rime TTS): "${msg.spoken}"`);
      console.log(`  -> Content Table Detected: ${msg.text.includes('|')}`);

      if (msg.visualType === 'table' && msg.text.includes('|')) {
        if (msg.spoken && !msg.spoken.includes('|')) {
          console.log('✅ TEST 2 PASSED: Table formatted visually with concise spoken confirmation!\n');
          startTest3();
          return;
        }
      }
      console.error('❌ TEST 2 FAILED:', msg);
      process.exit(1);
    }
  }

  function finishSuite() {
    console.log('====================================================');
    console.log('🎉 ALL 5 VISUAL CHAT & TASK TESTS PASSED 100%');
    console.log('====================================================');
    ws.close();
    process.exit(0);
  }

  setTimeout(() => {
    console.error('❌ Test suite timed out after 30s.');
    process.exit(1);
  }, 30000);
}

runVisualChatTestSuite().catch((err) => {
  console.error('Test suite error:', err);
  process.exit(1);
});
