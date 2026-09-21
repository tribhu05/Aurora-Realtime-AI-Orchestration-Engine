// tests/gemini-tools.test.js
// Test suite for Gemini tool schemas, function calling, and tool execution routing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { AURORA_TOOLS, getAssistantReply } from '../server/llm.js';

test('Gemini Tools - Schema Definition', () => {
  assert.ok(Array.isArray(AURORA_TOOLS), 'AURORA_TOOLS must be an array');
  assert.equal(
    AURORA_TOOLS.length,
    4,
    'Must define 4 tools (web_search, search_research_papers, inspect_github_repo, read_webpage)'
  );

  const webSearchTool = AURORA_TOOLS.find((t) => t.function?.name === 'web_search');
  assert.ok(webSearchTool, 'web_search tool must be defined');
  assert.equal(webSearchTool.type, 'function');
  assert.ok(webSearchTool.function.parameters.properties.query);
  assert.deepEqual(webSearchTool.function.parameters.required, ['query']);

  const scholarTool = AURORA_TOOLS.find((t) => t.function?.name === 'search_research_papers');
  assert.ok(scholarTool, 'search_research_papers tool must be defined');
  assert.equal(scholarTool.type, 'function');
  assert.ok(scholarTool.function.parameters.properties.query);
  assert.deepEqual(scholarTool.function.parameters.required, ['query']);

  const readerTool = AURORA_TOOLS.find((t) => t.function?.name === 'read_webpage');
  assert.ok(readerTool, 'read_webpage tool must be defined');
  assert.equal(readerTool.type, 'function');
  assert.ok(readerTool.function.parameters.properties.url);
  assert.deepEqual(readerTool.function.parameters.required, ['url']);

  const ghTool = AURORA_TOOLS.find((t) => t.function?.name === 'inspect_github_repo');
  assert.ok(ghTool, 'inspect_github_repo tool must be defined');
  assert.equal(ghTool.type, 'function');
  assert.ok(ghTool.function.parameters.properties.owner);
  assert.ok(ghTool.function.parameters.properties.repo);
  assert.deepEqual(ghTool.function.parameters.required, ['owner', 'repo']);
});

test('Gemini Tools - Tool Execution routing via toolExecutor', async () => {
  let executedToolName = null;
  let executedToolArgs = null;

  // Custom toolExecutor mock
  const customExecutor = async (name, args) => {
    executedToolName = name;
    executedToolArgs = args;
    if (name === 'web_search') {
      return {
        ok: true,
        results: [{ title: 'Mock Result', url: 'https://example.com', snippet: 'Sample text' }],
      };
    }
    if (name === 'inspect_github_repo') {
      return { ok: true, fullName: `${args.owner}/${args.repo}`, description: 'Mock repository' };
    }
    return { ok: false, error: 'Unknown tool' };
  };

  const result1 = await customExecutor('web_search', { query: 'latest AI developments' });
  assert.equal(executedToolName, 'web_search');
  assert.equal(executedToolArgs.query, 'latest AI developments');
  assert.equal(result1.ok, true);
  assert.equal(result1.results[0].title, 'Mock Result');

  const result2 = await customExecutor('inspect_github_repo', {
    owner: 'tribhu05',
    repo: 'SolarVision',
  });
  assert.equal(executedToolName, 'inspect_github_repo');
  assert.equal(executedToolArgs.owner, 'tribhu05');
  assert.equal(result2.ok, true);
  assert.equal(result2.fullName, 'tribhu05/SolarVision');
});

test('Gemini Tools - getAssistantReply with mock provider does not crash and respects contracts', async () => {
  const reply = await getAssistantReply({
    provider: 'gemini',
    apiKey: '', // Empty key triggers local fallback
    messages: [{ role: 'user', content: 'What is an API?' }],
  });

  assert.ok(reply, 'Must return valid structured reply');
  assert.ok(['VOICE', 'TEXT', 'HYBRID'].includes(reply.responseMode));
  assert.ok(reply.spokenResponse);
  assert.ok(reply.visualResponse);
});
