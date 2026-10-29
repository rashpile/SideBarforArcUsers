import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLlmsTxtCandidates,
  buildAiRequestBody,
  DEFAULT_AI_RENAME_SETTINGS,
  extractAiResponseText,
  getHostPermissionPattern,
  normalizeAiEndpoint,
  parseAiRenameSettings,
  resolveAiEndpointCandidates,
  sanitizeGeneratedTitle,
  selectPageContent,
} from '../../src/utils/aiConfig.ts';

test('old AI settings without reasoning effort get medium', () =>
{
  const settings = parseAiRenameSettings(JSON.stringify({
    baseUrl: 'https://example.com/v1',
    apiKey: 'key',
    model: 'model',
    protocol: 'auto',
    prompt: 'prompt',
    autoRename: false,
  }));
  assert.equal(settings.reasoningEffort, 'medium');
  assert.equal(DEFAULT_AI_RENAME_SETTINGS.reasoningEffort, 'medium');
});

test('a Responses request uses 100 max output tokens and a reasoning object', () =>
{
  const body = buildAiRequestBody(
    { ...DEFAULT_AI_RENAME_SETTINGS, model: 'model', reasoningEffort: 'high' },
    'responses',
    'prompt'
  );
  assert.deepEqual(body, {
    model: 'model',
    input: 'prompt',
    max_output_tokens: 100,
    reasoning: { effort: 'high' },
  });
});

test('a Chat Completions request uses 100 max completion tokens and reasoning_effort', () =>
{
  const body = buildAiRequestBody(
    { ...DEFAULT_AI_RENAME_SETTINGS, model: 'model', reasoningEffort: 'low' },
    'chat-completions',
    'prompt'
  );
  assert.deepEqual(body, {
    model: 'model',
    messages: [{ role: 'user', content: 'prompt' }],
    max_completion_tokens: 100,
    reasoning_effort: 'low',
  });
});

test('reasoning effort None sends no reasoning field', () =>
{
  const settings = { ...DEFAULT_AI_RENAME_SETTINGS, model: 'model', reasoningEffort: 'off' as const };
  assert.equal('reasoning' in buildAiRequestBody(settings, 'responses', 'prompt'), false);
  assert.equal('reasoning_effort' in buildAiRequestBody(settings, 'chat-completions', 'prompt'), false);
});

test('adds the v1 Responses endpoint to an OpenAI root URL', () =>
{
  assert.equal(
    normalizeAiEndpoint('https://api.openai.com', 'responses'),
    'https://api.openai.com/v1/responses'
  );
});
test('appends the Chat Completions endpoint to a URL that already has v1', () =>
{
  assert.equal(
    normalizeAiEndpoint('https://example.com/openai/v1/', 'chat-completions'),
    'https://example.com/openai/v1/chat/completions'
  );
});

test('a full endpoint is not appended again and keeps its query', () =>
{
  assert.equal(
    normalizeAiEndpoint('https://example.com/v1/responses?api-version=2026-01-01', 'responses'),
    'https://example.com/v1/responses?api-version=2026-01-01'
  );
});

test('an explicit protocol can replace the other endpoint in a full URL', () =>
{
  assert.equal(
    normalizeAiEndpoint('https://example.com/v1/responses', 'chat-completions'),
    'https://example.com/v1/chat/completions'
  );
});

test('Auto infers the protocol from a full Responses endpoint', () =>
{
  assert.deepEqual(
    resolveAiEndpointCandidates('https://example.com/v1/responses', 'auto'),
    [{ protocol: 'responses', url: 'https://example.com/v1/responses' }]
  );
});

test('Auto returns Responses, then Chat Completions, for a Base URL', () =>
{
  assert.deepEqual(
    resolveAiEndpointCandidates('https://example.com/v1', 'auto'),
    [
      { protocol: 'responses', url: 'https://example.com/v1/responses' },
      { protocol: 'chat-completions', url: 'https://example.com/v1/chat/completions' },
    ]
  );
});

test('rejects a non-HTTP URL', () =>
{
  assert.throws(() => normalizeAiEndpoint('file:///tmp/api', 'responses'), /HTTP or HTTPS/);
});

test('rejects a username and password in the URL', () =>
{
  assert.throws(() => normalizeAiEndpoint('https://user:secret@example.com/v1', 'responses'), /credentials/);
});

test('rejects an API key in the URL query', () =>
{
  assert.throws(() => normalizeAiEndpoint('https://example.com/v1?api_key=secret', 'responses'), /API key or token/);
});

test('the host permission keeps only the origin', () =>
{
  assert.equal(getHostPermissionPattern('https://example.com:8443/openai/v1'), 'https://example.com:8443/*');
});

test('parses the top-level Responses output_text', () =>
{
  assert.equal(extractAiResponseText('responses', { output_text: 'Short title' }), 'Short title');
});

test('parses Responses output content', () =>
{
  const payload = {
    output: [{ content: [{ type: 'output_text', text: '标题' }] }],
  };
  assert.equal(extractAiResponseText('responses', payload), '标题');
});

test('Responses parsing does not pick up reasoning text', () =>
{
  assert.throws(
    () => extractAiResponseText('responses', { output: [{ content: [{ type: 'reasoning', text: 'secret' }] }] }),
    /did not contain text/
  );
});

test('parses Chat Completions string content', () =>
{
  assert.equal(
    extractAiResponseText('chat-completions', { choices: [{ message: { content: 'Short title' } }] }),
    'Short title'
  );
});

test('parses Chat Completions text parts', () =>
{
  const payload = { choices: [{ message: { content: [{ type: 'text', text: '标题' }] } }] };
  assert.equal(extractAiResponseText('chat-completions', payload), '标题');
});

test('the title loses paired quotes, extra whitespace and final punctuation', () =>
{
  assert.equal(sanitizeGeneratedTitle('  “Arc   AI 命名。”  '), 'Arc AI 命名');
});

test('rejects multi-line model output', () =>
{
  assert.throws(() => sanitizeGeneratedTitle('Title\nExplanation'), /exactly one line/);
});

test('rejects too-long model output', () =>
{
  assert.throws(() => sanitizeGeneratedTitle('a'.repeat(101)), /longer than 100/);
});

test('content priority is page Markdown, then matching llms content, then cleaned page text', () =>
{
  assert.equal(selectPageContent({ pageMarkdown: 'page', matchedLlmsMarkdown: 'llms', cleanedPage: 'dom' }).source, 'page-markdown');
  assert.equal(selectPageContent({ matchedLlmsMarkdown: 'llms', cleanedPage: 'dom' }).source, 'llms-txt');
  assert.equal(selectPageContent({ cleanedPage: 'dom' }).source, 'cleaned-page');
  assert.equal(selectPageContent({ llmsSummary: 'site' }).source, 'metadata-only');
});

test('llms.txt candidates go from the specific directory up to the site root', () =>
{
  assert.deepEqual(
    buildLlmsTxtCandidates('https://example.com/docs/guides/page.html?x=1'),
    [
      'https://example.com/docs/guides/llms.txt',
      'https://example.com/docs/llms.txt',
      'https://example.com/llms.txt',
    ]
  );
});

test('a token query in the page URL does not affect llms.txt path discovery', () =>
{
  assert.deepEqual(
    buildLlmsTxtCandidates('https://example.com/docs/page?access_token=page-state'),
    [
      'https://example.com/docs/page/llms.txt',
      'https://example.com/docs/llms.txt',
      'https://example.com/llms.txt',
    ]
  );
});
