// tests/autonomous-research.test.js
// Test suite for Aurora's Autonomous Web Research & Action System.
// Covers:
// 1. Casual conversation without web research
// 2. Current information requiring web research
// 3. Research paper discovery (academic query & Crossref fallback)
// 4. Official documentation search
// 5. Unreachable source handling (404 / timeout)
// 6. Multi-source comparison query
// 7. Contextual follow-up referencing previous source ("paper 2")
// 8. SSRF protection & private IP denial
// 9. SerpApi failure handling with graceful open engine fallback
// 10. Empty search results handling
// 11. API key security (zero secrets leaked)
// 12. Mid-flight cancellation via AbortSignal

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  executeAutonomousResearch,
  isResearchNeeded,
  validateUrlForSsrf,
  isPrivateOrReservedIp,
  isContextualSourceFollowup,
  extractReadableContent,
  generateResearchQuery,
  rankSources,
  fetchWebpageContent,
} from '../server/research.js';

test('1. Casual conversation without web research', () => {
  assert.equal(isResearchNeeded('Hello! How are you doing?'), false);
  assert.equal(isResearchNeeded('What is recursion?'), false);
  assert.equal(isResearchNeeded('Calculate 15 * 8'), false);
  assert.equal(isResearchNeeded('Write a poem about the sunrise'), false);
  assert.equal(isResearchNeeded('Explain what an HTTP request is'), false);
});

test('2. Current information requiring web research', () => {
  assert.equal(isResearchNeeded('latest current affairs'), true);
  assert.equal(isResearchNeeded('what are the latest features in React 19?'), true);
  assert.equal(isResearchNeeded('who is the current CEO of Microsoft?'), true);
  assert.equal(isResearchNeeded('compare current best practices for Next.js and Nuxt'), true);
  assert.equal(isResearchNeeded('check documentation for Express REST APIs in 2026'), true);
});

test('3. Research paper discovery (academic query & Crossref fallback)', async () => {
  const query = 'recent research papers on assistive technology for visually impaired';
  const cleanQ = generateResearchQuery(query);
  assert.ok(cleanQ.toLowerCase().includes('assistive technology'));

  const res = await executeAutonomousResearch(query, {
    apiKey: '', // No private key
    fetchPages: false,
  });

  assert.equal(res.ok, true);
  assert.equal(res.isAcademic, true);
  assert.ok(res.results.length > 0);
  assert.ok(res.results[0].doi || res.results[0].year);
});

test('4. Official documentation search ranking boost', () => {
  const sources = [
    {
      title: 'Random Blog Post',
      url: 'https://randomblog.com/react',
      sourceType: 'web',
      position: 1,
    },
    {
      title: 'Official React Documentation',
      url: 'https://react.dev/learn',
      sourceType: 'documentation',
      position: 2,
    },
    { title: 'Another Forum', url: 'https://forum.com/react', sourceType: 'web', position: 3 },
  ];
  const ranked = rankSources(sources);
  assert.equal(ranked[0].sourceType, 'documentation', 'Official documentation must be ranked #1');
  assert.equal(ranked[0].url, 'https://react.dev/learn');
});

test('5. Unreachable source handling (404/network error)', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 404,
    statusText: 'Not Found',
  });

  const res = await fetchWebpageContent('https://example.com/non-existent-page', {
    fetchFn: mockFetch,
  });

  assert.equal(res.ok, false);
  assert.ok(res.error.includes('404'));
});

test('6. Multi-source comparison query generates clean search', () => {
  const q = 'Compare the latest Next.js and Nuxt deployment options';
  assert.equal(isResearchNeeded(q), true);
  const clean = generateResearchQuery(q);
  assert.ok(clean.includes('Next.js') && clean.includes('Nuxt'));
});

test('7. Contextual follow-up referencing previous source ("paper 2", "first link")', () => {
  const recentSources = [
    { title: 'Deep Residual Learning', url: 'https://arxiv.org/abs/1512.03385', source: 'arXiv' },
    {
      title: 'Attention Is All You Need',
      url: 'https://arxiv.org/abs/1706.03762',
      source: 'arXiv',
    },
  ];

  const res1 = isContextualSourceFollowup('Explain the methodology used in paper 2', recentSources);
  assert.equal(res1.isFollowup, true);
  assert.equal(res1.targetIndex, 1);
  assert.equal(res1.targetSource.title, 'Attention Is All You Need');

  const res2 = isContextualSourceFollowup('Summarize the first link', recentSources);
  assert.equal(res2.isFollowup, true);
  assert.equal(res2.targetIndex, 0);

  const resNone = isContextualSourceFollowup('Tell me a joke', recentSources);
  assert.equal(resNone.isFollowup, false);
});

test('8. SSRF protection & private IP denial', () => {
  assert.equal(isPrivateOrReservedIp('127.0.0.1'), true);
  assert.equal(isPrivateOrReservedIp('10.254.1.1'), true);
  assert.equal(isPrivateOrReservedIp('172.16.5.9'), true);
  assert.equal(isPrivateOrReservedIp('192.168.1.1'), true);
  assert.equal(isPrivateOrReservedIp('169.254.169.254'), true);
  assert.equal(isPrivateOrReservedIp('8.8.8.8'), false);

  assert.equal(validateUrlForSsrf('http://127.0.0.1:8080/admin').valid, false);
  assert.equal(validateUrlForSsrf('http://localhost:3000/secret').valid, false);
  assert.equal(validateUrlForSsrf('http://169.254.169.254/latest/meta-data').valid, false);
  assert.equal(validateUrlForSsrf('ftp://example.com/file').valid, false);
  assert.equal(validateUrlForSsrf('https://docs.github.com/en').valid, true);
});

test('9. SerpApi failure gracefully falls back to open engines', async () => {
  const failingFetch = async (url) => {
    if (url.includes('serpapi.com')) {
      return { ok: false, status: 500, statusText: 'Server Error' };
    }
    // Fallback to open search
    return {
      ok: true,
      text: async () =>
        '<html><body><div class="result results_links results_links_deep web-result "><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Ffallback">Fallback Title</a><a class="result__snippet">Fallback snippet text</a></div></div></body></html>',
    };
  };

  const res = await executeAutonomousResearch('latest AI updates', {
    apiKey: 'invalid_or_failing_key',
    fetchFn: failingFetch,
    fetchPages: false,
  });

  assert.equal(res.ok, true);
  assert.ok(res.results.length > 0);
  assert.equal(res.results[0].title, 'Fallback Title');
});

test('10. Empty search results handling without crashing', async () => {
  const emptyFetch = async () => ({
    ok: true,
    json: async () => ({ organic_results: [] }),
    text: async () => '<html><body>No results found</body></html>',
  });

  const res = await executeAutonomousResearch('nonexistentquery12345xyz', {
    apiKey: 'test_key',
    fetchFn: emptyFetch,
    fetchPages: false,
  });

  assert.equal(res.ok, false);
  assert.equal(res.results.length, 0);
});

test('11. API key security (zero secret leakage)', async () => {
  const secretKey = 'secret_private_key_xyz987';
  const failingFetch = async () => {
    throw new Error(`Failed with key=${secretKey}`);
  };

  const res = await executeAutonomousResearch('query', {
    apiKey: secretKey,
    fetchFn: failingFetch,
    fetchPages: false,
  });

  const serialized = JSON.stringify(res);
  assert.ok(!serialized.includes(secretKey), 'Private API key must never leak');
});

test('12. Mid-flight cancellation via AbortSignal', async () => {
  const controller = new AbortController();
  controller.abort();

  const res = await executeAutonomousResearch('test query', {
    signal: controller.signal,
    fetchPages: false,
  });

  assert.equal(res.ok, false);
});

test('13. Content extractor removes script, nav, comments, and boilerplate', () => {
  const html = `
    <html>
      <head><title>Clean Document</title></head>
      <body>
        <nav><a href="/home">Home</a></nav>
        <script>alert("evil");</script>
        <!-- HTML Comment -->
        <h1>Document Title</h1>
        <p>This is genuine content.</p>
        <footer>Footer info</footer>
      </body>
    </html>
  `;
  const extracted = extractReadableContent(html);
  assert.equal(extracted.title, 'Clean Document');
  assert.ok(extracted.content.includes('Document Title'));
  assert.ok(extracted.content.includes('This is genuine content.'));
  assert.ok(!extracted.content.includes('alert'));
  assert.ok(!extracted.content.includes('Footer info'));
  assert.ok(!extracted.content.includes('HTML Comment'));
});
