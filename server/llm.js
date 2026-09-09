// server/llm.js
// Dual-Channel LLM Gateway for Aurora with Intelligent Response Routing.
// Dynamically classifies requests into VOICE, TEXT, or HYBRID modalities.
// 1. Spoken Channel: Natural conversational speech (strictly budgeted) for Rime TTS.
// 2. Visual Channel: Rich formatted output (code blocks, tables, markdown) for the workspace.

import {
  RESPONSE_MODES,
  validateAndEnforceContract,
  deterministicClassify,
  enforceSpokenBudget,
  safeParseOrExtract,
} from './response-router.js';

const ENDPOINTS = {
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  openai: 'https://api.openai.com/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
};

const DUAL_CHANNEL_SYSTEM_PROMPT = `You are Aurora, an intelligent voice-first AI workspace companion.
You dynamically classify every user request into exactly one of three response modalities:

1. "VOICE": For short, conversational, or conceptual queries (e.g. definitions, factual questions, yes/no, quick explanations, greetings).
   - "spokenResponse": Natural, direct conversational answer (under 35 words).
   - "visualResponse": Concise transcript bubble (type: "text").

2. "TEXT": When the answer heavily benefits from visual layout (e.g. code generation, comparison tables, JSON schemas, large numbered lists, documentation).
   - "spokenResponse": Brief verbal acknowledgement confirming content is in the workspace (under 20 words), e.g. "I've written the C++ program in the workspace." NEVER read code, variable names, syntax, table pipes, or markdown syntax aloud!
   - "visualResponse": Rich visual artifact (type: "code", "table", or "markdown").

3. "HYBRID": When the user benefits from BOTH voice explanation and visual artifacts (e.g. explanation + code, comparison + recommendation, multi-step walkthrough).
   - "spokenResponse": High-level conceptual summary or recommendation (10 to 25 words).
   - "visualResponse": Complete rich visual artifact (code, table, or structured markdown).

You MUST always return a valid JSON object with this exact schema:
{
  "responseMode": "VOICE" | "TEXT" | "HYBRID",
  "spokenResponse": "Concise spoken summary or confirmation for Rime TTS. Strictly adhere to spoken word budgets. NEVER speak code syntax.",
  "visualResponse": {
    "type": "text" | "code" | "table" | "markdown",
    "language": "cpp" | "python" | "javascript" | "typescript" | "sql" | "html" | "css" | "json" | "bash" (only if type is code),
    "title": "Short title describing the visual item (e.g. Binary Search in C++, Framework Comparison)",
    "content": "Full visual content for the workspace: raw code without markdown backticks if code; markdown table if table; formatted markdown if markdown; conversational text if text."
  }
}

Core Rules:
1. Routing Decision:
   - Code requested? -> TEXT (or HYBRID if deep explanation is also requested).
   - Table / comparison? -> TEXT (or HYBRID if recommendation is requested).
   - Large list / documentation? -> TEXT.
   - Quick questions / greetings / definitions? -> VOICE.
2. Spoken Channel Protection:
   - "spokenResponse" must NEVER contain raw programming code, brackets, hashtags, asterisks, or markdown table formatting.
   - Keep spokenResponse strictly within budget (VOICE <= 35 words, TEXT <= 20 words, HYBRID <= 25 words).
3. Visual Workspace:
   - "visualResponse.content" must contain the complete, production-grade code or full markdown artifact.
4. Output Format:
   - Return ONLY the raw JSON object. No outer markdown fences, no conversational preamble.`;

export async function getAssistantReply({ provider, apiKey, model, messages, signal, userOverride }) {
  const userQuery = messages && messages.length > 0 ? messages[messages.length - 1]?.content || '' : '';
  if (!apiKey) {
    return localFallbackReply(messages, userOverride);
  }

  const url = ENDPOINTS[provider] || ENDPOINTS.gemini;
  const defaultModel = provider === 'gemini' ? 'gemini-3.5-flash-lite' : 'llama-3.1-8b-instant';
  const effectiveModel = (model && model !== 'gemini-2.0-flash' && model !== 'gemini-3.6-flash' && model !== 'llama-3.1-8b-instant')
    ? model
    : defaultModel;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: effectiveModel,
      messages: [{ role: 'system', content: DUAL_CHANNEL_SYSTEM_PROMPT }, ...messages],
      temperature: 0.2,
      max_tokens: 1500,
      response_format: { type: 'json_object' },
    }),
    signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const safeBody = body
      .replace(/(Bearer\s+)[a-zA-Z0-9_\-\.]+([a-zA-Z0-9]{4})/gi, '$1***REDACTED***$2')
      .replace(/(key=)[a-zA-Z0-9_\-\.]+([a-zA-Z0-9]{4})/gi, '$1***REDACTED***$2');
    console.warn(`[LLM warning] Provider returned HTTP ${res.status}. Falling back to local offline reply. (${safeBody.slice(0, 80)})`);
    return localFallbackReply(messages, userOverride);
  }

  const data = await res.json();
  const rawText = data?.choices?.[0]?.message?.content?.trim() || '';

  return parseStructuredResponse(rawText, userQuery, messages, userOverride);
}

/**
 * Robust response parser: extracts { responseMode, spokenResponse, visualResponse }
 * and passes through deterministic server-side validation & safety enforcement.
 */
export function parseStructuredResponse(rawText, userQuery = '', history = [], userOverride = null) {
  if (!rawText) {
    return validateAndEnforceContract({
      responseMode: 'VOICE',
      spokenResponse: "Sorry, I lost my train of thought. Could you say that again?",
      visualResponse: {
        type: 'text',
        content: "Sorry, I lost my train of thought. Could you say that again?",
      },
    }, userQuery, history, userOverride);
  }

  // Attempt 1: Robust parser & extractor (handles standard JSON, repaired newlines/quotes, regex)
  const parsed = safeParseOrExtract(rawText);
  if (parsed && typeof parsed === 'object') {
    return validateAndEnforceContract(parsed, userQuery, history, userOverride);
  }

  // Attempt 2: Code block detected in raw markdown
  const codeBlockMatch = rawText.match(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/);
  if (codeBlockMatch) {
    const lang = codeBlockMatch[1].toLowerCase() || 'code';
    const code = codeBlockMatch[2].trim();
    return validateAndEnforceContract({
      responseMode: 'TEXT',
      spokenResponse: `Done. I've placed the ${lang.toUpperCase()} code in the workspace.`,
      visualResponse: {
        type: 'code',
        language: lang,
        title: `${lang.toUpperCase()} Implementation`,
        content: code,
      },
    }, userQuery, history, userOverride);
  }

  // Attempt 3: Markdown table detected
  if (rawText.includes('|') && rawText.includes('---')) {
    return validateAndEnforceContract({
      responseMode: 'TEXT',
      spokenResponse: "Here is the comparison table in the workspace.",
      visualResponse: {
        type: 'table',
        title: 'Comparison Table',
        content: rawText,
      },
    }, userQuery, history, userOverride);
  }

  // Attempt 4: General text — ensure we NEVER leak raw JSON strings into visual or spoken channels
  let cleanSpoken = rawText;
  let cleanVisual = rawText;

  if (cleanSpoken.trim().startsWith('{')) {
    cleanSpoken = "I've placed the response in the workspace.";
    // If it started with { but failed to parse, strip leading JSON keys and braces so raw JSON is not shown
    cleanVisual = cleanVisual
      .replace(/^\s*\{[\s\S]*?"content"\s*:\s*"/i, '')
      .replace(/"\s*\}\s*$/i, '')
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"');
  } else if (cleanSpoken.length > 140) {
    cleanSpoken = cleanSpoken.slice(0, 140) + '…';
  }

  return validateAndEnforceContract({
    responseMode: 'VOICE',
    spokenResponse: cleanSpoken,
    visualResponse: {
      type: cleanVisual.includes('#') || cleanVisual.includes('*') ? 'markdown' : 'text',
      content: cleanVisual,
    },
  }, userQuery, history, userOverride);
}

// --- Local, key-free fallback so the app works seamlessly out of the box ---
export function localFallbackReply(messages, userOverride = null) {
  const userQuery = messages && messages.length > 0 ? messages[messages.length - 1]?.content || '' : '';
  const last = userQuery.toLowerCase().trim();

  const finalize = (obj) => validateAndEnforceContract(obj, userQuery, messages, userOverride);

  const has = (...phrases) => phrases.some((p) => last.includes(p));
  const hasWord = (...words) => words.some((w) => new RegExp(`\\b${w}\\b`, 'i').test(last));

  if (!last) {
    return finalize({
      responseMode: 'VOICE',
      spokenResponse: "I'm here — what's on your mind?",
      visualResponse: {
        type: 'text',
        content: "I'm here — what's on your mind?",
      },
    });
  }

  // Code requests -> TEXT
  if (has('prime', 'prime number', 'is prime', 'is_prime') && (has('python') || hasWord('check') || hasWord('number'))) {
    return finalize({
      responseMode: 'TEXT',
      spokenResponse: "Sure — I've prepared the Python prime checker in the workspace.",
      visualResponse: {
        type: 'code',
        language: 'python',
        title: 'Prime Number Checker in Python',
        content: `def is_prime(n: int) -> bool:
    """Check whether a number is prime using trial division up to sqrt(n)."""
    if n < 2:
        return False
    if n in (2, 3):
        return True
    if n % 2 == 0 or n % 3 == 0:
        return False
    
    # Check divisors of form 6k ± 1
    i = 5
    while i * i <= n:
        if n % i == 0 or n % (i + 2) == 0:
            return False
        i += 6
    return True

# Example tests:
numbers = [1, 2, 17, 21, 97, 100]
for num in numbers:
    status = "Prime" if is_prime(num) else "Composite"
    print(f"{num}: {status}")`,
      },
    });
  }

  if (has('odd and even', 'odd or even', 'even or odd', 'even and odd', 'odd', 'even') && (has('python') || has('program') || has('code') || has('number'))) {
    return finalize({
      responseMode: 'TEXT',
      spokenResponse: "Done. I've placed the Python program for odd and even numbers in the workspace.",
      visualResponse: {
        type: 'code',
        language: 'python',
        title: 'Check Odd or Even Number in Python',
        content: `def check_odd_even(number: int) -> str:
    """Determine whether an integer is even or odd using the modulo operator."""
    if number % 2 == 0:
        return "Even"
    else:
        return "Odd"

# Test with a series of sample numbers
test_numbers = [0, 1, 4, 7, 42, 99, -3, -8]
for num in test_numbers:
    result = check_odd_even(num)
    print(f"Number {num:3d} is: {result}")`,
      },
    });
  }

  if (has('recursion') || has('what is recursion')) {
    const isHybrid = has('code', 'program', 'example', 'implement');
    return finalize({
      responseMode: isHybrid ? 'HYBRID' : 'VOICE',
      spokenResponse: isHybrid
        ? "Recursion breaks problems down by calling the function itself until reaching a base case. Here is an implementation."
        : "Recursion is a technique where a function calls itself to break down complex problems into smaller subproblems.",
      visualResponse: {
        type: isHybrid ? 'code' : 'text',
        language: isHybrid ? 'python' : undefined,
        title: isHybrid ? 'Recursive Factorial in Python' : undefined,
        content: isHybrid
          ? `def factorial(n: int) -> int:
    """Calculate factorial recursively with a base case."""
    if n <= 1:
        return 1
    return n * factorial(n - 1)

# Example:
print("Factorial of 5 is:", factorial(5))  # 120`
          : "Recursion is a method in computer science where the solution to a problem depends on solutions to smaller instances of the same problem. A recursive function solves a base case directly, and otherwise calls itself with modified input, progressing toward the base case.",
      },
    });
  }

  // Follow-up: "Now write the Python code for it."
  if ((has('code for it', 'now write', 'write the python code') && has('python')) || (has('for it') && has('code'))) {
    return finalize({
      responseMode: 'TEXT',
      spokenResponse: "Done. I've placed the recursive Python code in the workspace.",
      visualResponse: {
        type: 'code',
        language: 'python',
        title: 'Recursive Factorial in Python',
        content: `def factorial(n: int) -> int:
    """Calculate factorial recursively with a base case."""
    if n <= 1:
        return 1
    return n * factorial(n - 1)

# Example usage:
print("Factorial of 5:", factorial(5))  # Output: 120`,
      },
    });
  }

  // Base case conceptual query
  if (has('base case', 'why is a base case')) {
    return finalize({
      responseMode: 'VOICE',
      spokenResponse: "A base case is required to terminate recursive calls and prevent an infinite loop or call stack overflow.",
      visualResponse: {
        type: 'text',
        content: "A base case is the terminating condition in a recursive algorithm that stops further recursive calls and prevents infinite recursion and stack overflow errors.",
      },
    });
  }

  // Quicksort explanation + implementation -> HYBRID
  if (has('quicksort', 'quick sort')) {
    const isHybrid = has('explain', 'concept', 'why', 'how') || has('implementation', 'python');
    return finalize({
      responseMode: isHybrid ? 'HYBRID' : 'TEXT',
      spokenResponse: isHybrid
        ? "Quicksort uses divide-and-conquer to partition arrays around a pivot. I've placed the Python code in the workspace."
        : "Done. I've written the quicksort algorithm in the workspace.",
      visualResponse: {
        type: 'code',
        language: 'python',
        title: 'Quicksort Algorithm in Python',
        content: `def quicksort(arr: list[int]) -> list[int]:
    """Sort an array using recursive divide-and-conquer partitioning."""
    if len(arr) <= 1:
        return arr
    pivot = arr[len(arr) // 2]
    left = [x for x in arr if x < pivot]
    middle = [x for x in arr if x == pivot]
    right = [x for x in arr if x > pivot]
    return quicksort(left) + middle + quicksort(right)

# Example:
numbers = [38, 27, 43, 3, 9, 82, 10]
print("Sorted:", quicksort(numbers))`,
      },
    });
  }

  // Sliding window algorithm & C++ follow-ups
  if (has('sliding window') || (has('c++', 'cpp', 'in c++', 'in cpp') && (has('sliding') || has('window') || has('want it in c++') || has('want it in cpp')))) {
    return finalize({
      responseMode: 'TEXT',
      spokenResponse: "Done. I've written the sliding window algorithm in C++ in the workspace.",
      visualResponse: {
        type: 'code',
        language: 'cpp',
        title: 'Sliding Window in C++',
        content: `#include <iostream>
#include <vector>
#include <algorithm>

// Maximum sum subarray of size k using sliding window technique: O(N) time, O(1) space
int maxSubarraySum(const std::vector<int>& arr, int k) {
    int n = arr.size();
    if (n < k) return -1;

    int windowSum = 0;
    for (int i = 0; i < k; ++i) {
        windowSum += arr[i];
    }

    int maxSum = windowSum;
    for (int i = k; i < n; ++i) {
        windowSum += arr[i] - arr[i - k];
        maxSum = std::max(maxSum, windowSum);
    }
    return maxSum;
}

int main() {
    std::vector<int> nums = {2, 1, 5, 1, 3, 2};
    int k = 3;
    std::cout << "Max sum of subarray of size " << k << ": " 
              << maxSubarraySum(nums, k) << std::endl;
    return 0;
}`,
      },
    });
  }

  // Follow-up context check: "I want it in C++" or "in C++"
  if (has('c++', 'cpp', 'in c++', 'in cpp', 'want it in c++', 'want it in cpp')) {
    const prevHistory = (messages || []).map((m) => m.content || '').join(' ').toLowerCase();
    if (prevHistory.includes('sliding window') || prevHistory.includes('window') || prevHistory.includes('algorithm')) {
      return finalize({
        responseMode: 'TEXT',
        spokenResponse: "Done. I've written the sliding window algorithm in C++ in the workspace.",
        visualResponse: {
          type: 'code',
          language: 'cpp',
          title: 'Sliding Window in C++',
          content: `#include <iostream>
#include <vector>
#include <algorithm>

int maxSubarraySum(const std::vector<int>& arr, int k) {
    int n = arr.size();
    if (n < k) return -1;

    int windowSum = 0;
    for (int i = 0; i < k; ++i) windowSum += arr[i];

    int maxSum = windowSum;
    for (int i = k; i < n; ++i) {
        windowSum += arr[i] - arr[i - k];
        maxSum = std::max(maxSum, windowSum);
    }
    return maxSum;
}

int main() {
    std::vector<int> nums = {2, 1, 5, 1, 3, 2};
    int k = 3;
    std::cout << "Max sum subarray: " << maxSubarraySum(nums, k) << std::endl;
    return 0;
}`,
        },
      });
    }
  }

  if (has('reverse a string', 'reverse string') && has('c++', 'cpp')) {
    return finalize({
      responseMode: 'TEXT',
      spokenResponse: "Done. I've written the C++ program in the workspace.",
      visualResponse: {
        type: 'code',
        language: 'cpp',
        title: 'Reverse a String in C++',
        content: `#include <iostream>
#include <string>
#include <algorithm>

int main() {
    std::string str = "Aurora Voice Companion";
    std::cout << "Original: " << str << std::endl;

    // In-place two-pointer reversal: O(N) time, O(1) space
    std::reverse(str.begin(), str.end());

    std::cout << "Reversed: " << str << std::endl;
    return 0;
}`,
      },
    });
  }

  if (has('binary search')) {
    return finalize({
      responseMode: 'TEXT',
      spokenResponse: "Here is the binary search implementation in the workspace.",
      visualResponse: {
        type: 'code',
        language: 'python',
        title: 'Binary Search in Python',
        content: `def binary_search(arr: list[int], target: int) -> int:
    """Returns the index of target in sorted arr, or -1 if not found.
    Time Complexity: O(log N) | Space Complexity: O(1)
    """
    left, right = 0, len(arr) - 1
    while left <= right:
        mid = (left + right) // 2
        if arr[mid] == target:
            return mid
        elif arr[mid] < target:
            left = mid + 1
        else:
            right = mid - 1
    return -1

# Example usage:
nums = [2, 5, 8, 12, 16, 23, 38, 56, 72, 91]
print("Index of 23:", binary_search(nums, 23))  # 5`,
      },
    });
  }

  // Table requests -> TEXT
  if (has('compare', 'comparison') && (has('c++', 'python', 'java', 'rust', 'table'))) {
    const isHybrid = has('recommend', 'better', 'choose');
    return finalize({
      responseMode: isHybrid ? 'HYBRID' : 'TEXT',
      spokenResponse: isHybrid
        ? "C++ offers maximum speed, while Python provides fast development velocity. Here is the full comparison table."
        : "Here is the language comparison table in the workspace.",
      visualResponse: {
        type: 'table',
        title: 'Programming Language Comparison',
        content: `| Feature | C++ | Python | Java |
| :--- | :--- | :--- | :--- |
| **Execution Model** | Compiled to native machine code | Interpreted bytecode (CPython) | JIT compiled on JVM |
| **Performance** | Ultra-high, near-metal speed | Moderate, great for prototyping | High, JVM-optimized |
| **Memory Management**| RAII, manual or smart pointers | Automatic garbage collection | Automatic garbage collection |
| **Type System** | Static, strongly typed | Dynamic, duck typed | Static, strongly typed |
| **Primary Use Cases**| Systems, games, low-latency audio | AI/ML, scripting, data science | Enterprise services, Android |`,
      },
    });
  }

  // Standard conversational intents -> VOICE
  if (has('solar system', 'planet', 'planets', 'sun', 'mars', 'earth', 'moon', 'jupiter', 'saturn')) {
    return finalize({
      responseMode: 'VOICE',
      spokenResponse: "Our solar system has eight planets orbiting the Sun, ranging from rocky inner worlds like Mars to gas giants like Jupiter.",
      visualResponse: {
        type: 'text',
        content: "Our solar system has eight planets orbiting the Sun, ranging from rocky inner worlds like Earth and Mars to massive gas giants like Jupiter and Saturn.",
      },
    });
  }

  if (has('artificial intelligence', 'what is ai')) {
    return finalize({
      responseMode: 'VOICE',
      spokenResponse: "Artificial intelligence is the science of creating computer systems capable of reasoning, learning, and adapting to solve complex tasks.",
      visualResponse: {
        type: 'text',
        content: "Artificial intelligence is the science of creating computer systems capable of reasoning, learning, and adapting to solve complex tasks.",
      },
    });
  }

  if (has('machine learning')) {
    return finalize({
      responseMode: 'VOICE',
      spokenResponse: "Machine learning is a subset of AI that allows algorithms to learn patterns directly from data without explicit programming.",
      visualResponse: {
        type: 'text',
        content: "Machine learning is a subset of AI that allows algorithms to learn patterns directly from data without being explicitly programmed.",
      },
    });
  }

  if (has('space', 'universe', 'galaxy', 'star', 'stars')) {
    return finalize({
      responseMode: 'VOICE',
      spokenResponse: "Space is completely silent, and there are more stars in the observable universe than grains of sand on Earth.",
      visualResponse: {
        type: 'text',
        content: "Space is completely silent because there is no air to carry sound, and there are more stars in the observable universe than grains of sand on Earth.",
      },
    });
  }

  if (has('rime', 'tts')) {
    return finalize({
      responseMode: 'VOICE',
      spokenResponse: "Rime TTS is an ultra-low-latency speech platform designed for lifelike conversational turn-taking.",
      visualResponse: {
        type: 'text',
        content: "Rime TTS is an ultra-low-latency, expressive speech synthesis platform designed for lifelike conversational turn-taking.",
      },
    });
  }

  if (has('barge in', 'interrupt', 'fencing')) {
    return finalize({
      responseMode: 'VOICE',
      spokenResponse: "Barge-in lets you talk over me anytime. I silence my audio in under two milliseconds and switch immediately to your new thought.",
      visualResponse: {
        type: 'text',
        content: "Barge-in lets you talk over me anytime. I silence my audio in under two milliseconds and switch immediately to what you just said.",
      },
    });
  }

  if (hasWord('hello', 'hi', 'hey')) {
    return finalize({
      responseMode: 'VOICE',
      spokenResponse: "Hey there! I'm Aurora. What can I help you with?",
      visualResponse: {
        type: 'text',
        content: "Hey there! I'm Aurora. What can I help you with today?",
      },
    });
  }

  if (has('your name', 'who are you')) {
    return finalize({
      responseMode: 'VOICE',
      spokenResponse: "I'm Aurora, your voice assistant. Ask me anything.",
      visualResponse: {
        type: 'text',
        content: "I'm Aurora, your intelligent full-duplex voice companion.",
      },
    });
  }

  if (hasWord('joke')) {
    return finalize({
      responseMode: 'VOICE',
      spokenResponse: "Why did the AI cross the road? To avoid the latency on the other side.",
      visualResponse: {
        type: 'text',
        content: "Why did the AI cross the road? To avoid the latency on the other side.",
      },
    });
  }

  const snippet = last.length > 50 ? last.slice(0, 50) + '…' : last;
  return finalize({
    responseMode: 'VOICE',
    spokenResponse: `I'm ready to help with "${snippet}". Add an API key in settings for full online intelligence.`,
    visualResponse: {
      type: 'text',
      content: `That's an intriguing question about "${snippet}"! To get unbounded dynamic answers on any topic, add a free Groq or Gemini API key in settings.`,
    },
  });
}
