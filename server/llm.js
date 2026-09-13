// server/llm.js
// Dual-Channel LLM Gateway for Aurora with Intelligent Response Routing.
// Dynamically classifies requests into VOICE, TEXT, or HYBRID modalities.
// 1. Spoken Channel: Natural conversational speech (strictly budgeted) for Rime TTS.
// 2. Visual Channel: Rich formatted output (code blocks, tables, markdown) for the workspace.

import { validateAndEnforceContract, safeParseOrExtract } from './response-router.js';
import { estimateTokens } from './governance.js';

const ENDPOINTS = {
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  openai: 'https://api.openai.com/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
};

const DUAL_CHANNEL_SYSTEM_PROMPT = `You are Aurora, an intelligent voice-first AI assistant.
You provide clear, helpful, and conversational responses.
When asked to write code, build an app, or provide a technical solution:
1. Always start with a concise 1-2 sentence spoken summary explaining what you built and how it works.
2. Follow it with the complete, clean code in standard markdown code blocks.
For general knowledge questions, explain clearly and conversationally in natural markdown.
Always be direct and conversational. Do not use filler phrases.
Respond in standard markdown. Do not wrap your response in JSON.`;

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
}) {
  const userQuery =
    messages && messages.length > 0 ? messages[messages.length - 1]?.content || '' : '';
  if (!apiKey) {
    return { content: 'No API key configured. Please set one up.', responseMode: 'TEXT' };
  }

  const url = ENDPOINTS[provider] || ENDPOINTS.gemini;
  const defaultModel = provider === 'gemini' ? 'gemini-2.0-flash' : 'llama-3.1-8b-instant';
  const effectiveModel = model && model.trim() ? model.trim() : defaultModel;

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
      stream: !!onChunk,
    }),
    signal,
  });

  if (!res.ok) {
    throw new Error(`LLM request failed (HTTP ${res.status})`);
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

  return { content: rawText, responseMode: 'TEXT' };
}

export function localFallbackReply(userQuery, manualMode = null) {
  return { 
    content: "I am in offline mode because no API key is configured. You said: " + userQuery, 
    responseMode: 'TEXT' 
  };
}
