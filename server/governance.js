/**
 * @file server/governance.js
 * Cost Governance and Latency Budget Engine for Aurora.
 * Provides:
 * 1. Accurate per-turn token usage and USD cost accounting (LLM + Rime TTS).
 * 2. Session budget cap enforcement (downgrading to local mode when exceeded).
 * 3. Latency budget guardrails and degradation monitoring.
 */

export const MODEL_PRICING = {
  gemini: {
    promptPerMillion: 0.075,
    completionPerMillion: 0.3,
  },
  groq: {
    promptPerMillion: 0.05,
    completionPerMillion: 0.08,
  },
  openai: {
    promptPerMillion: 0.15,
    completionPerMillion: 0.6,
  },
  openrouter: {
    promptPerMillion: 0.1,
    completionPerMillion: 0.3,
  },
  local: {
    promptPerMillion: 0.0,
    completionPerMillion: 0.0,
  },
};

// Rime TTS charges approximately $0.02 per 1,000 characters
export const RIME_CHAR_COST_USD = 0.00002;

// Default session budget cap ($0.25)
export const DEFAULT_SESSION_BUDGET_CAP_USD = 0.25;

// Default latency thresholds
export const DEFAULT_LATENCY_THRESHOLDS = {
  sttMaxMs: 600,
  llmMaxMs: 3500,
  ttsMaxMs: 1500,
  totalMaxMs: 5000,
  llmTimeoutMs: 15000,
};

/**
 * Estimates token count from text using standard ~4 chars/token heuristic
 * when raw provider usage metadata is unavailable.
 *
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  return Math.max(1, Math.ceil(text.trim().length / 4));
}

/**
 * Calculates accurate turn cost based on LLM tokens and TTS characters.
 *
 * @param {object} params
 * @param {number} [params.promptTokens]
 * @param {number} [params.completionTokens]
 * @param {number} [params.ttsChars=0]
 * @param {number} [params.spokenChars=0]
 * @param {string} [params.provider='gemini']
 * @param {string} [params.modelId='']
 * @param {string} [params.ttsModelId='mistv3']
 * @param {boolean} [params.isMockAudio=false]
 * @returns {object}
 */
export function calculateTurnCost({
  promptTokens = 0,
  completionTokens = 0,
  ttsChars = 0,
  spokenChars = 0,
  provider = 'gemini',
  modelId = '',
  ttsModelId = 'mistv3',
  isMockAudio = false,
}) {
  const pTokens = Math.max(0, Number(promptTokens) || 0);
  const cTokens = Math.max(0, Number(completionTokens) || 0);
  const totalTokens = pTokens + cTokens;

  const resolvedChars = Math.max(0, Number(ttsChars || spokenChars) || 0);
  const rates = MODEL_PRICING[provider] || MODEL_PRICING.gemini;
  const promptCostUsd = (pTokens / 1_000_000) * rates.promptPerMillion;
  const completionCostUsd = (cTokens / 1_000_000) * rates.completionPerMillion;
  const llmCostUsd = promptCostUsd + completionCostUsd;

  const ttsCostUsd = isMockAudio ? 0.0 : resolvedChars * RIME_CHAR_COST_USD;
  const totalCostUsd = llmCostUsd + ttsCostUsd;

  return {
    provider,
    modelId,
    ttsModelId,
    promptTokens: pTokens,
    completionTokens: cTokens,
    totalTokens,
    promptCostUsd: Number(promptCostUsd.toFixed(6)),
    completionCostUsd: Number(completionCostUsd.toFixed(6)),
    llmCostUsd: Number(llmCostUsd.toFixed(6)),
    ttsCostUsd: Number(ttsCostUsd.toFixed(6)),
    totalCostUsd: Number(totalCostUsd.toFixed(6)),
  };
}

/**
 * Checks whether a session has exceeded its configured budget cap.
 *
 * @param {number} currentCostUsd - Cumulative cost accumulated so far in the session.
 * @param {number} [budgetCapUsd] - Budget ceiling for the session.
 * @returns {{ exceeded: boolean, warn: boolean, pct: number, currentCostUsd: number, budgetCapUsd: number, remainingUsd: number }}
 */
export function checkSessionBudget(
  currentCostUsd,
  budgetCapUsd = Number(process.env.SESSION_BUDGET_CAP_USD) || DEFAULT_SESSION_BUDGET_CAP_USD
) {
  const current = Math.max(0, Number(currentCostUsd) || 0.0);
  const cap = Math.max(0.01, Number(budgetCapUsd) || DEFAULT_SESSION_BUDGET_CAP_USD);
  const exceeded = current >= cap;
  const warn = current >= cap * 0.8;
  const pct = Math.round((current / cap) * 100);
  const remaining = Math.max(0, cap - current);

  return {
    exceeded,
    warn,
    pct,
    currentCostUsd: Number(current.toFixed(5)),
    budgetCapUsd: Number(cap.toFixed(2)),
    remainingUsd: Number(remaining.toFixed(5)),
  };
}

/**
 * Checks whether an operation latency exceeds the configured budget threshold.
 * Supports isLatencyExceeded(stageName, elapsedMs) or isLatencyExceeded(elapsedMs, thresholdMs).
 *
 * @param {string|number} stageOrElapsed
 * @param {number} elapsedOrThreshold
 * @returns {boolean}
 */
export function isLatencyExceeded(stageOrElapsed, elapsedOrThreshold) {
  if (typeof stageOrElapsed === 'string') {
    const stage = stageOrElapsed.toLowerCase();
    const threshold =
      DEFAULT_LATENCY_THRESHOLDS[`${stage}MaxMs`] ||
      DEFAULT_LATENCY_THRESHOLDS.totalMaxMs;
    return Number(elapsedOrThreshold) > threshold;
  }
  return Number(stageOrElapsed) > Number(elapsedOrThreshold);
}
