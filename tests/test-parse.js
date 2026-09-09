import assert from 'node:assert';
import { parseStructuredResponse } from '../server/llm.js';

console.log('🧪 RUNNING EXTENDED PARSE & NORMALIZATION UNIT TESTS');

// Case 1: Legacy schema from prompt
const testLegacy = `{
  "spoken": "Done. I've written the sliding window algorithm in C++ in the chat.",
  "type": "code",
  "language": "cpp",
  "title": "Sliding Window in C++",
  "content": "#include <iostream>\\n#include <vector>\\nusing namespace std;\\n\\nint main() {\\n    return 0;\\n}"
}`;

const r1 = parseStructuredResponse(testLegacy, 'I want it in C++');
assert.strictEqual(r1.responseMode, 'TEXT');
assert.strictEqual(r1.type, 'code');
assert.strictEqual(r1.language, 'cpp');
assert.strictEqual(r1.title, 'Sliding Window in C++');
assert.ok(!r1.text.startsWith('{'), 'Text does not start with JSON brace');
assert.ok(!r1.text.includes('"spoken"'), 'Text does not contain JSON spoken key');
assert.ok(r1.text.includes('#include <iostream>'), 'Text contains pure C++ code');
console.log('✅ Case 1 Passed: Legacy flat JSON normalized to clean code contract');

// Case 2: Unescaped newlines and unescaped double quotes in C++ code
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

const r2 = parseStructuredResponse(testUnescaped, 'I want it in C++');
assert.strictEqual(r2.responseMode, 'TEXT');
assert.strictEqual(r2.type, 'code');
assert.strictEqual(r2.language, 'cpp');
assert.ok(!r2.text.startsWith('{'));
assert.ok(!r2.text.includes('"content"'));
assert.ok(r2.text.includes('cout << "Hello world"'));
console.log('✅ Case 2 Passed: Unescaped newlines and quotes handled without crashing');

// Case 3: Markdown-wrapped JSON block
const testMarkdownWrapped = `\`\`\`json
{
  "responseMode": "TEXT",
  "spokenResponse": "Done. Here is the sliding window algorithm.",
  "visualResponse": {
    "type": "code",
    "language": "cpp",
    "title": "Sliding Window in C++",
    "content": "#include <iostream>\\nint main() {}"
  }
}
\`\`\``;

const r3 = parseStructuredResponse(testMarkdownWrapped, 'I want it in C++');
assert.strictEqual(r3.responseMode, 'TEXT');
assert.strictEqual(r3.type, 'code');
assert.strictEqual(r3.language, 'cpp');
assert.ok(!r3.text.includes('```json'));
assert.ok(r3.text.includes('#include <iostream>'));
console.log('✅ Case 3 Passed: Markdown-wrapped JSON unwrapped cleanly');

// Case 4: Nested serialized JSON in content
const testNested = `{
  "responseMode": "TEXT",
  "spokenResponse": "Done. Here is the code.",
  "visualResponse": {
    "type": "code",
    "content": "{\\"spoken\\": \\"Done\\", \\"type\\": \\"code\\", \\"language\\": \\"cpp\\", \\"title\\": \\"C++ Window\\", \\"content\\": \\"#include <iostream>\\\\nint main() {}\\"}"
  }
}`;

const r4 = parseStructuredResponse(testNested, 'I want it in C++');
assert.strictEqual(r4.type, 'code');
assert.strictEqual(r4.language, 'cpp');
assert.ok(!r4.text.startsWith('{'));
assert.ok(r4.text.includes('#include <iostream>'));
console.log('✅ Case 4 Passed: Nested serialized JSON inside content unwrapped cleanly');

// Case 5: Table response
const testTable = `{
  "spoken": "Here is the comparison table in the workspace.",
  "type": "table",
  "title": "Comparison",
  "content": "| Language | Speed |\\n|---|---|\\n| C++ | Fast |\\n| Python | Prototype |"
}`;

const r5 = parseStructuredResponse(testTable, 'Compare C++ and Python');
assert.strictEqual(r5.type, 'table');
assert.ok(r5.text.includes('| Language | Speed |'));
assert.ok(!r5.text.includes('"spoken"'));
assert.ok(!r5.spoken.includes('|'));
console.log('✅ Case 5 Passed: Table extracted with clean spoken acknowledgment');

console.log('\n🎉 ALL EXTENDED PARSE & NORMALIZATION UNIT TESTS PASSED 100%!\n');
