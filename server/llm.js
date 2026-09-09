// server/llm.js
// Dual-Channel LLM Gateway for Aurora.
// Generates:
// 1. Spoken Channel: Brief, natural conversational speech (under 20 words) for Rime TTS.
// 2. Visual Channel: Rich formatted output (syntax-highlighted code, responsive tables, markdown) for the visual chat.

const ENDPOINTS = {
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  openai: 'https://api.openai.com/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
};

const DUAL_CHANNEL_SYSTEM_PROMPT = `You are Aurora, an ultra-responsive conversational voice companion with a dual-channel visual interface.

You MUST always return a JSON object with this exact schema:
{
  "spoken": "Short natural spoken reply for TTS (under 20 words). NEVER read code, tables, or markdown syntax aloud. For code, say e.g.: 'Done. I\\'ve written the C++ program in the chat.' For tables, say e.g.: 'Here is the comparison table in the chat.' For explanations, give a concise 1-2 sentence spoken summary.",
  "type": "text" | "code" | "table" | "markdown",
  "language": "cpp" | "python" | "javascript" | "typescript" | "sql" | "html" | "css" | "json" | "bash" (only if type is code),
  "title": "Short title describing the item (e.g. Reverse String in C++, Comparison Table)",
  "content": "Full rich visual content for the chat area: raw code without markdown backticks if type is code; markdown table syntax if table; formatted markdown if markdown; conversational text if text."
}

Core Rules:
1. Spoken channel ("spoken"):
   - Ultra-brief, conversational speech (1 to 2 short sentences, under 20 words).
   - NEVER include code syntax, variable names in brackets, pipes, hashes, or asterisks.
   - Zero preambles or throat-clearing.
2. Visual channel ("content" & "type"):
   - If the user asks for code, set type="code", provide the language, and put the full clean code in "content".
   - If the user asks for comparison or structured data, set type="table" and put the markdown table in "content".
   - If the user asks for detailed explanation or steps, set type="markdown" and put structured markdown in "content".
   - If it's a simple greeting or general chat, set type="text".
3. Return ONLY the valid JSON object, without extra commentary or outer markdown code fences.`;

export async function getAssistantReply({ provider, apiKey, model, messages, signal }) {
  if (!apiKey) {
    return localFallbackReply(messages);
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
    throw new Error(`LLM error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const rawText = data?.choices?.[0]?.message?.content?.trim() || '';

  return parseStructuredResponse(rawText);
}

/**
 * Robust response parser: extracts { spoken, type, language, title, content }
 * with resilient fallbacks if the model emitted raw markdown or partial JSON.
 */
export function parseStructuredResponse(rawText) {
  if (!rawText) {
    return {
      spoken: "Sorry, I lost my train of thought. Could you say that again?",
      type: 'text',
      content: "Sorry, I lost my train of thought. Could you say that again?",
    };
  }

  // Attempt 1: Direct JSON parsing
  try {
    let clean = rawText.trim();
    // Remove outer markdown code block if present (e.g. ```json ... ```)
    if (clean.startsWith('```json')) clean = clean.slice(7);
    else if (clean.startsWith('```')) clean = clean.slice(3);
    if (clean.endsWith('```')) clean = clean.slice(0, -3);
    clean = clean.trim();

    const parsed = JSON.parse(clean);
    if (parsed && typeof parsed === 'object') {
      const type = ['text', 'code', 'table', 'markdown', 'task'].includes(parsed.type) ? parsed.type : 'text';
      return {
        spoken: String(parsed.spoken || parsed.content || '').slice(0, 250),
        type,
        language: parsed.language || 'code',
        title: parsed.title || '',
        content: String(parsed.content || parsed.spoken || ''),
      };
    }
  } catch (_) {
    // Fallthrough to heuristic extraction
  }

  // Attempt 2: Code block detected in raw markdown
  const codeBlockMatch = rawText.match(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/);
  if (codeBlockMatch) {
    const lang = codeBlockMatch[1].toLowerCase() || 'code';
    const code = codeBlockMatch[2].trim();
    const spoken = `Done. I've written the ${lang.toUpperCase()} code in the chat.`;
    return {
      spoken,
      type: 'code',
      language: lang,
      title: `${lang.toUpperCase()} Implementation`,
      content: code,
    };
  }

  // Attempt 3: Markdown table detected
  if (rawText.includes('|') && rawText.includes('---')) {
    return {
      spoken: "Here is the comparison table you requested.",
      type: 'table',
      title: 'Comparison Table',
      content: rawText,
    };
  }

  // Attempt 4: General text
  return {
    spoken: rawText.length > 140 ? rawText.slice(0, 140) + '…' : rawText,
    type: rawText.includes('#') || rawText.includes('*') ? 'markdown' : 'text',
    content: rawText,
  };
}

// --- Local, key-free fallback so the app works seamlessly out of the box ---
export function localFallbackReply(messages) {
  const last = (messages[messages.length - 1]?.content || '').toLowerCase().trim();

  const has = (...phrases) => phrases.some((p) => last.includes(p));
  const hasWord = (...words) => words.some((w) => new RegExp(`\\b${w}\\b`, 'i').test(last));

  if (!last) {
    return {
      spoken: "I'm here — what's on your mind?",
      type: 'text',
      content: "I'm here — what's on your mind?",
    };
  }

  // Code requests
  if (has('prime', 'prime number', 'is prime', 'is_prime') && (has('python') || hasWord('check') || hasWord('number'))) {
    return {
      spoken: "Sure — I've prepared the Python prime checker in the chat.",
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
    };
  }

  if (has('odd and even', 'odd or even', 'even or odd', 'even and odd', 'odd', 'even') && (has('python') || has('program') || has('code') || has('number'))) {
    return {
      spoken: "Done. I've placed the Python program for odd and even numbers in the chat.",
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
    };
  }

  if (has('recursion') || has('what is recursion')) {
    return {
      spoken: "Recursion is a technique where a function calls itself to break down complex problems into smaller subproblems.",
      type: 'text',
      content: "Recursion is a method in computer science where the solution to a problem depends on solutions to smaller instances of the same problem. A recursive function solves a base case directly, and otherwise calls itself with modified input, progressing toward the base case.",
    };
  }

  if (has('reverse a string', 'reverse string') && has('c++', 'cpp')) {
    return {
      spoken: "Done. I've written the C++ program in the chat.",
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
    };
  }

  if (has('binary search')) {
    return {
      spoken: "Here is the binary search implementation in the chat.",
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
    };
  }

  // Table requests
  if (has('compare', 'comparison') && (has('c++', 'python', 'java', 'rust', 'table'))) {
    return {
      spoken: "Here is the comparison table in the chat.",
      type: 'table',
      title: 'Programming Language Comparison',
      content: `| Feature | C++ | Python | Java |
| :--- | :--- | :--- | :--- |
| **Execution Model** | Compiled to native machine code | Interpreted bytecode (CPython) | JIT compiled on JVM |
| **Performance** | Ultra-high, near-metal speed | Moderate, great for prototyping | High, JVM-optimized |
| **Memory Management**| RAII, manual or smart pointers | Automatic garbage collection | Automatic garbage collection |
| **Type System** | Static, strongly typed | Dynamic, duck typed | Static, strongly typed |
| **Primary Use Cases**| Systems, games, low-latency audio | AI/ML, scripting, data science | Enterprise services, Android |`,
    };
  }

  // Standard conversational intents
  if (has('solar system', 'planet', 'planets', 'sun', 'mars', 'earth', 'moon', 'jupiter', 'saturn')) {
    return {
      spoken: "Our solar system has eight planets orbiting the Sun, ranging from rocky inner worlds like Mars to gas giants like Jupiter.",
      type: 'text',
      content: "Our solar system has eight planets orbiting the Sun, ranging from rocky inner worlds like Earth and Mars to massive gas giants like Jupiter and Saturn.",
    };
  }

  if (has('artificial intelligence', 'what is ai')) {
    return {
      spoken: "Artificial intelligence is the science of creating computer systems capable of reasoning, learning, and adapting to solve complex tasks.",
      type: 'text',
      content: "Artificial intelligence is the science of creating computer systems capable of reasoning, learning, and adapting to solve complex tasks.",
    };
  }

  if (has('machine learning')) {
    return {
      spoken: "Machine learning is a subset of AI that allows algorithms to learn patterns directly from data without explicit programming.",
      type: 'text',
      content: "Machine learning is a subset of AI that allows algorithms to learn patterns directly from data without being explicitly programmed.",
    };
  }

  if (has('space', 'universe', 'galaxy', 'star', 'stars')) {
    return {
      spoken: "Space is completely silent, and there are more stars in the observable universe than grains of sand on Earth.",
      type: 'text',
      content: "Space is completely silent because there is no air to carry sound, and there are more stars in the observable universe than grains of sand on Earth.",
    };
  }

  if (has('rime', 'tts')) {
    return {
      spoken: "Rime TTS is an ultra-low-latency speech platform designed for lifelike conversational turn-taking.",
      type: 'text',
      content: "Rime TTS is an ultra-low-latency, expressive speech synthesis platform designed for lifelike conversational turn-taking.",
    };
  }

  if (has('barge in', 'interrupt', 'fencing')) {
    return {
      spoken: "Barge-in lets you talk over me anytime. I silence my audio in under two milliseconds and switch immediately to your new thought.",
      type: 'text',
      content: "Barge-in lets you talk over me anytime. I silence my audio in under two milliseconds and switch immediately to what you just said.",
    };
  }

  if (hasWord('hello', 'hi', 'hey')) {
    return {
      spoken: "Hey there! I'm Aurora. What can I help you with?",
      type: 'text',
      content: "Hey there! I'm Aurora. What can I help you with today?",
    };
  }

  if (has('your name', 'who are you')) {
    return {
      spoken: "I'm Aurora, your voice assistant. Ask me anything.",
      type: 'text',
      content: "I'm Aurora, your intelligent full-duplex voice companion.",
    };
  }

  if (hasWord('joke')) {
    return {
      spoken: "Why did the AI cross the road? To avoid the latency on the other side.",
      type: 'text',
      content: "Why did the AI cross the road? To avoid the latency on the other side.",
    };
  }

  const snippet = last.length > 50 ? last.slice(0, 50) + '…' : last;
  return {
    spoken: `I'm ready to help with "${snippet}". Add an API key in settings for full online intelligence.`,
    type: 'text',
    content: `That's an intriguing question about "${snippet}"! To get unbounded dynamic answers on any topic, add a free Groq or Gemini API key in settings.`,
  };
}
