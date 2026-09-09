// tests/test-extractor.js
// Tests extracting fields from malformed, unescaped, or raw JSON strings.

function safeParseOrExtract(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;

  let clean = rawText.trim();
  // Strip outer markdown code blocks if present
  if (clean.startsWith('```json')) clean = clean.slice(7);
  else if (clean.startsWith('```')) clean = clean.slice(3);
  if (clean.endsWith('```')) clean = clean.slice(0, -3);
  clean = clean.trim();

  // Attempt 1: Standard JSON.parse
  try {
    const parsed = JSON.parse(clean);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch (_) {}

  // Attempt 2: Repair unescaped newlines inside string literals
  try {
    // Replace literal newlines and control characters inside JSON strings
    const repaired = clean.replace(/:\s*"([\s\S]*?)"(?=\s*[,}])/g, (match, p1) => {
      const escaped = p1
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
      return `: "${escaped}"`;
    });
    const parsed = JSON.parse(repaired);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch (_) {}

  // Attempt 3: Robust Regex Field Extraction
  const result = {};

  // Extract responseMode
  const modeMatch = clean.match(/"responseMode"\s*:\s*"([A-Za-z]+)"/i);
  if (modeMatch) result.responseMode = modeMatch[1].toUpperCase();

  // Extract type
  const typeMatch = clean.match(/"type"\s*:\s*"([A-Za-z]+)"/i);
  if (typeMatch) result.type = typeMatch[1].toLowerCase();

  // Extract language
  const langMatch = clean.match(/"language"\s*:\s*"([A-Za-z0-9_+-]+)"/i);
  if (langMatch) result.language = langMatch[1].toLowerCase();

  // Extract title
  const titleMatch = clean.match(/"title"\s*:\s*"([^"\r\n]+)"/i);
  if (titleMatch) result.title = titleMatch[1];

  // Extract spoken / spokenResponse
  const spokenMatch = clean.match(/"(?:spokenResponse|spoken)"\s*:\s*"((?:[^"\\]|\\.)*)"/i);
  if (spokenMatch) {
    result.spoken = spokenMatch[1].replace(/\\"/g, '"').replace(/\\n/g, ' ');
    result.spokenResponse = result.spoken;
  }

  // Extract content
  // Look for "content"\s*:\s*"
  const contentStartMatch = clean.match(/"content"\s*:\s*"/);
  if (contentStartMatch) {
    const startIndex = contentStartMatch.index + contentStartMatch[0].length;
    // Find the end quote for content: usually the last quote before the trailing brace
    const lastBrace = clean.lastIndexOf('}');
    const endSearchIndex = lastBrace !== -1 ? lastBrace : clean.length;
    const lastQuote = clean.lastIndexOf('"', endSearchIndex - 1);
    if (lastQuote > startIndex) {
      let content = clean.slice(startIndex, lastQuote);
      // Unescape json escapes if they were escaped
      content = content
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
      result.content = content;
    }
  }

  if (result.content || result.spoken || result.type) {
    return result;
  }

  return null;
}

// Test cases:
const test1 = `{
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

console.log('Test 1 with unescaped code newlines and quotes:');
const r1 = safeParseOrExtract(test1);
console.log(r1);

const test2 = `{
  "responseMode": "TEXT",
  "spokenResponse": "Here is the code in the workspace.",
  "visualResponse": {
    "type": "code",
    "language": "python",
    "title": "Quick Sort",
    "content": "def quicksort(arr):\\n    return arr"
  }
}`;

console.log('\nTest 2 with nested visualResponse:');
const r2 = safeParseOrExtract(test2);
console.log(r2);
