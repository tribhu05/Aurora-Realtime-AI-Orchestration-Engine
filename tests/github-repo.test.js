// tests/github-repo.test.js
// Test suite for GitHub repository detection, inspection, and context formatting.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectGitHubUrl,
  fetchGitHubRepoDetails,
  formatGitHubContextForLLM,
  formatSpokenGitHubSummary,
} from '../server/github.js';

test('GitHub Inspection - URL Detection', () => {
  const cases = [
    {
      input: 'Check https://github.com/tribhu05/SolarVision out',
      expected: { owner: 'tribhu05', repo: 'SolarVision' },
    },
    {
      input: 'https://github.com/expressjs/express',
      expected: { owner: 'expressjs', repo: 'express' },
    },
    {
      input: 'What is in github.com/facebook/react ?',
      expected: { owner: 'facebook', repo: 'react' },
    },
    {
      input: 'Look at https://github.com/owner/repo.git please',
      expected: { owner: 'owner', repo: 'repo' },
    },
    { input: 'Tell me about https://google.com', expected: null },
    { input: 'Just general chat about github', expected: null },
  ];

  for (const c of cases) {
    const res = detectGitHubUrl(c.input);
    if (c.expected) {
      assert.ok(res, `Must detect GitHub URL in: "${c.input}"`);
      assert.equal(res.owner, c.expected.owner);
      assert.equal(res.repo, c.expected.repo);
    } else {
      assert.equal(res, null, `Should not detect GitHub URL in: "${c.input}"`);
    }
  }
});

test('GitHub Inspection - formatGitHubContextForLLM', () => {
  const mockDetails = {
    ok: true,
    fullName: 'tribhu05/SolarVision',
    description: 'AI-powered solar panel defect detection',
    stars: 42,
    language: 'Python',
    topics: ['computer-vision', 'solar-energy', 'deep-learning'],
    defaultBranch: 'main',
    readme: '# SolarVision\nAn automated computer vision pipeline for solar inspections.',
    fileTree: ['src/main.py', 'src/model.py', 'README.md', 'requirements.txt'],
  };

  const context = formatGitHubContextForLLM(mockDetails);
  assert.ok(context.includes('### GitHub Repository Context: tribhu05/SolarVision'));
  assert.ok(context.includes('AI-powered solar panel defect detection'));
  assert.ok(context.includes('Stars: 42'));
  assert.ok(context.includes('Language: Python'));
  assert.ok(context.includes('computer-vision, solar-energy'));
  assert.ok(context.includes('src/main.py'));
  assert.ok(context.includes('An automated computer vision pipeline'));
});

test('GitHub Inspection - formatSpokenGitHubSummary', () => {
  const mockDetails = {
    fullName: 'tribhu05/SolarVision',
    description: 'AI-powered solar panel defect detection',
    language: 'Python',
    stars: 10,
  };

  const summary = formatSpokenGitHubSummary(mockDetails);
  assert.ok(summary.includes('SolarVision'));
  assert.ok(summary.includes('AI-powered solar panel defect detection'));
  assert.ok(summary.includes('Python'));
});

test('GitHub Inspection - fetchGitHubRepoDetails offline fallback with mock/simulated repo', async () => {
  // Invalid repo returns clean ok: false without unhandled exceptions
  const res = await fetchGitHubRepoDetails('nonexistent-owner-12345', 'nonexistent-repo-12345', {
    timeoutMs: 3000,
  });
  assert.equal(res.ok, false);
  assert.ok(res.error);
});
