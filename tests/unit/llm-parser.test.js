// tests/unit/llm-parser.test.js
// Unit tests for LLM response parsing, markdown extraction, and raw JSON suppression.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStructuredResponse, localFallbackReply } from '../../server/llm.js';

test('LLM Parser - parse structured JSON response', () => {
  const rawLlm = JSON.stringify({
    responseMode: 'TEXT',
    spokenResponse: "I've written the C++ code in the workspace.",
    visualResponse: {
      type: 'code',
      language: 'cpp',
      title: 'Reverse String in C++',
      content: '#include <iostream>\n#include <string>\n#include <algorithm>\nint main() {}',
    },
  });

  const parsed = parseStructuredResponse(rawLlm, 'Write C++ code to reverse a string');
  assert.equal(parsed.responseMode, 'TEXT');
  assert.equal(parsed.visualType, 'code');
  assert.equal(parsed.language, 'cpp');
  assert.ok(!parsed.text.startsWith('{'), 'Never starts with raw JSON brace');
  assert.ok(!parsed.spoken.includes('#include'), 'Never speaks raw C++ code');
});

test('LLM Parser - extract code from raw markdown fence without outer JSON', () => {
  const rawMarkdown = '```python\ndef is_prime(n):\n    return True\n```';
  const parsed = parseStructuredResponse(rawMarkdown, 'Write Python prime function');
  assert.equal(parsed.responseMode, 'TEXT');
  assert.equal(parsed.visualType, 'code');
  assert.equal(parsed.language, 'python');
  assert.equal(parsed.text, 'def is_prime(n):\n    return True');
  assert.ok(!parsed.spoken.includes('def is_prime'), 'Spoken audio does not contain code');
});

test('LLM Parser - extract comparison table from raw markdown', () => {
  const rawTable = `| Feature | React | Vue |
| :--- | :--- | :--- |
| Paradigm | Component-based | Progressive |`;
  const parsed = parseStructuredResponse(rawTable, 'Compare React and Vue in a table');
  assert.equal(parsed.responseMode, 'TEXT');
  assert.equal(parsed.visualType, 'table');
  assert.ok(parsed.text.includes('| Feature | React | Vue |'));
  assert.ok(!parsed.spoken.includes('|'), 'No table pipes in speech');
});

test('LLM Parser - sanitize malformed raw JSON strings from leaking into output', () => {
  // Simulating an LLM returning half-broken JSON
  const brokenJson = `{"spoken": "Done. Here is the C++ code.", "content": "#include <iostream>\\nint main() {}"}`;
  const parsed = parseStructuredResponse(brokenJson, 'I want it in C++');
  assert.ok(
    !parsed.text.trim().startsWith('{"spoken"'),
    'Raw JSON string eliminated from visual text'
  );
  assert.ok(!parsed.spoken.trim().startsWith('{'), 'Raw JSON string eliminated from spoken audio');
});

test('LLM Parser - handles null or empty input gracefully', () => {
  const parsed = parseStructuredResponse('', 'Hello');
  assert.equal(parsed.responseMode, 'VOICE');
  assert.ok(parsed.spoken.length > 0);
  assert.ok(parsed.text.length > 0);
});

test('LLM Parser - localFallbackReply produces deterministic test fixtures offline', () => {
  // Python prime query
  const primeReply = localFallbackReply([
    { role: 'user', content: 'Write a Python program to check whether a number is prime.' },
  ]);
  assert.equal(primeReply.responseMode, 'TEXT');
  assert.equal(primeReply.visualType, 'code');
  assert.equal(primeReply.language, 'python');
  assert.ok(primeReply.text.includes('is_prime'));

  // Language comparison table
  const tableReply = localFallbackReply([
    { role: 'user', content: 'Compare Python and C++ in a table.' },
  ]);
  assert.equal(tableReply.responseMode, 'TEXT');
  assert.equal(tableReply.visualType, 'table');
  assert.ok(tableReply.text.includes('|'));

  // C++ sliding window
  const cppReply = localFallbackReply([
    { role: 'user', content: 'Explain sliding window' },
    { role: 'assistant', content: 'Explanation' },
    { role: 'user', content: 'I want it in C++' },
  ]);
  assert.equal(cppReply.responseMode, 'TEXT');
  assert.equal(cppReply.visualType, 'code');
  assert.equal(cppReply.language, 'cpp');
  assert.ok(cppReply.text.includes('#include'));
});

test('LLM Parser - legacy flat JSON normalized to clean contract', () => {
  const testLegacy = `{
    "spoken": "Done. I've written the sliding window algorithm in C++ in the chat.",
    "type": "code",
    "language": "cpp",
    "title": "Sliding Window in C++",
    "content": "#include <iostream>\\n#include <vector>\\nusing namespace std;\\n\\nint main() {\\n    return 0;\\n}"
  }`;

  const r = parseStructuredResponse(testLegacy, 'I want it in C++');
  assert.equal(r.responseMode, 'TEXT');
  assert.equal(r.visualType, 'code');
  assert.equal(r.language, 'cpp');
  assert.equal(r.title, 'Sliding Window in C++');
  assert.ok(!r.text.startsWith('{'));
  assert.ok(!r.text.includes('"spoken"'));
  assert.ok(r.text.includes('#include <iostream>'));
});

test('LLM Parser - unescaped newlines and quotes in code parsed without failure', () => {
  const testUnescaped = `{
    "spoken": "Done. I've written the sliding window algorithm in C++ in the chat.",
    "type": "code",
    "language": "cpp",
    "title": "Sliding Window in C++",
    "content": "#include <iostream>
#include <vector>
using namespace std;

int main() {
    cout << "Hello world" << endl;
    return 0;
}"
  }`;

  const r = parseStructuredResponse(testUnescaped, 'I want it in C++');
  assert.equal(r.responseMode, 'TEXT');
  assert.equal(r.visualType, 'code');
  assert.equal(r.language, 'cpp');
  assert.ok(!r.text.startsWith('{'));
  assert.ok(!r.text.includes('"content"'));
  assert.ok(r.text.includes('cout << "Hello world"'));
});

test('LLM Parser - nested serialized JSON inside content unwrapped cleanly', () => {
  const testNested = `{
    "responseMode": "TEXT",
    "spokenResponse": "Done. Here is the code.",
    "visualResponse": {
      "type": "code",
      "content": "{\\"spoken\\": \\"Done\\", \\"type\\": \\"code\\", \\"language\\": \\"cpp\\", \\"title\\": \\"C++ Window\\", \\"content\\": \\"#include <iostream>\\\\nint main() {}\\"}"
    }
  }`;

  const r = parseStructuredResponse(testNested, 'I want it in C++');
  assert.equal(r.visualType, 'code');
  assert.equal(r.language, 'cpp');
  assert.ok(!r.text.startsWith('{'));
  assert.ok(r.text.includes('#include <iostream>'));
});
