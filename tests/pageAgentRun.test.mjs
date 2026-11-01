import assert from 'node:assert/strict';
import test from 'node:test';

import { PageAgentRun } from '../src/services/pageAgent/pageAgentRun.ts';
import { PAGE_AGENT_MAX_ROUNDS } from '../src/services/pageAgent/pageAgentTools.ts';

const TAB_A = 11;
const TAB_B = 22;

let callCounter = 0;

function call(name, args = {})
{
  callCounter++;
  return { id: `call_${callCounter}`, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

function respond(...calls)
{
  return { role: 'assistant', content: null, tool_calls: calls };
}

function answer(text)
{
  return { role: 'assistant', content: text };
}

const setConditions = (...ids) => call('set_conditions', {
  conditions: ids.map(id => ({ id, text: `condition ${id}` })),
});

/** Answers with the scripted messages in order; a function entry gets the request. */
class ScriptedClient
{
  constructor(responses)
  {
    this.responses = responses;
    this.requests = [];
  }

  async complete(request)
  {
    this.requests.push(request);
    const next = this.responses.shift();
    if (next === undefined)
    {
      throw new Error('no scripted response left');
    }
    return typeof next === 'function' ? next(request) : next;
  }

  toolResults(requestIndex)
  {
    return this.requests[requestIndex].messages.filter(message => message.role === 'tool');
  }
}

/** Records the tab id of every call. Only the active tab can be captured, as in Chrome. */
class FakePage
{
  constructor(activeTabId)
  {
    this.activeTabId = activeTabId;
    this.calls = [];
    this.inserted = [];
    this.removed = [];
  }

  async outline(tabId)
  {
    this.calls.push({ method: 'outline', tabId });
    return '{"viewport":{"width":1280,"height":800},"outline":[]}';
  }

  async inspect(tabId, selectors)
  {
    this.calls.push({ method: 'inspect', tabId });
    return JSON.stringify(selectors.map(selector => ({ selector, count: 1 })));
  }

  async insertCss(tabId, text)
  {
    this.calls.push({ method: 'insertCss', tabId });
    this.inserted.push(text);
  }

  async removeCss(tabId, text)
  {
    this.calls.push({ method: 'removeCss', tabId });
    this.removed.push(text);
  }

  async capture(tabId)
  {
    this.calls.push({ method: 'capture', tabId });
    return tabId === this.activeTabId
      ? { dataUrl: 'data:image/jpeg;base64,AAAA' }
      : { unavailable: 'not visible, use inspect' };
  }

  async pageUrl(tabId)
  {
    this.calls.push({ method: 'pageUrl', tabId });
    return 'https://site.test/videos/1';
  }
}

class RecordingListener
{
  constructor()
  {
    this.steps = [];
    this.conditions = [];
    this.applied = [];
    this.finished = [];
  }

  onStep(step)
  {
    this.steps.push(step);
  }

  onConditions(conditions, replaced)
  {
    this.conditions.push({ conditions, replaced });
  }

  onCssApplied(applied)
  {
    this.applied.push(applied);
  }

  onFinished(result)
  {
    this.finished.push(result);
  }
}

function startRun(client, page, options = {})
{
  const listener = new RecordingListener();
  let nextId = 0;
  const run = new PageAgentRun({
    tabId: TAB_A,
    request: 'make the video player full width',
    client,
    adapter: page,
    listener,
    screenshots: false,
    createId: () => `applied-${++nextId}`,
    ...options,
  });
  return { run, listener };
}

test('a run started on tab A sends every page call to tab A after the user switches to tab B', async () =>
{
  const page = new FakePage(TAB_A);
  const client = new ScriptedClient([
    respond(call('get_page_outline'), call('screenshot')),
    () =>
    {
      page.activeTabId = TAB_B;
      return respond(
        setConditions('c1'),
        call('apply_css', { css: 'iframe { width: 100% !important; }' }),
        call('inspect', { selectors: ['iframe'] }),
      );
    },
    respond(
      call('apply_css', { css: 'iframe { width: 100% !important; } main { max-width: none !important; }' }),
      call('screenshot'),
      call('get_page_outline'),
      call('inspect', { selectors: ['iframe', 'main'] }),
    ),
    respond(call('report', { results: [{ id: 'c1', met: true, measured: 'iframe 1738px, main 1740px' }], summary: 'done' })),
  ]);
  const { run } = startRun(client, page, { screenshots: true, insertedText: 'old stylesheet' });

  const result = await run.run();

  assert.equal(result.status, 'met');
  const callsAfterSwitch = page.calls.slice(page.calls.findIndex(entry => entry.method === 'pageUrl'));
  assert.ok(callsAfterSwitch.length >= 8, 'the run kept calling the page after the switch');
  assert.deepEqual(
    [...new Set(page.calls.map(entry => entry.method))].sort(),
    ['capture', 'insertCss', 'inspect', 'outline', 'pageUrl', 'removeCss'],
  );
  assert.deepEqual(page.calls.filter(entry => entry.tabId !== TAB_A), []);
  assert.deepEqual(page.removed, ['old stylesheet', page.inserted[0]]);
});

test('report with every condition met ends the run as met', async () =>
{
  const page = new FakePage(TAB_A);
  const client = new ScriptedClient([
    respond(
      setConditions('c1', 'c2'),
      call('apply_css', { css: 'iframe { width: 100% !important; }' }),
      call('inspect', { selectors: ['iframe'] }),
    ),
    respond(call('report', {
      results: [{ id: 'c1', met: true, measured: '1738px' }, { id: 'c2', met: true, measured: '16:9' }],
      summary: 'Player fills the content area.',
    })),
  ]);
  const { run, listener } = startRun(client, page);

  const result = await run.run();

  assert.equal(result.status, 'met');
  assert.deepEqual(result.conditions.map(condition => condition.met), [true, true]);
  assert.equal(result.summary, 'Player fills the content area.');
  assert.deepEqual(listener.finished, [result]);
});

test('a report with an unmet condition or one left out ends as not-met', async () =>
{
  const page = new FakePage(TAB_A);
  const client = new ScriptedClient([
    respond(
      setConditions('c1', 'c2', 'c3'),
      call('apply_css', { css: 'iframe { width: 100% !important; }' }),
      call('inspect', { selectors: ['iframe'] }),
    ),
    respond(call('report', {
      results: [{ id: 'c1', met: true, measured: '1738px' }, { id: 'c2', met: false, measured: '16:10' }],
      summary: 'Wider, ratio off.',
    })),
  ]);
  const { run } = startRun(client, page);

  const result = await run.run();

  assert.equal(result.status, 'not-met');
  assert.deepEqual(
    result.conditions.map(condition => [condition.id, condition.met, condition.measured]),
    [['c1', true, '1738px'], ['c2', false, '16:10'], ['c3', false, 'not reported']],
  );
});

test('a report when every reported condition is met but one was left out is not-met', async () =>
{
  const page = new FakePage(TAB_A);
  const client = new ScriptedClient([
    respond(setConditions('c1', 'c2')),
    respond(call('report', { results: [{ id: 'c1', met: true, measured: '1738px' }], summary: 'done' })),
  ]);
  const { run } = startRun(client, page);

  const result = await run.run();

  assert.equal(result.status, 'not-met');
  assert.deepEqual(result.conditions.find(condition => condition.id === 'c2').met, false);
});

test('a report with no conditions set in the run ends as not-met', async () =>
{
  const page = new FakePage(TAB_A);
  const client = new ScriptedClient([
    respond(call('get_page_outline')),
    respond(call('report', { results: [], summary: 'Looks fine.' })),
  ]);
  const { run } = startRun(client, page);

  const result = await run.run();

  assert.equal(result.status, 'not-met');
  assert.deepEqual(result.conditions, []);
  assert.match(result.summary, /no conditions/i);
});

test('the run ends at the step limit as not-met with the conditions unmet', async () =>
{
  const page = new FakePage(TAB_A);
  const client = new ScriptedClient([respond(setConditions('c1'))]);
  for (let round = 1; round < PAGE_AGENT_MAX_ROUNDS + 5; round++)
  {
    client.responses.push(respond(call('inspect', { selectors: ['iframe'] })));
  }
  const { run } = startRun(client, page);

  const result = await run.run();

  assert.equal(client.requests.length, PAGE_AGENT_MAX_ROUNDS);
  assert.equal(result.status, 'not-met');
  assert.deepEqual(result.conditions, [{ id: 'c1', text: 'condition c1', met: false, measured: 'no report' }]);
});

test('an answer without tool calls ends as not-met with its text as the summary', async () =>
{
  const page = new FakePage(TAB_A);
  const client = new ScriptedClient([
    respond(call('get_page_outline')),
    answer('Which player do you mean, the main video or the preview?'),
  ]);
  const { run } = startRun(client, page);

  const result = await run.run();

  assert.equal(result.status, 'not-met');
  assert.equal(result.summary, 'Which player do you mean, the main video or the preview?');
});

test('apply_css before set_conditions is refused and nothing is inserted', async () =>
{
  const page = new FakePage(TAB_A);
  const client = new ScriptedClient([
    respond(call('apply_css', { css: 'iframe { width: 100% !important; }' })),
    answer('I stop here.'),
  ]);
  const { run, listener } = startRun(client, page, { insertedText: 'earlier stylesheet' });

  await run.run();

  const [toolResult] = client.toolResults(1);
  assert.match(toolResult.content, /set_conditions first/);
  assert.deepEqual(page.inserted, []);
  assert.deepEqual(page.removed, []);
  assert.deepEqual(listener.applied, []);
});

test('a stylesheet the sanitizer rejects goes back to the model and nothing is inserted', async () =>
{
  const page = new FakePage(TAB_A);
  const client = new ScriptedClient([
    respond(
      setConditions('c1'),
      call('apply_css', { css: 'input[value^="a"] { background: url(https://evil.test/a) !important; }' }),
    ),
    answer('I stop here.'),
  ]);
  const { run, listener } = startRun(client, page, { insertedText: 'earlier stylesheet' });

  await run.run();

  const toolResults = client.toolResults(1);
  assert.equal(toolResults.length, 2);
  assert.match(toolResults[1].content, /rejected: url\(\)/);
  assert.deepEqual(page.inserted, []);
  assert.deepEqual(page.removed, []);
  assert.deepEqual(listener.applied, []);
});

test('a second set_conditions in the run is refused, so the report is checked against the first list', async () =>
{
  const page = new FakePage(TAB_A);
  const client = new ScriptedClient([
    // An invalid call sets nothing, so the next valid one still counts.
    respond(call('set_conditions', { conditions: [] })),
    respond(
      setConditions('c1', 'c2'),
      call('apply_css', { css: 'iframe { width: 100% !important; }' }),
      call('inspect', { selectors: ['iframe'] }),
    ),
    respond(setConditions('c1')),
    respond(call('report', { results: [{ id: 'c1', met: true, measured: '1738px' }], summary: 'done' })),
  ]);
  const { run, listener } = startRun(client, page);

  const result = await run.run();

  assert.match(client.toolResults(3).at(-1).content, /^refused/);
  assert.equal(result.status, 'not-met');
  assert.deepEqual(result.conditions.map(condition => [condition.id, condition.met]), [['c1', true], ['c2', false]]);
  assert.deepEqual(listener.conditions.map(entry => entry.conditions.map(condition => condition.id)), [['c1', 'c2']]);
});

test('a report is refused until the model has seen inspect numbers taken after its last apply_css', async () =>
{
  const page = new FakePage(TAB_A);
  const report = () => call('report', { results: [{ id: 'c1', met: true, measured: '1738px' }], summary: 'done' });
  const client = new ScriptedClient([
    // In the same response as apply_css and inspect: written before any numbers came back.
    respond(
      setConditions('c1'),
      call('apply_css', { css: 'iframe { width: 100% !important; }' }),
      call('inspect', { selectors: ['iframe'] }),
      report(),
    ),
    // A new apply_css makes the earlier inspect stale.
    respond(call('apply_css', { css: 'iframe { width: 99% !important; }' })),
    respond(report()),
    // The inspect's numbers come back only with the next request.
    respond(call('inspect', { selectors: ['iframe'] }), report()),
    respond(report()),
  ]);
  const { run, listener } = startRun(client, page);

  const result = await run.run();

  assert.equal(result.status, 'met');
  assert.equal(client.requests.length, 5);
  assert.deepEqual(
    listener.steps.filter(entry => entry.tool === 'report').map(entry => entry.result.startsWith('refused')),
    [true, true, true, false],
  );
});
