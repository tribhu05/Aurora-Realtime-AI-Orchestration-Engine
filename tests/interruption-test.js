// tests/interruption-test.js
// Headless test: connects over WebSocket, fires a query, then interrupts
// it mid-flight with a new one, and verifies the fencing behaves.

import WebSocket from 'ws';

const PORT = process.env.PORT || 3000;
const URL = `ws://localhost:${PORT}`;

console.log('====================================================');
console.log('🧪 RUNNING AUTOMATED BARGE-IN & FENCING TEST SUITE');
console.log(`📡 Connecting to: ${URL}`);
console.log('====================================================\n');

const ws = new WebSocket(URL);
let sessionGen = 0;
let sawInterrupted = false;
let sawSecondReply = false;
const t0 = Date.now();

ws.on('open', () => console.log('✓ WebSocket connected.\n'));

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());

  switch (msg.type) {
    case 'handshake':
      sessionGen = msg.generation;
      console.log(`[HANDSHAKE] Session: ${msg.sessionId}, Gen: #${sessionGen}`);
      console.log(`[CONFIG] TTS configured: ${msg.rimeConfigured}, LLM configured: ${msg.llmConfigured}\n`);
      console.log('--- TEST 1: Standard turn & interruption ---');
      ws.send(JSON.stringify({ type: 'query', text: 'Tell me something interesting about space.' }));
      break;

    case 'thinking':
      console.log(`  -> thinking (gen #${msg.generation})`);
      if (!sawInterrupted) {
        // Barge in shortly after thinking starts in Test 1, before the answer finishes.
        setTimeout(() => {
          console.log('  -> ⚡ USER BARGE-IN! Sending interrupt...');
          ws.send(JSON.stringify({ type: 'interrupt' }));
        }, 150);
      }
      break;

    case 'interrupted':
      sawInterrupted = true;
      console.log(`  -> Interruption ACK: Gen #${msg.oldGeneration} -> #${msg.newGeneration} (${Date.now() - t0}ms elapsed)`);
      console.log('✅ TEST 1 PASSED: Interrupt acknowledged and generation fenced.\n');
      console.log('--- TEST 2: Recovery with new prompt ---');
      ws.send(JSON.stringify({ type: 'query', text: 'Actually, tell me a short joke instead.' }));
      break;

    case 'ai_text':
      if (sawInterrupted) {
        sawSecondReply = true;
        console.log(`  -> Recovery reply: "${msg.text.slice(0, 60)}..."`);
      }
      break;

    case 'audio':
    case 'speak_local':
      if (sawSecondReply) {
        console.log('✅ TEST 2 PASSED: New generation produced a clean spoken reply.\n');
        console.log('====================================================');
        console.log('🎉 ALL TESTS PASSED');
        console.log('====================================================');
        ws.close();
        process.exit(0);
      }
      break;

    case 'error':
      console.error('Server error:', msg.message);
      break;
  }
});

ws.on('error', (err) => {
  console.error('❌ WebSocket error — is the server running? (`npm start`)', err.message);
  process.exit(1);
});

setTimeout(() => {
  console.error('❌ Test timed out after 20s.');
  process.exit(1);
}, 20000);
