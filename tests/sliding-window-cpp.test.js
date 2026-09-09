// tests/sliding-window-cpp.test.js
// Verifies that multi-turn code requests like "I want it in C++"
// return clean, syntax-highlighted code blocks with zero raw JSON leakage.

import assert from 'node:assert';
import WebSocket from 'ws';

const WS_URL = 'ws://localhost:3000';

function testSlidingWindowCpp() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const messages = [];

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Timeout waiting for sliding window C++ test'));
    }, 25000);

    let currentGen = 0;
    let turn = 0;

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      messages.push(msg);

      if (msg.type === 'handshake') {
        currentGen = msg.generation;
        console.log('-> Connected. Sending Turn 1: "Explain sliding window algorithm"...');
        turn = 1;
        ws.send(JSON.stringify({
          type: 'query',
          text: 'Explain sliding window algorithm',
          timestamp: Date.now(),
        }));
      }

      if (msg.type === 'ai_text' && turn === 1) {
        console.log('   Turn 1 response received (Mode: ' + msg.responseMode + ')');
        console.log('-> Sending Turn 2: "I want it in C++"...');
        turn = 2;
        ws.send(JSON.stringify({
          type: 'query',
          text: 'I want it in C++',
          timestamp: Date.now(),
        }));
      } else if (msg.type === 'ai_text' && turn === 2) {
        clearTimeout(timeout);
        ws.close();

        console.log('\n==================================================');
        console.log('RESULTS FOR "I want it in C++":');
        console.log('Response Mode:', msg.responseMode);
        console.log('Visual Type:', msg.visualType);
        console.log('Language:', msg.language);
        console.log('Title:', msg.title);
        console.log('Spoken:', msg.spoken);
        console.log('Visual Text Snippet:\n' + msg.text.slice(0, 200) + '...\n');
        console.log('==================================================\n');

        try {
          // Assertions against raw JSON leakage
          assert.strictEqual(msg.visualType, 'code', 'Visual type must be "code"');
          assert.ok(msg.language === 'cpp' || msg.language === 'c++', `Language should be cpp, got: ${msg.language}`);
          assert.ok(!msg.text.trim().startsWith('{'), 'CRITICAL: msg.text must NOT start with raw JSON brace');
          assert.ok(!msg.text.includes('"spoken"'), 'CRITICAL: msg.text must NOT contain "spoken" JSON key');
          assert.ok(!msg.text.includes('"visualResponse"'), 'CRITICAL: msg.text must NOT contain "visualResponse" JSON key');
          assert.ok(!msg.text.includes('"content"'), 'CRITICAL: msg.text must NOT contain "content" JSON key');
          assert.ok(msg.text.includes('#include') || msg.text.includes('vector') || msg.text.includes('int '), 'msg.text must contain actual C++ code');

          assert.ok(!msg.spoken.trim().startsWith('{'), 'CRITICAL: msg.spoken must NOT start with raw JSON brace');
          assert.ok(!msg.spoken.includes('#include'), 'CRITICAL: msg.spoken must NOT speak C++ #include syntax');
          assert.ok(!msg.spoken.includes('"spoken"'), 'CRITICAL: msg.spoken must NOT contain JSON keys');

          console.log('✅ TEST PASSED: "I want it in C++" returned clean, highlighted C++ code with ZERO raw JSON!');
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
}

testSlidingWindowCpp()
  .then(() => {
    console.log('\n🎉 ALL C++ VERIFICATION CHECKS PASSED!\n');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ C++ VERIFICATION FAILED:', err);
    process.exit(1);
  });
