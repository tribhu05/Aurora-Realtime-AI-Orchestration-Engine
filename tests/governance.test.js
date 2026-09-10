// tests/governance.test.js
// Automated test suite for Cost Governance and Latency Budget engine (server/governance.js).
// Uses node:test and node:assert/strict.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateTokens,
  calculateTurnCost,
  checkSessionBudget,
  isLatencyExceeded,
} from '../server/governance.js';

test('Cost Governance - Token Estimation Heuristics', () => {
  assert.strictEqual(estimateTokens(''), 0);
  assert.strictEqual(estimateTokens(null), 0);
  // 'Hello world' has 11 chars -> Math.ceil(11 / 4) = 3
  assert.strictEqual(estimateTokens('Hello world'), 3);
  const sample =
    'This is a longer sentence intended to verify character-based token estimation accuracy.';
  assert.ok(estimateTokens(sample) > 15);
});

test('Cost Governance - Turn Cost Calculation', () => {
  // Test Gemini pricing
  const geminiCost = calculateTurnCost({
    promptTokens: 1000,
    completionTokens: 500,
    modelId: 'gemini-3.5-flash-lite',
    provider: 'gemini',
    spokenChars: 200,
    ttsModelId: 'mistv3',
  });

  assert.strictEqual(geminiCost.provider, 'gemini');
  assert.strictEqual(geminiCost.totalTokens, 1500);
  assert.ok(geminiCost.promptCostUsd > 0);
  assert.ok(geminiCost.completionCostUsd > 0);
  assert.ok(geminiCost.ttsCostUsd > 0);
  assert.ok(geminiCost.totalCostUsd > 0);
  assert.ok(
    Math.abs(geminiCost.totalCostUsd - (geminiCost.llmCostUsd + geminiCost.ttsCostUsd)) < 1e-6
  );

  // Test Groq pricing
  const groqCost = calculateTurnCost({
    promptTokens: 2000,
    completionTokens: 800,
    modelId: 'llama-3.1-8b-instant',
    provider: 'groq',
    spokenChars: 0,
  });

  assert.strictEqual(groqCost.ttsCostUsd, 0);
  assert.ok(groqCost.llmCostUsd > 0);

  // Test local fallback (cost should be 0)
  const localCost = calculateTurnCost({
    promptTokens: 100,
    completionTokens: 200,
    modelId: 'offline-local-engine',
    provider: 'local',
  });

  assert.strictEqual(localCost.llmCostUsd, 0);
  assert.strictEqual(localCost.totalCostUsd, 0);
});

test('Cost Governance - Session Budget Cap Enforcement', () => {
  const cap = 0.05;

  // Below warning threshold (< 80%)
  const safe = checkSessionBudget(0.02, cap);
  assert.strictEqual(safe.exceeded, false);
  assert.strictEqual(safe.warn, false);
  assert.strictEqual(safe.pct, 40);

  // Warning threshold (80% <= cost < 100%)
  const warning = checkSessionBudget(0.042, cap);
  assert.strictEqual(warning.exceeded, false);
  assert.strictEqual(warning.warn, true);
  assert.strictEqual(warning.pct, 84);

  // Budget exceeded (>= 100%)
  const exceeded = checkSessionBudget(0.051, cap);
  assert.strictEqual(exceeded.exceeded, true);
  assert.strictEqual(exceeded.warn, true);
  assert.ok(exceeded.pct >= 100);
});

test('Cost Governance - Latency Threshold Validation', () => {
  assert.strictEqual(isLatencyExceeded('stt', 400), false);
  assert.strictEqual(isLatencyExceeded('stt', 800), true);

  assert.strictEqual(isLatencyExceeded('llm', 2000), false);
  assert.strictEqual(isLatencyExceeded('llm', 9000), true);

  assert.strictEqual(isLatencyExceeded('tts', 300), false);
  assert.strictEqual(isLatencyExceeded('tts', 1800), true);

  assert.strictEqual(isLatencyExceeded('total', 1500), false);
  assert.strictEqual(isLatencyExceeded('total', 6000), true);
});
