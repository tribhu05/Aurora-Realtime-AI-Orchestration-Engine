// tests/workspace-scenarios.test.js
// Validates the 4 workspace suggestion queries and response formats

import WebSocket from 'ws';

const WS_URL = 'ws://localhost:3000';

function runScenario(name, query, validator) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`Timeout waiting for scenario: ${name}`));
    }, 25000);

    const messages = [];

    ws.on('open', () => {
      // Send query after handshake
    });

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      messages.push(msg);
      console.log('  [received msg]:', msg.type, msg.visualType || '', msg.error || msg.message || '');

      if (msg.type === 'handshake') {
        ws.send(JSON.stringify({ type: 'query', text: query, timestamp: Date.now() }));
      }

      const result = validator(msg, messages);
      if (result === true) {
        clearTimeout(timeout);
        ws.close();
        resolve();
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function main() {
  console.log('🧪 RUNNING WORKSPACE SCENARIOS TEST SUITE');

  // Scenario 1: Python Prime Checker
  console.log('\n--- SCENARIO 1: Python Prime Checker ---');
  await runScenario(
    'Python Prime Checker',
    'Write a Python program to check whether a number is prime.',
    (msg) => {
      if (msg.type === 'ai_text') {
        console.log('  -> Visual Type:', msg.visualType);
        console.log('  -> Language:', msg.language);
        console.log('  -> Spoken:', msg.spoken);
        if (msg.visualType === 'code' && msg.language === 'python' && msg.text.includes('is_prime')) {
          console.log('✅ SCENARIO 1 PASSED: Python code generated with concise spoken audio!');
          return true;
        }
      }
      return false;
    }
  );

  // Scenario 2: Binary Search Concept
  console.log('\n--- SCENARIO 2: Binary Search Concept ---');
  await runScenario(
    'Binary Search Concept',
    'Explain binary search.',
    (msg) => {
      if (msg.type === 'ai_text') {
        console.log('  -> Spoken:', msg.spoken);
        console.log('  -> Text snippet:', msg.text.slice(0, 100).replace(/\n/g, ' '));
        if (msg.text.toLowerCase().includes('binary search') || msg.text.toLowerCase().includes('divide-and-conquer')) {
          console.log('✅ SCENARIO 2 PASSED: Concept explanation generated!');
          return true;
        }
      }
      return false;
    }
  );

  // Scenario 3: Comparison Table
  console.log('\n--- SCENARIO 3: Comparison Table ---');
  await runScenario(
    'Comparison Table',
    'Compare Python and C++ in a table.',
    (msg) => {
      if (msg.type === 'ai_text') {
        console.log('  -> Visual Type:', msg.visualType);
        console.log('  -> Spoken:', msg.spoken);
        if (msg.visualType === 'table' && msg.text.includes('| Feature | Python | C++ |')) {
          console.log('✅ SCENARIO 3 PASSED: Comparison table generated cleanly!');
          return true;
        }
      }
      return false;
    }
  );

  // Scenario 4: Express REST API for Todo App
  console.log('\n--- SCENARIO 4: Scaffold Express REST API for Todo App ---');
  await runScenario(
    'Scaffold Express REST API for Todo App',
    'Create an Express REST API for a todo app.',
    (msg) => {
      if (msg.type === 'task_complete') {
        console.log('  -> Task Completed:', msg.title);
        console.log('  -> Files Created:', msg.files.map(f => f.path).join(', '));
        console.log('  -> Primary Code Language:', msg.primaryCode?.language);
        if (msg.primaryCode?.code.includes('/api/todos')) {
          console.log('✅ SCENARIO 4 PASSED: Todo App REST API scaffolding task completed with /api/todos endpoints!');
          return true;
        }
      }
      return false;
    }
  );

  // Scenario 5: Python Odd and Even Program
  console.log('\n--- SCENARIO 5: Python Odd and Even Program ---');
  await runScenario(
    'Python Odd and Even Program',
    'Write a Python program for odd and even numbers.',
    (msg) => {
      if (msg.type === 'ai_text') {
        console.log('  -> Visual Type:', msg.visualType);
        console.log('  -> Language:', msg.language);
        console.log('  -> Spoken:', msg.spoken);
        if (msg.visualType === 'code' && msg.language === 'python') {
          console.log('✅ SCENARIO 5 PASSED: Python odd/even program generated cleanly!');
          return true;
        }
      }
      return false;
    }
  );

  console.log('\n🎉 ALL 5 WORKSPACE SCENARIOS PASSED 100%!\n');
}

main().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

