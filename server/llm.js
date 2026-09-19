// server/llm.js
// Dual-Channel LLM Gateway for Aurora with Intelligent Response Routing.
// Dynamically classifies requests into VOICE, TEXT, or HYBRID modalities.
// 1. Spoken Channel: Natural conversational speech (strictly budgeted) for Rime TTS.
// 2. Visual Channel: Rich formatted output (code blocks, tables, markdown) for the workspace.

import {
  validateAndEnforceContract,
  safeParseOrExtract,
  detectLanguage,
  analyzeLanguage,
} from './response-router.js';

const ENDPOINTS = {
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  openai: 'https://api.openai.com/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
};

const DUAL_CHANNEL_SYSTEM_PROMPT = `You are Aurora, an intelligent, highly articulate voice-first AI assistant.
Provide direct, clear, natural, and conversational responses.
Answer immediately without conversational preamble, filler phrases, or robotic boilerplate.

Language & Fluency Guidelines:
1. Hindi (Devanagari):
   - When the user asks in Hindi (Devanagari script), reply in natural, fluent, modern everyday Hindi (सहज, स्पष्ट और बोलचाल की स्वाभाविक हिंदी).
   - Avoid overly archaic, obscure, or stiff Sanskritized words. Use natural words that Hindi speakers actually use in everyday conversation.
   - Retain technical, coding, and scientific terminology in standard English or standard transliteration (जैसे: recursion, binary search, API, DBMS, DSA, कोड, लूप, फ़ंक्शन, वेरिएबल, डेटाबेस).
   - Ensure the spoken response is polite, clear, natural, and easy to speak aloud.
2. Hinglish (Romanized Hindi):
   - When the user speaks or writes in Hinglish (Hindi written in the Latin/English alphabet, e.g. "kya haal hai", "mujhe React explain karo", "python me loop kaise chalate hain", "Bhai recursion samjha de"), reply in fluent, natural, authentic Hinglish using the SAME Latin/English alphabet!
   - Example tone: "Haan bhai! Recursion mein ek function khud ko call karta hai...", "Maine aapke liye binary search ka C++ code workspace me taiyar kar diya hai."
   - Sound friendly, modern, confident, and direct — matching how tech professionals and students communicate naturally.
   - Never convert Hinglish to Devanagari script.
3. English:
   - When the user speaks in English, reply in crisp, clear, direct English.
   - Do not insert Hindi or Hinglish phrases.

Dual-Channel Output Structure:
When asked to write code, build an app, or provide a technical solution:
1. Always start with a concise 1-2 sentence summary explaining the approach.
2. Follow it with the complete, clean code in standard markdown code blocks.
For general knowledge questions, explain clearly and conversationally in natural markdown.
Respond in standard markdown. Do not wrap your response in JSON.`;

/**
 * Sanitizes message history to ensure strict alternating user <-> assistant turns
 * for OpenAI/Gemini chat completions endpoints, preventing consecutive orphan user messages.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @returns {Array<{role: string, content: string}>}
 */
export function sanitizeMessagesForLlm(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const clean = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || !msg.content || typeof msg.content !== 'string') continue;
    const role = msg.role === 'assistant' ? 'assistant' : msg.role === 'system' ? 'system' : 'user';
    if (clean.length > 0 && clean[clean.length - 1].role === 'user' && role === 'user') {
      clean.push({ role: 'assistant', content: '[Cancelled via barge-in]' });
    }
    clean.push({ role, content: msg.content });
  }
  return clean;
}

/**
 * Generates dynamic, request-specific language requirements for the LLM.
 *
 * @param {'en'|'hi'|'hinglish'|object} detectedLangOrAnalysis - The detected language or analysis object.
 * @returns {string} Dynamic prompt instruction block.
 */
export function buildLanguageInstruction(detectedLangOrAnalysis) {
  const analysis =
    typeof detectedLangOrAnalysis === 'object' && detectedLangOrAnalysis !== null
      ? detectedLangOrAnalysis
      : {
          detectedLanguage: detectedLangOrAnalysis,
          detectedScript: detectedLangOrAnalysis === 'hi' ? 'Devanagari' : 'Latin',
          responseLanguage: detectedLangOrAnalysis || 'en',
          hasTechnicalTerms: false,
        };

  const respLang = analysis.responseLanguage || analysis.detectedLanguage || 'en';

  if (respLang === 'hinglish') {
    return `Current user language: Hinglish
Current script: Latin/Roman

Respond naturally in Hinglish using Roman script.
Do not switch languages unless the user requests it.

### LANGUAGE REQUIREMENT: HINGLISH
- Spoken rhythm: Use authentic, natural Indian conversational rhythm and short spoken sentences with clear punctuation (commas, periods) to guide voice cadence.
- Conversational phrasing: Use casual, friendly phrasing like "Chalo, is concept ko simple way mein samajhte hain." Avoid stiff, formal textbook Hindi (e.g. do NOT say "ke sambandh mein vistarpoorvak charcha karenge").
- Use natural, authentic conversational Hinglish (Hindi written in Roman/Latin script, e.g. "Haan bhai! Recursion mein ek function khud ko call karta hai...").
- Example style: "API basically do applications ke beech communication ka kaam karti hai. Ek application request bhejti hai aur doosri application uska response provide karti hai."
- Keep all technical terms, programming languages, libraries, APIs, protocols, frameworks, databases, and code strictly in standard English (e.g. recursion, binary search, API, DBMS, DSA, loop, array, function, React, Node.js, request, response).
- Do NOT translate technical terms into formal Hindi.
- Do NOT convert Hinglish to Devanagari script.
- Do NOT produce stiff or formal dictionary translations. Speak naturally and conversationally as Indian tech professionals and students communicate.
- All code blocks must remain 100% valid code in standard English syntax.`;
  }

  if (respLang === 'hi') {
    return `Current user language: Hindi${analysis.hasTechnicalTerms ? ' (with English technical terms)' : ''}
Current script: Devanagari

Respond naturally in Hindi using Devanagari script.
Do not switch languages unless the user requests it.

### LANGUAGE REQUIREMENT: HINDI
- Retain all technical, programming, and scientific terms in standard English or standard transliteration (जैसे: recursion, binary search, API, DBMS, DSA, कोड, लूप, फ़ंक्शन, वेरिएबल, डेटाबेस).
- Use natural, fluent, modern everyday Hindi in Devanagari script (सहज, स्पष्ट और बोलचाल की स्वाभाविक हिंदी). Avoid archaic or obscure Sanskritized vocabulary.
- All code blocks must remain 100% valid code in standard English syntax.`;
  }

  return `Current user language: English
Current script: Latin/Roman

Respond naturally in English using Latin script.
Do not switch languages unless the user requests it.

### LANGUAGE REQUIREMENT: ENGLISH
- Respond in clear, crisp, natural fluent English.
- Do not insert Hindi or Hinglish phrases.
- All code blocks must remain 100% valid code in standard English syntax.`;
}

/**
 * Dispatches a user turn to the configured LLM provider and formats the response.
 *
 * @param {object} params - LLM inference parameters.
 * @param {string} params.provider - LLM provider identifier ('gemini', 'groq', 'openai', 'openrouter').
 * @param {string} [params.apiKey] - Provider API key. If absent, delegates to localFallbackReply.
 * @param {string} [params.model] - Target model name.
 * @param {Array<{role: string, content: string}>} params.messages - Conversation message history.
 * @param {AbortSignal} [params.signal] - Signal for mid-flight cancellation during barge-in.
 * @param {'VOICE'|'TEXT'|'HYBRID'|null} [params.userOverride=null] - Explicit manual mode override.
 * @returns {Promise<object>} Structured response meeting the dual-channel contract.
 */
export async function getAssistantReply({
  provider,
  apiKey,
  model,
  messages,
  signal,
  userOverride,
  onChunk,
  researchContext = null,
}) {
  const userQuery =
    messages && messages.length > 0 ? messages[messages.length - 1]?.content || '' : '';
  const historyMessages = messages ? messages.slice(0, -1) : [];
  const langAnalysis = analyzeLanguage(userQuery, historyMessages);

  const cleanApiKey =
    typeof apiKey === 'string'
      ? apiKey
          .trim()
          .replace(/^["']|["']$/g, '')
          .trim()
      : '';
  if (!cleanApiKey) {
    const fallback = localFallbackReply(messages, userOverride, researchContext);
    if (typeof onChunk === 'function' && fallback && fallback.content) {
      onChunk(fallback.content);
    }
    return fallback;
  }

  const url = ENDPOINTS[provider] || ENDPOINTS.gemini;
  const defaultModel = provider === 'gemini' ? 'gemini-3.5-flash-lite' : 'llama-3.1-8b-instant';
  let effectiveModel = model && model.trim() ? model.trim() : defaultModel;
  if (
    provider === 'gemini' &&
    (effectiveModel === 'gemini-2.0-flash' || effectiveModel === 'gemini-1.5-flash')
  ) {
    effectiveModel = 'gemini-3.5-flash-lite';
  }

  const langInstruction = buildLanguageInstruction(langAnalysis);
  let effectiveSystemPrompt = `${DUAL_CHANNEL_SYSTEM_PROMPT}\n\n${langInstruction}`;
  if (researchContext) {
    effectiveSystemPrompt += `\n\n${researchContext}`;
  }

  const sanitizedMessages = sanitizeMessagesForLlm(messages);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cleanApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: effectiveModel,
      messages: [{ role: 'system', content: effectiveSystemPrompt }, ...sanitizedMessages],
      temperature: 0.2,
      max_tokens: 1500,
      stream: !!onChunk,
    }),
    signal,
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    throw new Error(`LLM request failed (HTTP ${res.status}): ${errorBody.slice(0, 200)}`);
  }

  let rawText = '';
  if (onChunk && res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split('\n');
      sseBuffer = lines.pop(); // Retain incomplete line
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
          try {
            const data = JSON.parse(trimmed.slice(6));
            const content = data.choices?.[0]?.delta?.content || '';
            if (content) {
              rawText += content;
              onChunk(rawText);
            }
          } catch (_) {}
        }
      }
    }
  } else {
    const data = await res.json();
    rawText = data?.choices?.[0]?.message?.content?.trim() || '';
  }

  return parseStructuredResponse(rawText, userQuery, messages, userOverride);
}

/**
 * Robust response parser: extracts { responseMode, spokenResponse, visualResponse }
 * and passes through deterministic server-side validation & safety enforcement.
 */
export function parseStructuredResponse(
  rawText,
  userQuery = '',
  history = [],
  userOverride = null
) {
  if (!rawText) {
    return validateAndEnforceContract(
      {
        responseMode: 'VOICE',
        spokenResponse: "I'm ready when you are. What would you like to explore?",
        visualResponse: {
          type: 'text',
          content: "I'm ready when you are. What would you like to explore?",
        },
      },
      userQuery,
      history,
      userOverride
    );
  }

  // Attempt 1: Robust parser & extractor (handles standard JSON)
  const parsed = safeParseOrExtract(rawText);
  if (parsed && typeof parsed === 'object') {
    return validateAndEnforceContract(parsed, userQuery, history, userOverride);
  }

  const queryLang = detectLanguage(userQuery);

  // Attempt 2: Code block detected in raw markdown
  const codeBlockMatch = rawText.match(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/);
  if (codeBlockMatch) {
    const lang = codeBlockMatch[1].toLowerCase() || 'code';
    const code = codeBlockMatch[2].trim();
    const textBeforeCode = rawText
      .split(/```/)[0]
      .replace(/[*_#`[\]>|]/g, '')
      .trim();
    const hasSpokenExplanation = textBeforeCode.length > 20;

    let spoken = hasSpokenExplanation
      ? textBeforeCode
      : `Done. I've placed the ${lang.toUpperCase()} code in the workspace.`;
    if (!hasSpokenExplanation) {
      if (queryLang === 'hi') {
        spoken = `लीजिए, मैंने वर्कस्पेस में ${lang.toUpperCase()} कोड तैयार कर दिया है।`;
      } else if (queryLang === 'hinglish') {
        spoken = `Maine workspace me ${lang.toUpperCase()} code taiyar kar diya hai.`;
      }
    }
    return validateAndEnforceContract(
      {
        responseMode: hasSpokenExplanation ? 'HYBRID' : 'TEXT',
        spokenResponse: spoken,
        visualResponse: {
          type: 'code',
          language: lang,
          title: `${lang.toUpperCase()} Implementation`,
          content: code,
        },
      },
      userQuery,
      history,
      userOverride
    );
  }

  // Attempt 3: Markdown table detected
  if (rawText.includes('|') && rawText.includes('---')) {
    const textBeforeTable = rawText
      .split(/\n\|/)[0]
      .replace(/[*_#`[\]>|]/g, '')
      .trim();
    const hasSpokenIntro = textBeforeTable.length > 20;
    let spoken = hasSpokenIntro
      ? textBeforeTable
      : 'Here is the comparison table in the workspace.';
    if (!hasSpokenIntro) {
      if (queryLang === 'hi') {
        spoken = 'यहाँ वर्कस्पेस में तुलना तालिका दी गई है।';
      } else if (queryLang === 'hinglish') {
        spoken = 'Yeh rahi comparison table aapke workspace me.';
      }
    }
    return validateAndEnforceContract(
      {
        responseMode: hasSpokenIntro ? 'HYBRID' : 'TEXT',
        spokenResponse: spoken,
        visualResponse: {
          type: 'table',
          title: 'Comparison Table',
          content: rawText,
        },
      },
      userQuery,
      history,
      userOverride
    );
  }

  // Attempt 4: General text
  let cleanSpoken = rawText
    .replace(/```[\s\S]*?(?:```|$)/g, '')
    .replace(/`[^`]+(?:`|$)/g, '')
    .replace(/[*_#`[\]>|]/g, '')
    .trim();
  let cleanVisual = rawText;

  if (cleanSpoken.trim().startsWith('{')) {
    cleanSpoken =
      queryLang === 'hi'
        ? 'लीजिए, मैंने वर्कस्पेस में जवाब तैयार कर दिया है।'
        : queryLang === 'hinglish'
          ? 'Maine workspace me response ready kar diya hai.'
          : "I've placed the response in the workspace.";
    cleanVisual = cleanVisual
      .replace(/^\s*\{[\s\S]*?"content"\s*:\s*"/i, '')
      .replace(/"\s*\}\s*$/i, '')
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"');
  }

  return validateAndEnforceContract(
    {
      responseMode: 'VOICE',
      spokenResponse: cleanSpoken,
      visualResponse: {
        type: cleanVisual.includes('#') || cleanVisual.includes('*') ? 'markdown' : 'text',
        content: cleanVisual,
      },
    },
    userQuery,
    history,
    userOverride
  );
}

// --- Local fallback so the app works seamlessly out of the box ---
export function localFallbackReply(messagesOrQuery, userOverride = null, researchContext = null) {
  const messages = Array.isArray(messagesOrQuery)
    ? messagesOrQuery
    : [{ role: 'user', content: String(messagesOrQuery || '') }];
  const userQuery = messages.length > 0 ? messages[messages.length - 1]?.content || '' : '';
  const last = userQuery.toLowerCase().trim();

  const finalize = (obj) => validateAndEnforceContract(obj, userQuery, messages, userOverride);

  const has = (...phrases) => phrases.some((p) => last.includes(p));
  const hasWord = (...words) => words.some((w) => new RegExp(`\\b${w}\\b`, 'i').test(last));
  const lang = detectLanguage(userQuery, messages);

  if (!last) {
    const emptySpoken =
      lang === 'hi'
        ? 'नमस्ते! मैं आपकी क्या मदद कर सकता हूँ?'
        : lang === 'hinglish'
          ? 'Main taiyar hoon — boliye kya madad karoon?'
          : "I'm here — what's on your mind?";
    return finalize({
      responseMode: 'VOICE',
      spokenResponse: emptySpoken,
      visualResponse: {
        type: 'text',
        content: emptySpoken,
      },
    });
  }

  // --- How Are You & Greeting Handling ---
  if (has('how are you', 'how r u', 'how are u', 'how do you do')) {
    return finalize({
      responseMode: 'VOICE',
      spokenResponse: "I'm doing great, thank you! How are you doing today?",
      visualResponse: {
        type: 'text',
        content:
          "I'm doing great, thank you! How are you doing today? I'm ready to help you with coding, architecture, or any questions.",
      },
    });
  }

  // --- Recursion Concept Handling ---
  if (has('recursion', 'रिकर्शन')) {
    let spoken =
      'Sure bro! Recursion is a technique where a function calls itself until it reaches a base case.';
    let visual =
      '### Recursion Concept\nRecursion is a programming approach where a function solves a problem by calling a smaller instance of itself.\n\n1. **Base Case**: Halting condition that stops recursive calls.\n2. **Recursive Step**: Reduces the problem and calls the same function.';

    if (lang === 'hi') {
      spoken =
        'ज़रूर! Recursion एक ऐसी तकनीक है जिसमें एक फ़ंक्शन खुद को तब तक कॉल करता है जब तक कि बेस केस पूरा न हो जाए।';
      visual =
        '### रिकर्शन (Recursion) की अवधारणा\n**Recursion** एक ऐसी प्रोग्रामिंग तकनीक है जिसमें कोई फ़ंक्शन अपनी समस्या को हल करने के लिए स्वयं को बार-बार कॉल करता है।\n\n1. **बेस केस (Base Case)**: यह कॉल को रोकने की अनिवार्य शर्त है।\n2. **रिकर्सिव कॉल (Recursive Step)**: समस्या को छोटा करके फ़ंक्शन को दोबारा कॉल करता है।';
    } else if (lang === 'hinglish') {
      spoken =
        'Haan bhai! Recursion mein ek function khud ko call karta hai jab tak base case na reach ho jaye.';
      visual =
        '### Recursion Concept (Hinglish)\n**Recursion** ek aisi programming technique hai jahan function problem solve karne ke liye khud ko hi call karta hai.\n\n1. **Base Case**: Recursion ko stop karne ki condition taaki infinite loop na bane.\n2. **Recursive Call**: Problem size ko reduce karke function ko repeatedly execute karta hai.';
    }

    return finalize({
      responseMode: 'VOICE',
      spokenResponse: spoken,
      visualResponse: {
        type: 'text',
        content: visual,
        title: 'Recursion Concept',
      },
    });
  }

  // --- DSA Concept Handling ---
  if (has('dsa', 'data structures and algorithms', 'data structure', 'डेटा स्ट्रक्चर')) {
    let spoken =
      'Sure! DSA, or Data Structures and Algorithms, is the foundational core of efficient problem-solving in software engineering.';
    let visual =
      '### Data Structures & Algorithms (DSA)\nDSA represents the fundamental building blocks of computing:\n- **Data Structures**: Efficiently organize, store, and access data (Arrays, Linked Lists, Trees, Graphs).\n- **Algorithms**: Step-by-step procedures to process data and solve problems (Sorting, Searching, Dynamic Programming).';

    if (lang === 'hi') {
      spoken =
        'ज़रूर! DSA (Data Structures and Algorithms) कुशल सॉफ़्टवेयर और समस्या समाधान की बुनियादी नींव है।';
      visual =
        '### डेटा स्ट्रक्चर्स और एल्गोरिदम (DSA)\n**DSA** कंप्यूटर साइंस का सबसे महत्वपूर्ण आधार है:\n- **डेटा स्ट्रक्चर्स (Data Structures)**: डेटा को मेमोरी में कुशलतापूर्वक स्टोर और व्यवस्थित करना (ऐरे, लिंक्ड लिस्ट, ट्री, ग्राफ़)।\n- **एल्गोरिदम (Algorithms)**: किसी कार्य को हल करने के चरणबद्ध नियम (सॉर्टिंग, सर्चिंग, डायनामिक प्रोग्रामिंग)।';
    } else if (lang === 'hinglish') {
      spoken =
        'Haan bhai! DSA (Data Structures and Algorithms) basically computer science ka core foundation hai jo efficient software banane mein use hota hai.';
      visual =
        '### Data Structures & Algorithms (DSA)\n**DSA** computer science ka main foundation hai:\n- **Data Structures**: Data ko memory mein efficiently store aur organize karna (Arrays, Linked Lists, Trees, Graphs).\n- **Algorithms**: Problem solve karne ke step-by-step logic aur procedures (Sorting, Searching, Dynamic Programming).';
    }

    return finalize({
      responseMode: 'HYBRID',
      spokenResponse: spoken,
      visualResponse: {
        type: 'text',
        content: visual,
        title: 'DSA Overview',
      },
    });
  }

  // --- DBMS Concept Handling ---
  if (has('dbms', 'database management system', 'डीबीएमएस')) {
    let spoken =
      'A DBMS is software designed to store, retrieve, manage, and secure database records efficiently.';
    let visual =
      '### Database Management System (DBMS)\nA **DBMS** provides an interface between users and databases to maintain data integrity, security, and concurrency (e.g. MySQL, PostgreSQL, Oracle).';

    if (lang === 'hi') {
      spoken =
        'ज़रूर! DBMS डेटाबेस को व्यवस्थित, सुरक्षित और कुशलता से प्रबंधित करने वाला सॉफ़्टवेयर सिस्टम है।';
      visual =
        '### डेटाबेस मैनेजमेंट सिस्टम (DBMS)\n**DBMS** एक ऐसा सॉफ़्टवेयर है जो डेटाबेस को सुरक्षित रूप से स्टोर, अपडेट और प्रोसेस करने की सुविधा देता है (जैसे MySQL, PostgreSQL, Oracle)।';
    } else if (lang === 'hinglish') {
      spoken =
        'DBMS basically ek software system hai jo databases ko create, manage aur efficiently query karne ke liye use hota hai.';
      visual =
        '### Database Management System (DBMS)\n**DBMS** ek software layer hai jo application aur database ke beech structured data management, security aur ACID properties ensure karti hai (jaise MySQL, PostgreSQL, SQLite).';
    }

    return finalize({
      responseMode: 'HYBRID',
      spokenResponse: spoken,
      visualResponse: {
        type: 'text',
        content: visual,
        title: 'DBMS Overview',
      },
    });
  }

  // --- API & Architecture Concept Handling ---
  if (
    has(
      'api work',
      'explain api',
      'what is an api',
      'how api works',
      'how apis work',
      'api kya',
      'api kaise',
      'api request',
      'api ke bare',
      'api kya hoti'
    )
  ) {
    let spoken =
      'An API allows two applications to communicate and exchange data with structured requests and responses.';
    let visual =
      'An **API (Application Programming Interface)** enables software systems to communicate securely.\n\n- **Client**: Sends requests (e.g. GET, POST, PUT, DELETE)\n- **Server**: Processes business logic and returns structured responses (JSON/XML)\n- **Common Protocols**: REST, GraphQL, WebSocket';

    if (lang === 'hi') {
      spoken = 'एपीआई दो सॉफ्टवेयर सिस्टम्स के बीच डेटा और संचार का सुरक्षित माध्यम बनती है।';
      visual =
        '**एपीआई (API - Application Programming Interface)** दो अलग-अलग एप्लिकेशन के बीच डेटा और संचार की सुविधा प्रदान करती है।';
    } else if (lang === 'hinglish') {
      spoken =
        'API basically do applications ke beech communication ka kaam karti hai. Ek application request bhejti hai aur doosri application uska response provide karti hai.';
      visual =
        '**API (Application Programming Interface)** do applications ke beech data exchange aur structured communication enable karti hai.\n\n- **Client**: Request bhejta hai (GET, POST, PUT, DELETE)\n- **Server**: Request process karta hai aur response return karta hai (JSON/XML)\n- **Protocols**: REST, GraphQL, WebSocket';
    }

    return finalize({
      responseMode: 'HYBRID',
      spokenResponse: spoken,
      visualResponse: {
        type: 'text',
        content: visual,
        title: 'API Architecture & Workings',
      },
    });
  }

  // --- Database Concept Handling ---
  if (has('database kya', 'database explain', 'what is a database', 'database connect')) {
    let spoken =
      'A database is an organized system to store, manage, and query structured data securely.';
    let visual =
      'A **Database** organizes and persists application state and business records efficiently (e.g. PostgreSQL, SQLite, MongoDB).';

    if (lang === 'hi') {
      spoken =
        'डेटाबेस डेटा को सुरक्षित रूप से संग्रहीत, प्रबंधित और खोजने की एक संगठित प्रणाली है।';
    } else if (lang === 'hinglish') {
      spoken =
        'Database ek organized system hai jahan application ka data securely store, update aur query hota hai.';
      visual =
        '**Database** ek structured system hai jismein application ka data safely persist aur query kiya jata hai (jaise PostgreSQL, SQLite, MongoDB).';
    }

    return finalize({
      responseMode: 'VOICE',
      spokenResponse: spoken,
      visualResponse: {
        type: 'text',
        content: visual,
        title: 'Database Architecture',
      },
    });
  }

  // --- Server Startup & Crash Troubleshooting ---
  if (
    has(
      'server start nahi',
      'server crash',
      'server not starting',
      'server is crashing',
      'isko kaise fix karu',
      'kaise fix karu'
    )
  ) {
    let spoken =
      'Check your terminal logs for port conflicts or missing environment variables to resolve the issue.';
    let visual =
      '### Node.js Server Troubleshooting Steps:\n1. Inspect the terminal error stack trace.\n2. Ensure the configured port (e.g. 3000) is free.\n3. Verify your `.env` configuration.\n4. Run `npm install` to ensure all packages exist.';

    if (lang === 'hi') {
      spoken = 'टर्मिनल लॉग्स में पोर्ट टकराव या अनुपलब्ध पर्यावरण चर की जांच करें।';
    } else if (lang === 'hinglish') {
      spoken =
        'Server logs check karke error trace dekhiye, usually port conflict ya missing environment variables ki wajah se server crash hota hai.';
      visual =
        '### Server Troubleshooting Checklist:\n1. Terminal logs aur stack trace inspect karein\n2. Port conflict verify karein (e.g. `kill -9` or change `PORT`)\n3. `.env` file aur environment variables verify karein\n4. `npm install` run karke dependencies update karein';
    }

    return finalize({
      responseMode: 'VOICE',
      spokenResponse: spoken,
      visualResponse: {
        type: 'text',
        content: visual,
        title: 'Server Troubleshooting',
      },
    });
  }

  // --- Hindi (Devanagari) conversational intelligence ---
  if (lang === 'hi') {
    if (has('नमस्ते', 'नमस्कार', 'प्रणाम', 'हाय', 'हेलो', 'सुप्रभात')) {
      return finalize({
        responseMode: 'VOICE',
        spokenResponse: 'नमस्ते! मैं ऑरोरा हूँ। मैं आपकी क्या सहायता कर सकता हूँ?',
        visualResponse: {
          type: 'text',
          content:
            'नमस्ते! मैं **ऑरोरा (Aurora)** हूँ, आपका रियल-टाइम वॉइस AI असिस्टेंट।\n\nमैं कोडिंग, सवालों के जवाब और मुश्किल कॉन्सेप्ट्स को समझाने में आपकी मदद कर सकता हूँ। बताइए, आज क्या सीखना या बनाना चाहते हैं?',
        },
      });
    }
    if (has('कौन हो', 'कौन हैं', 'तुम्हारा नाम', 'आपका नाम', 'परिचय')) {
      return finalize({
        responseMode: 'VOICE',
        spokenResponse: 'मैं ऑरोरा हूँ, आपका रियल-टाइम वॉइस AI असिस्टेंट।',
        visualResponse: {
          type: 'text',
          content:
            'मैं **ऑरोरा (Aurora)** हूँ — एक हाई-परफॉर्मेंस AI असिस्टेंट जो रियल-टाइम वॉइस और इंटरेक्टिव वर्कस्पेस के साथ आपकी सहायता करता है।',
        },
      });
    }
    if (has('कैसे हो', 'क्या हाल', 'कैसी हो', 'सब ठीक')) {
      return finalize({
        responseMode: 'VOICE',
        spokenResponse: 'मैं बिल्कुल ठीक हूँ, पूछने के लिए धन्यवाद! आप कैसे हैं?',
        visualResponse: {
          type: 'text',
          content:
            'मैं बिल्कुल बढ़िया और काम के लिए तैयार हूँ! आप बताइए, आज आपका दिन कैसा चल रहा है?',
        },
      });
    }
    if (has('हिंदी बोल', 'हिंदी आती', 'हिंदी जानते', 'हिंदी में बात')) {
      return finalize({
        responseMode: 'VOICE',
        spokenResponse: 'हाँ बिल्कुल! मैं हिंदी और हिंग्लिश दोनों में आसानी से बात कर सकता हूँ।',
        visualResponse: {
          type: 'text',
          content:
            'हाँ, मैं **हिंदी** और **हिंग्लिश** दोनों में पूरी तरह सक्षम हूँ। आप बेझिझक हिंदी में मुझसे सवाल पूछ सकते हैं या कोडिंग करवा सकते हैं।',
        },
      });
    }
  }

  // --- Hinglish (Roman Hindi) conversational intelligence ---
  if (lang === 'hinglish') {
    if (has('namaste', 'namaskar', 'pranam')) {
      return finalize({
        responseMode: 'VOICE',
        spokenResponse: 'Main bilkul badhiya hoon! Aap bataiye, aaj kya madad karoon?',
        visualResponse: {
          type: 'text',
          content:
            'Namaste! Main **Aurora** hoon — aapka voice-first AI assistant.\n\nAaj hum kis topic par kaam karenge? Coding, doubt solving, ya naya project?',
        },
      });
    }
    if (
      has(
        'aap kaise ho',
        'aap kaise hain',
        'kaise ho',
        'kaise hain',
        'kya haal',
        'kaisa hai',
        'kya chal raha'
      )
    ) {
      return finalize({
        responseMode: 'VOICE',
        spokenResponse: 'Main ekdum theek hoon, aap kaise hain?',
        visualResponse: {
          type: 'text',
          content:
            'Main ekdum badhiya hoon, poochne ke liye shukriya! Aap bataiye, aaj aapka din kaisa chal raha hai aur main aapki kya madad karoon?',
        },
      });
    }
    if (has('kaun ho', 'kaun hai', 'who are you', 'naam kya hai', 'apne bare me')) {
      return finalize({
        responseMode: 'VOICE',
        spokenResponse: 'Main Aurora hoon, aapka real-time conversational voice AI assistant.',
        visualResponse: {
          type: 'text',
          content:
            'Main **Aurora** hoon — ek real-time AI assistant jo voice conversation aur interactive visual workspace ke sath kaam karta hai.',
        },
      });
    }
    if (has('hindi bol', 'hindi aati', 'hindi me baat', 'can you speak hindi')) {
      return finalize({
        responseMode: 'VOICE',
        spokenResponse: 'Haan bilkul! Main Hindi aur Hinglish dono me fluent baat kar sakta hoon.',
        visualResponse: {
          type: 'text',
          content:
            'Haan bilkul! Main **Hindi (हिन्दी)** aur **Hinglish** dono me bohot fluently aur naturally baat kar sakta hoon. Boliye, aaj kya code ya explain karna hai?',
        },
      });
    }
  }

  // Code requests -> TEXT
  if (
    has('prime', 'prime number', 'is prime', 'is_prime', 'प्राइम', 'अभाज्य') &&
    (has('python') ||
      hasWord('check') ||
      hasWord('number') ||
      has('कोड', 'code', 'likho', 'likh do', 'batao', 'bana do'))
  ) {
    let spoken = "Sure — I've prepared the Python prime checker in the workspace.";
    if (lang === 'hi') {
      spoken = 'लीजिए, मैंने वर्कस्पेस में पायथन प्राइम नंबर चेकर तैयार कर दिया है।';
    } else if (lang === 'hinglish') {
      spoken = 'Maine workspace me Python prime checker ready kar diya hai.';
    }
    return finalize({
      responseMode: 'TEXT',
      spokenResponse: spoken,
      visualResponse: {
        type: 'code',
        language: 'python',
        title: lang === 'hi' ? 'पायथन में प्राइम नंबर चेकर' : 'Prime Number Checker in Python',
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

  if (
    has(
      'odd and even',
      'odd or even',
      'even or odd',
      'even and odd',
      'odd',
      'even',
      'सम और विषम',
      'सम या विषम'
    ) &&
    (has('python') ||
      has('program') ||
      has('code') ||
      has('number') ||
      has('कोड', 'likho', 'likh do'))
  ) {
    let spoken = "Done. I've placed the Python program for odd and even numbers in the workspace.";
    if (lang === 'hi') {
      spoken = 'लीजिए, सम और विषम संख्याओं का पायथन प्रोग्राम वर्कस्पेस में तैयार है।';
    } else if (lang === 'hinglish') {
      spoken = 'Done! Maine odd aur even number ka Python code workspace me add kar diya hai.';
    }
    return finalize({
      responseMode: 'TEXT',
      spokenResponse: spoken,
      visualResponse: {
        type: 'code',
        language: 'python',
        title: lang === 'hi' ? 'सम और विषम संख्या चेकर' : 'Check Odd or Even Number in Python',
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

  if (has('recursion', 'what is recursion', 'रिकर्शन', 'रिकर्सन')) {
    const isHybrid = has('code', 'program', 'example', 'implement', 'कोड', 'likho', 'likh do');
    let spoken = isHybrid
      ? 'Recursion breaks problems down by calling the function itself until reaching a base case. Here is an implementation.'
      : 'Recursion is a technique where a function calls itself to break down complex problems into smaller subproblems.';
    if (lang === 'hi') {
      spoken = isHybrid
        ? 'रिकर्शन में एक फ़ंक्शन खुद को तब तक कॉल करता है जब तक बेस केस न मिल जाए। पूरा कोड वर्कस्पेस में है।'
        : 'रिकर्शन कंप्यूटर साइंस की एक तकनीक है जहाँ कोई फ़ंक्शन किसी समस्या को छोटे हिस्सों में हल करने के लिए खुद को कॉल करता है।';
    } else if (lang === 'hinglish') {
      spoken = isHybrid
        ? 'Recursion me function khud ko bar-bar call karta hai jab tak base case na mil jaye. Code workspace me taiyar hai.'
        : 'Recursion ek technique hai jisme function khud ko hi call karke problem ko chhote parts me solve karta hai.';
    }
    return finalize({
      responseMode: isHybrid ? 'HYBRID' : 'VOICE',
      spokenResponse: spoken,
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
          : lang === 'hi'
            ? 'रिकर्शन एक प्रोग्रामिंग तकनीक है जिसमें कोई फ़ंक्शन किसी बड़ी समस्या को हल करने के लिए बार-बार खुद को छोटे इनपुट के साथ कॉल करता है। इसमें एक बेस केस (Base Case) होना ज़रूरी है जो कॉल को रोकता है।'
            : lang === 'hinglish'
              ? 'Recursion ek programming technique hai jahan function khud ko call karta hai jab tak base case trigger na ho jaye. Yeh problems ko simple aur modular banata hai.'
              : 'Recursion is a method in computer science where the solution to a problem depends on solutions to smaller instances of the same problem. A recursive function solves a base case directly, and otherwise calls itself with modified input, progressing toward the base case.',
      },
    });
  }

  // Follow-up: "Now write the Python code for it."
  if (
    (has('code for it', 'now write', 'write the python code') && has('python')) ||
    (has('for it') && has('code'))
  ) {
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

print(factorial(5))`,
      },
    });
  }

  // Binary search in C++
  if (has('binary search', 'बाइनरी सर्च')) {
    const isHybrid = has('explain', 'concept', 'why', 'how', 'samjhao', 'samjha do');
    let spoken = isHybrid
      ? 'Binary search repeatedly divides a sorted array in half to find a target in logarithmic time. Here is the C++ code.'
      : "Done. I've written the binary search algorithm in C++ in the workspace.";
    if (lang === 'hi') {
      spoken = 'लीजिए, मैंने वर्कस्पेस में बाइनरी सर्च का C++ कोड लिख दिया है।';
    } else if (lang === 'hinglish') {
      spoken = 'Maine workspace me binary search ka C++ implementation place kar diya hai.';
    }
    return finalize({
      responseMode: isHybrid ? 'HYBRID' : 'TEXT',
      spokenResponse: spoken,
      visualResponse: {
        type: 'code',
        language: 'cpp',
        title: 'Binary Search Implementation in C++',
        content: `#include <iostream>
#include <vector>

int binarySearch(const std::vector<int>& arr, int target) {
    int low = 0;
    int high = arr.size() - 1;

    while (low <= high) {
        int mid = low + (high - low) / 2;
        if (arr[mid] == target) return mid;
        if (arr[mid] < target) low = mid + 1;
        else high = mid - 1;
    }
    return -1;
}

int main() {
    std::vector<int> numbers = {2, 5, 8, 12, 16, 23, 38, 56, 72, 91};
    int target = 23;
    int result = binarySearch(numbers, target);
    std::cout << "Element found at index: " << result << std::endl;
    return 0;
}`,
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
  if (
    has('sliding window') ||
    (has('c++', 'cpp', 'in c++', 'in cpp') &&
      (has('sliding') || has('window') || has('want it in c++') || has('want it in cpp')))
  ) {
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
    const prevHistory = (messages || [])
      .map((m) => m.content || '')
      .join(' ')
      .toLowerCase();
    if (
      prevHistory.includes('sliding window') ||
      prevHistory.includes('window') ||
      prevHistory.includes('algorithm')
    ) {
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
      spokenResponse: 'Here is the binary search implementation in the workspace.',
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
  if (has('compare', 'comparison') && has('c++', 'python', 'java', 'rust', 'table')) {
    const isHybrid = has('recommend', 'better', 'choose');
    return finalize({
      responseMode: isHybrid ? 'HYBRID' : 'TEXT',
      spokenResponse: isHybrid
        ? 'C++ offers maximum speed, while Python provides fast development velocity. Here is the full comparison table.'
        : 'Here is the language comparison table in the workspace.',
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
  if (
    has('solar system', 'planet', 'planets', 'sun', 'mars', 'earth', 'moon', 'jupiter', 'saturn')
  ) {
    return finalize({
      responseMode: 'VOICE',
      spokenResponse:
        'Our solar system has eight planets orbiting the Sun, ranging from rocky inner worlds like Mars to gas giants like Jupiter.',
      visualResponse: {
        type: 'text',
        content:
          'Our solar system has eight planets orbiting the Sun, ranging from rocky inner worlds like Earth and Mars to massive gas giants like Jupiter and Saturn.',
      },
    });
  }

  if (has('artificial intelligence', 'what is ai')) {
    return finalize({
      responseMode: 'VOICE',
      spokenResponse:
        'Artificial intelligence is the science of creating computer systems capable of reasoning, learning, and adapting to solve complex tasks.',
      visualResponse: {
        type: 'text',
        content:
          'Artificial intelligence is the science of creating computer systems capable of reasoning, learning, and adapting to solve complex tasks.',
      },
    });
  }

  if (has('machine learning')) {
    return finalize({
      responseMode: 'VOICE',
      spokenResponse:
        'Machine learning is a subset of AI that allows algorithms to learn patterns directly from data without explicit programming.',
      visualResponse: {
        type: 'text',
        content:
          'Machine learning is a subset of AI that allows algorithms to learn patterns directly from data without being explicitly programmed.',
      },
    });
  }

  if (has('space', 'universe', 'galaxy', 'star', 'stars')) {
    return finalize({
      responseMode: 'VOICE',
      spokenResponse:
        'Space is completely silent, and there are more stars in the observable universe than grains of sand on Earth.',
      visualResponse: {
        type: 'text',
        content:
          'Space is completely silent because there is no air to carry sound, and there are more stars in the observable universe than grains of sand on Earth.',
      },
    });
  }

  if (has('rime', 'tts')) {
    return finalize({
      responseMode: 'VOICE',
      spokenResponse:
        'Rime TTS is an ultra-low-latency speech platform designed for lifelike conversational turn-taking.',
      visualResponse: {
        type: 'text',
        content:
          'Rime TTS is an ultra-low-latency, expressive speech synthesis platform designed for lifelike conversational turn-taking.',
      },
    });
  }

  if (has('barge in', 'interrupt', 'fencing')) {
    return finalize({
      responseMode: 'VOICE',
      spokenResponse:
        'Barge-in lets you talk over me anytime. I silence my audio in under two milliseconds and switch immediately to your new thought.',
      visualResponse: {
        type: 'text',
        content:
          'Barge-in lets you talk over me anytime. I silence my audio in under two milliseconds and switch immediately to what you just said.',
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
      spokenResponse: 'Why did the AI cross the road? To avoid the latency on the other side.',
      visualResponse: {
        type: 'text',
        content: 'Why did the AI cross the road? To avoid the latency on the other side.',
      },
    });
  }

  if (researchContext) {
    return finalize({
      responseMode: 'HYBRID',
      spokenResponse:
        'I checked current web documentation and summarized the details in the workspace.',
      visualResponse: {
        type: 'markdown',
        content: `### Live Web Research Findings\n\n${researchContext}`,
      },
    });
  }

  const snippet = last.length > 50 ? last.slice(0, 50) + '…' : last;
  return finalize({
    responseMode: 'VOICE',
    spokenResponse: `I'm ready to help with "${snippet}".`,
    visualResponse: {
      type: 'text',
      content: `I am currently processing in lightweight mode for "${snippet}".`,
    },
  });
}
