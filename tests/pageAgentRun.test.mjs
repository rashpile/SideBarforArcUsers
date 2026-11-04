import assert from 'node:assert/strict';
import test from 'node:test';

import { PageAgentRun } from '../src/services/pageAgent/pageAgentRun.ts';
import { PAGE_AGENT_MAX_ROUNDS } from '../src/services/pageAgent/pageAgentTools.ts';
import { withMarker } from '../src/utils/pageAgentCss.ts';

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
    this.popups = [];
    this.userScripts = [];
    this.url = 'https://site.test/videos/1';
    /** Results runUserScript answers with in order; then a script that ran and returned nothing. */
    this.scriptResults = [];
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

  async readText(tabId)
  {
    this.calls.push({ method: 'readText', tabId });
    return JSON.stringify({ url: 'https://site.test/article', title: 'Article', text: 'The article text.' });
  }

  async showPopup(tabId, title, answer)
  {
    this.calls.push({ method: 'showPopup', tabId });
    this.popups.push({ tabId, title, answer });
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
    return this.url;
  }

  async runUserScript(tabId, command)
  {
    this.calls.push({ method: 'runUserScript', tabId });
    this.userScripts.push(command);
    return this.scriptResults.shift() ?? { ok: true, compiled: true, value: 'undefined', errors: [] };
  }
}

const PLUGIN_TOOL = 'read_video_transcript';
const PLUGIN_SECTION = 'Questions about a video: call read_video_transcript.';

/** Records the tool, arguments and tab of every call; each call answers with the next scripted outcome. */
class FakePlugin
{
  constructor(outcomes)
  {
    this.id = 'video-transcripts';
    this.outcomes = outcomes;
    this.calls = [];
  }

  tools()
  {
    return [{
      type: 'function',
      function: { name: PLUGIN_TOOL, description: 'Read the subtitles.', parameters: { type: 'object', properties: {} } },
    }];
  }

  promptSection()
  {
    return PLUGIN_SECTION;
  }

  async call(tool, args, tabId)
  {
    this.calls.push({ tool, args, tabId });
    const next = this.outcomes.shift();
    return typeof next === 'function' ? next() : next;
  }
}

class RecordingListener
{
  /** `approve`: the user's answer to a script, or a function that returns the promise of one. */
  constructor(approve)
  {
    this.approve = approve;
    this.steps = [];
    this.conditions = [];
    this.applied = [];
    this.approvals = [];
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

  onApplied(applied)
  {
    this.applied.push(applied);
  }

  async onScriptApproval(request)
  {
    this.approvals.push(request);
    return typeof this.approve === 'function' ? await this.approve(request) : this.approve;
  }

  onFinished(result)
  {
    this.finished.push(result);
  }
}

function startRun(client, page, options = {})
{
  const { approve = true, ...runOptions } = options;
  const listener = new RecordingListener(approve);
  let nextId = 0;
  const run = new PageAgentRun({
    tabId: TAB_A,
    request: 'make the video player full width',
    client,
    adapter: page,
    listener,
    screenshots: false,
    scripts: false,
    createId: () => `applied-${++nextId}`,
    ...runOptions,
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

test('a report with no conditions set in the run ends as answered with its summary', async () =>
{
  const page = new FakePage(TAB_A);
  const client = new ScriptedClient([
    respond(call('get_page_outline')),
    respond(call('report', { results: [], summary: 'The page is a product list.' })),
  ]);
  const { run } = startRun(client, page);

  const result = await run.run();

  assert.equal(result.status, 'answered');
  assert.deepEqual(result.conditions, []);
  assert.equal(result.summary, 'The page is a product list.');
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

  // One request past the limit, which may only call report; this model answers with inspect anyway.
  assert.equal(client.requests.length, PAGE_AGENT_MAX_ROUNDS + 1);
  const finalRequest = client.requests[PAGE_AGENT_MAX_ROUNDS];
  assert.equal(finalRequest.toolChoice, 'report');
  assert.deepEqual(finalRequest.tools.map(tool => tool.function.name), ['report']);
  assert.equal(result.status, 'not-met');
  assert.deepEqual(result.conditions, [{ id: 'c1', text: 'condition c1', met: false, measured: 'no report' }]);
});

test('at the step limit the forced final report counts when the CSS was measured after its last change', async () =>
{
  const page = new FakePage(TAB_A);
  const client = new ScriptedClient([
    respond(setConditions('c1')),
    respond(call('apply_css', { css: 'iframe { width: 100% !important; }' })),
  ]);
  while (client.responses.length < PAGE_AGENT_MAX_ROUNDS)
  {
    client.responses.push(respond(call('inspect', { selectors: ['iframe'] })));
  }
  client.responses.push(respond(call('report', { results: [{ id: 'c1', met: true, measured: '1738px' }], summary: 'done' })));
  const { run } = startRun(client, page);

  const result = await run.run();

  assert.equal(result.status, 'met');
  assert.deepEqual(result.conditions, [{ id: 'c1', text: 'condition c1', met: true, measured: '1738px' }]);
});

test('at the step limit a final report is not met when no inspect followed the last apply_css', async () =>
{
  const page = new FakePage(TAB_A);
  const client = new ScriptedClient([respond(setConditions('c1'))]);
  while (client.responses.length < PAGE_AGENT_MAX_ROUNDS)
  {
    client.responses.push(respond(call('apply_css', { css: `iframe { width: ${client.responses.length}px !important; }` })));
  }
  client.responses.push(respond(call('report', { results: [{ id: 'c1', met: true, measured: 'guessed' }], summary: 'done' })));
  const { run } = startRun(client, page);

  const result = await run.run();

  assert.equal(result.status, 'not-met');
  assert.deepEqual(result.conditions, [
    { id: 'c1', text: 'condition c1', met: false, measured: 'not measured after the last CSS change' },
  ]);
});

test('a failed final report request ends the run as not-met, not as an error', async () =>
{
  const page = new FakePage(TAB_A);
  const client = new ScriptedClient([respond(setConditions('c1'))]);
  while (client.responses.length < PAGE_AGENT_MAX_ROUNDS)
  {
    client.responses.push(respond(call('inspect', { selectors: ['iframe'] })));
  }
  const { run } = startRun(client, page);

  const result = await run.run();

  assert.equal(client.requests.length, PAGE_AGENT_MAX_ROUNDS + 1);
  assert.equal(result.status, 'not-met');
  assert.equal(result.error, undefined);
});

test('a text reply with no set_conditions ends as answered with the text', async () =>
{
  const page = new FakePage(TAB_A);
  const client = new ScriptedClient([
    respond(call('read_page_text')),
    answer('## Summary\n\nThe article is about **video players**.'),
  ]);
  const { run } = startRun(client, page, { request: 'summary page' });

  const result = await run.run();

  assert.equal(result.status, 'answered');
  assert.equal(result.summary, '## Summary\n\nThe article is about **video players**.');
  assert.equal(result.openedPopup, undefined);
  assert.deepEqual(page.popups, []);
});

test('a text reply after set_conditions without a report ends as not-met', async () =>
{
  const page = new FakePage(TAB_A);
  const client = new ScriptedClient([
    respond(setConditions('c1')),
    answer('I made the player wider.'),
  ]);
  const { run } = startRun(client, page);

  const result = await run.run();

  assert.equal(result.status, 'not-met');
  assert.deepEqual(result.conditions, [{ id: 'c1', text: 'condition c1', met: false, measured: 'no report' }]);
});

test('a question run started on tab A reads the text and shows the popup on tab A after the user switches to tab B', async () =>
{
  const page = new FakePage(TAB_A);
  const markdown = '- point one\n- point two';
  const client = new ScriptedClient([
    respond(call('read_page_text')),
    () =>
    {
      page.activeTabId = TAB_B;
      return respond(call('show_popup', { title: 'Summary', markdown }));
    },
  ]);
  const { run, listener } = startRun(client, page, { request: 'show a summary in a popup' });

  const result = await run.run();

  assert.deepEqual(page.calls, [{ method: 'readText', tabId: TAB_A }, { method: 'showPopup', tabId: TAB_A }]);
  assert.deepEqual(page.popups, [{
    tabId: TAB_A,
    title: 'Summary',
    answer: { question: 'show a summary in a popup', markdown },
  }]);
  assert.equal(result.status, 'answered');
  assert.equal(result.summary, markdown);
  assert.equal(result.openedPopup, true);
  assert.deepEqual(listener.finished, [result]);
});

test('a show_popup the page rejects still ends as answered with the markdown, without openedPopup', async () =>
{
  const page = new FakePage(TAB_A);
  page.showPopup = async () =>
  {
    throw new Error('Cannot access contents of the page');
  };
  const markdown = '## Summary\n\nThe article is about **video players**.';
  const client = new ScriptedClient([respond(call('show_popup', { title: 'Summary', markdown }))]);
  const { run, listener } = startRun(client, page, { request: 'show a summary in a popup' });

  const result = await run.run();

  assert.equal(result.status, 'answered');
  assert.equal(result.summary, markdown);
  assert.equal(result.error, undefined);
  assert.equal(result.openedPopup, undefined);
  assert.equal(client.requests.length, 1);
  assert.equal(listener.steps.at(-1).result, 'failed: Cannot access contents of the page');
});

test('show_popup after set_conditions is refused and nothing is shown', async () =>
{
  const page = new FakePage(TAB_A);
  const client = new ScriptedClient([
    respond(setConditions('c1'), call('show_popup', { title: 'Done', markdown: 'The player is wider.' })),
    answer('I stop here.'),
  ]);
  const { run } = startRun(client, page);

  const result = await run.run();

  assert.match(client.toolResults(1).at(-1).content, /^refused/);
  assert.deepEqual(page.popups, []);
  assert.equal(result.status, 'not-met');
  assert.equal(result.openedPopup, undefined);
});

test('a follow-up run gets the full text of an earlier answer in its first user message', async () =>
{
  const page = new FakePage(TAB_A);
  const earlierAnswer = `## Summary\n\n${'The article explains how players scale. '.repeat(40)}\n\n- one\n- two`;
  const client = new ScriptedClient([answer('It means the player keeps its ratio.')]);
  const { run } = startRun(client, page, {
    request: 'explain aspect ratio',
    history: [{ request: 'summary page', status: 'answered', conditions: [], replaced: [], summary: earlierAnswer }],
  });

  await run.run();

  const firstUserMessage = client.requests[0].messages.find(message => message.role === 'user').content;
  assert.ok(firstUserMessage.includes(`Answer: ${earlierAnswer}`));
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

test('apply_css in a CSS-only run inserts withMarker(css, id) in place of the earlier sheet', async () =>
{
  const page = new FakePage(TAB_A);
  const css = 'iframe { width: 100% !important; }';
  const client = new ScriptedClient([
    respond(setConditions('c1'), call('apply_css', { css })),
    answer('I stop here.'),
  ]);
  const { run, listener } = startRun(client, page, { currentCss: 'main { color: red; }', insertedText: 'earlier stylesheet' });

  await run.run();

  assert.deepEqual(page.removed, ['earlier stylesheet']);
  assert.deepEqual(page.inserted, [withMarker(css, 'applied-1')]);
  assert.deepEqual(listener.applied, [{
    css,
    script: '',
    insertedText: withMarker(css, 'applied-1'),
    appliedId: 'applied-1',
    url: 'https://site.test/videos/1',
    cssByUser: false,
  }]);
});

test('apply_css after a run started with a script keeps the script in the applied set and leaves it running', async () =>
{
  const page = new FakePage(TAB_A);
  const script = 'agent.on(document, "keydown", event => console.log(event.key));';
  const client = new ScriptedClient([
    respond(
      setConditions('c1'),
      call('apply_css', { css: 'iframe { width: 100% !important; }' }),
      call('apply_css', { css: 'iframe { width: 90% !important; }' }),
    ),
    answer('I stop here.'),
  ]);
  const { run, listener } = startRun(client, page, {
    currentCss: '',
    currentScript: script,
    insertedText: withMarker('', 'saved-id'),
  });

  await run.run();

  assert.deepEqual(listener.applied.map(applied => [applied.appliedId, applied.script]), [
    ['applied-1', script],
    ['applied-2', script],
  ]);
  assert.deepEqual(page.removed, [withMarker('', 'saved-id'), withMarker('iframe { width: 100% !important; }', 'applied-1')]);
  assert.deepEqual(page.userScripts, [], 'a CSS change neither undoes nor re-runs the script');
});

test('the user\'s CSS keeps its flag through an apply_script and loses it with the agent\'s apply_css', async () =>
{
  const page = new FakePage(TAB_A);
  const userCss = '@import url("https://fonts.test/inter.css"); body { font-family: var(--font, Inter); }';
  const agentCss = 'main { color: red !important; }';
  const script = 'agent.on(document, "keydown", () => undefined);';
  const client = new ScriptedClient([
    respond(
      setConditions('c1'),
      call('apply_script', { code: script }),
      call('apply_css', { css: agentCss }),
      call('apply_script', { code: `${script}\nagent.onUndo(() => undefined);` }),
    ),
    answer('I stop here.'),
  ]);
  const { run, listener } = startRun(client, page, {
    scripts: true,
    currentCss: userCss,
    currentCssByUser: true,
    insertedText: withMarker(userCss, 'user-id'),
  });

  await run.run();

  assert.deepEqual(listener.applied.map(applied => [applied.css, applied.cssByUser]), [
    [userCss, true],
    [agentCss, false],
    [agentCss, false],
  ]);
});

test('the first message says the current stylesheet was written by the user only when it was', async () =>
{
  const css = 'body { background: url("https://images.test/bg.png"); }';
  const firstMessage = async cssByUser =>
  {
    const client = new ScriptedClient([answer('ok')]);
    const { run } = startRun(client, new FakePage(TAB_A), { currentCss: css, currentCssByUser: cssByUser });
    await run.run();
    return client.requests[0].messages.find(message => message.role === 'user').content;
  };

  const byUser = await firstMessage(true);
  const byAgent = await firstMessage(false);

  assert.match(byUser, /Current stylesheet \(written by the user; .*apply_css refuses/);
  assert.ok(byUser.includes(css));
  assert.doesNotMatch(byAgent, /written by the user/);
  assert.ok(byAgent.includes(css));
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

test('the agent\'s apply_css is sanitized even when the run starts on CSS the user wrote', async () =>
{
  const page = new FakePage(TAB_A);
  const userCss = 'body { background: url("https://images.test/bg.png"); }';
  const userText = withMarker(userCss, 'user-id');
  const client = new ScriptedClient([
    respond(
      setConditions('c1'),
      call('apply_css', { css: `${userCss}\ninput[value^="a"] { background: url(https://evil.test/a) !important; }` }),
    ),
    answer('I stop here.'),
  ]);
  const { run, listener } = startRun(client, page, { currentCss: userCss, currentCssByUser: true, insertedText: userText });

  await run.run();

  assert.match(client.toolResults(1)[1].content, /rejected: url\(\)/);
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

test('a plugin tool is offered and its call gets the run tab after the user switches to tab B', async () =>
{
  const page = new FakePage(TAB_A);
  const plugin = new FakePlugin([
    { ok: true, content: '{"source":"prime-video","text":"[0:07] Hello."}', summary: 'prime-video, en-gb, 0:00–1:41, 14 characters' },
  ]);
  const client = new ScriptedClient([
    () =>
    {
      page.activeTabId = TAB_B;
      return respond(call(PLUGIN_TOOL, { language: 'en' }));
    },
    answer('Someone says hello.'),
  ]);
  const { run, listener } = startRun(client, page, { request: 'summarize this episode', plugins: [plugin] });

  const result = await run.run();

  const offered = client.requests[0].tools.map(tool => tool.function.name);
  assert.equal(offered.at(-1), PLUGIN_TOOL);
  assert.ok(offered.includes('read_page_text'));
  assert.ok(client.requests[0].messages[0].content.endsWith(`\n\n${PLUGIN_SECTION}`));
  assert.deepEqual(plugin.calls, [{ tool: PLUGIN_TOOL, args: { language: 'en' }, tabId: TAB_A }]);
  assert.equal(client.toolResults(1)[0].content, '{"source":"prime-video","text":"[0:07] Hello."}');
  assert.deepEqual(listener.steps, [{
    tool: PLUGIN_TOOL,
    args: '{"language":"en"}',
    result: 'prime-video, en-gb, 0:00–1:41, 14 characters',
  }]);
  assert.equal(result.status, 'answered');
});

test('without the plugin its tool is not offered and a call to it is an unknown tool', async () =>
{
  const page = new FakePage(TAB_A);
  const client = new ScriptedClient([respond(call(PLUGIN_TOOL)), answer('I cannot read videos.')]);
  const { run } = startRun(client, page, { request: 'summarize this episode' });

  const result = await run.run();

  assert.ok(!client.requests[0].tools.some(tool => tool.function.name === PLUGIN_TOOL));
  assert.ok(!client.requests[0].messages[0].content.includes(PLUGIN_SECTION));
  assert.equal(client.toolResults(1)[0].content, `unknown tool "${PLUGIN_TOOL}"`);
  assert.deepEqual(page.calls, []);
  assert.equal(result.status, 'answered');
});

test('a plugin that throws or answers ok: false gives the model a tool error and the run goes on', async () =>
{
  const page = new FakePage(TAB_A);
  const plugin = new FakePlugin([
    () =>
    {
      throw new Error('Cannot access contents of the page');
    },
    { ok: false, error: 'invalid arguments: to must be "end", seconds or h:mm:ss' },
  ]);
  const client = new ScriptedClient([
    respond(call(PLUGIN_TOOL)),
    respond(call(PLUGIN_TOOL, { to: 'later' })),
    answer('I could not read the subtitles.'),
  ]);
  const { run, listener } = startRun(client, page, { request: 'summarize this episode', plugins: [plugin] });

  const result = await run.run();

  assert.equal(client.requests.length, 3);
  assert.equal(client.toolResults(1)[0].content, 'Cannot access contents of the page');
  assert.equal(client.toolResults(2)[1].content, 'invalid arguments: to must be "end", seconds or h:mm:ss');
  assert.deepEqual(listener.steps.map(entry => entry.result), [
    'Cannot access contents of the page',
    'invalid arguments: to must be "end", seconds or h:mm:ss',
  ]);
  assert.equal(result.status, 'answered');
  assert.equal(result.error, undefined);
  assert.equal(result.summary, 'I could not read the subtitles.');
});

test('Stop during a plugin call that never settles ends the run as stopped', async () =>
{
  const page = new FakePage(TAB_A);
  let called;
  const pluginCalled = new Promise(resolve =>
  {
    called = resolve;
  });
  // A subtitle download that stalls: the page script never answers.
  const plugin = new FakePlugin([
    () =>
    {
      called();
      return new Promise(() => undefined);
    },
  ]);
  const client = new ScriptedClient([respond(call(PLUGIN_TOOL))]);
  const { run, listener } = startRun(client, page, { request: 'summarize this episode', plugins: [plugin] });

  const finished = run.run();
  await pluginCalled;
  run.stop();
  const result = await finished;

  assert.equal(result.status, 'stopped');
  assert.equal(client.requests.length, 1);
  assert.deepEqual(listener.finished, [result]);
});

const SCRIPTS_OFF = 'refused: scripts are off; change the page with CSS';
const DECLINED = /^refused: the user declined to run scripts/;

test('with scripts off, apply_script and run_check are refused and reach neither the page nor the approval listener', async () =>
{
  const page = new FakePage(TAB_A);
  const client = new ScriptedClient([
    respond(
      setConditions('c1'),
      call('apply_script', { code: 'agent.on(document, "keydown", () => undefined);' }),
      call('run_check', { code: 'return document.title;' }),
    ),
    answer('I stop here.'),
  ]);
  const { run, listener } = startRun(client, page, { currentScript: 'agent.onUndo(() => undefined);' });

  await run.run();

  const offered = client.requests[0].tools.map(tool => tool.function.name);
  assert.ok(!offered.includes('apply_script') && !offered.includes('run_check'));
  assert.deepEqual(client.toolResults(1).slice(1).map(message => message.content), [SCRIPTS_OFF, SCRIPTS_OFF]);
  assert.deepEqual(page.calls, []);
  assert.deepEqual(listener.approvals, []);
  assert.deepEqual(listener.applied, []);
});

test('apply_script before set_conditions is refused before the approval and the page', async () =>
{
  const page = new FakePage(TAB_A);
  const client = new ScriptedClient([
    respond(call('apply_script', { code: 'agent.on(document, "keydown", () => undefined);' })),
    answer('I stop here.'),
  ]);
  const { run, listener } = startRun(client, page, { scripts: true });

  await run.run();

  assert.match(client.toolResults(1)[0].content, /set_conditions first/);
  assert.deepEqual(page.calls, []);
  assert.deepEqual(listener.approvals, []);
  assert.deepEqual(listener.applied, []);
});

test('the user approves the first script of a run once, and every script runs on the run tab with a new applied id', async () =>
{
  const page = new FakePage(TAB_A);
  const css = 'main { color: red !important; }';
  const first = 'agent.on(document, "keydown", () => undefined);';
  const second = `${first}\nagent.on(document, "keyup", () => undefined);`;
  const client = new ScriptedClient([
    respond(setConditions('c1'), call('apply_script', { code: first }), call('run_check', { code: 'return 1;' })),
    () =>
    {
      page.activeTabId = TAB_B;
      return respond(call('apply_script', { code: second }), call('run_check', { code: 'return 2;' }));
    },
    respond(call('report', { results: [{ id: 'c1', met: true, measured: '2' }], summary: 'done' })),
  ]);
  const { run, listener } = startRun(client, page, {
    scripts: true,
    currentCss: css,
    insertedText: withMarker(css, 'saved-id'),
  });

  const result = await run.run();

  assert.equal(result.status, 'met');
  assert.deepEqual(listener.approvals, [{ kind: 'apply', code: first, origin: 'https://site.test' }]);
  assert.deepEqual(page.userScripts, [
    { kind: 'apply', code: first },
    { kind: 'check', code: 'return 1;' },
    { kind: 'apply', code: second },
    { kind: 'check', code: 'return 2;' },
  ]);
  assert.deepEqual(page.calls.filter(entry => entry.tabId !== TAB_A), []);
  assert.deepEqual(listener.applied.map(applied => [applied.appliedId, applied.css, applied.script]), [
    ['applied-1', css, first],
    ['applied-2', css, second],
  ]);
  assert.deepEqual(page.inserted, [withMarker(css, 'applied-1'), withMarker(css, 'applied-2')]);
  assert.deepEqual(page.removed, [withMarker(css, 'saved-id'), withMarker(css, 'applied-1')]);
});

test('scripts allowed on one site are refused without asking once the tab is on another site, also when it moved while the card waited', async () =>
{
  const cases = [
    ['a script navigated the tab', page => ({ before: undefined, after: () => { page.url = 'https://mail.test/inbox'; } })],
    ['the tab moved while the card waited', page => ({ before: () => { page.url = 'https://mail.test/inbox'; }, after: undefined })],
  ];
  for (const [label, moves] of cases)
  {
    const page = new FakePage(TAB_A);
    const { before, after } = moves(page);
    const first = 'agent.on(document, "keydown", () => undefined);';
    const client = new ScriptedClient([
      respond(setConditions('c1'), call('apply_script', { code: first })),
      () =>
      {
        after?.();
        return respond(call('run_check', { code: 'return document.title;' }), call('apply_script', { code: 'agent.onUndo(() => undefined);' }));
      },
      answer('I stop here.'),
    ]);
    const { run, listener } = startRun(client, page, {
      scripts: true,
      approve: () =>
      {
        before?.();
        return true;
      },
    });

    await run.run();

    assert.deepEqual(listener.approvals, [{ kind: 'apply', code: first, origin: 'https://site.test' }], label);
    const ran = before ? [] : [{ kind: 'apply', code: first }];
    assert.deepEqual(page.userScripts, ran, label);
    const refused = client.toolResults(2).filter(message => /only on https:\/\/site\.test/.test(message.content));
    assert.equal(refused.length, before ? 3 : 2, label);
  }
});

test('on a page that is not http or https a script is refused without asking', async () =>
{
  const page = new FakePage(TAB_A);
  page.url = 'chrome://newtab/';
  const client = new ScriptedClient([
    respond(setConditions('c1'), call('apply_script', { code: 'agent.onUndo(() => undefined);' })),
    answer('I stop here.'),
  ]);
  const { run, listener } = startRun(client, page, { scripts: true });

  await run.run();

  assert.deepEqual(listener.approvals, []);
  assert.deepEqual(page.userScripts, []);
  assert.match(client.toolResults(1).at(-1).content, /^refused: scripts run only on http and https pages/);
});

test('Deny refuses every later script of the run without asking again, and none reaches the page', async () =>
{
  const page = new FakePage(TAB_A);
  const client = new ScriptedClient([
    respond(setConditions('c1'), call('apply_script', { code: 'agent.on(document, "keydown", () => undefined);' })),
    respond(call('run_check', { code: 'return 1;' }), call('apply_script', { code: 'agent.onUndo(() => undefined);' })),
    answer('I stop here.'),
  ]);
  const { run, listener } = startRun(client, page, { scripts: true, approve: false });

  await run.run();

  assert.equal(listener.approvals.length, 1);
  assert.match(client.toolResults(1).at(-1).content, DECLINED);
  assert.ok(client.toolResults(2).slice(-2).every(message => DECLINED.test(message.content)));
  assert.deepEqual(page.calls.filter(entry => entry.method !== 'pageUrl'), []);
  assert.deepEqual(listener.applied, []);
});

test('a blank apply_script removes the script and a blank run_check is refused, neither asking, so a later script is still put to the user', async () =>
{
  const page = new FakePage(TAB_A);
  const css = 'main { color: red !important; }';
  const client = new ScriptedClient([
    respond(
      setConditions('c1'),
      call('run_check', { code: ' ' }),
      call('apply_script', { code: '  \n' }),
      call('apply_script', { code: 'agent.onUndo(() => undefined);' }),
    ),
    answer('I stop here.'),
  ]);
  const { run, listener } = startRun(client, page, {
    scripts: true,
    approve: false,
    currentCss: css,
    currentScript: 'agent.on(document, "keydown", () => undefined);',
    insertedText: withMarker(css, 'saved-id'),
  });

  await run.run();

  assert.deepEqual(listener.approvals, [{ kind: 'apply', code: 'agent.onUndo(() => undefined);', origin: 'https://site.test' }]);
  assert.deepEqual(page.userScripts, [{ kind: 'undo' }], 'the old script is stopped; nothing else runs');
  assert.deepEqual(listener.applied.map(applied => [applied.appliedId, applied.css, applied.script]), [['applied-1', css, '']]);
  const results = client.toolResults(1).slice(1).map(message => message.content);
  assert.match(results[0], /^refused: the code is empty/);
  assert.match(results[1], /"ok":true/);
  assert.match(results[2], DECLINED);
});

test('Stop while the approval waits ends the run as stopped and runs no script', async () =>
{
  const page = new FakePage(TAB_A);
  let asked;
  const approvalAsked = new Promise(resolve =>
  {
    asked = resolve;
  });
  const client = new ScriptedClient([
    respond(setConditions('c1'), call('apply_script', { code: 'agent.on(document, "keydown", () => undefined);' })),
  ]);
  const { run, listener } = startRun(client, page, {
    scripts: true,
    approve: () =>
    {
      asked();
      return new Promise(() => undefined);
    },
  });

  const finished = run.run();
  await approvalAsked;
  run.stop();
  const result = await finished;

  assert.equal(result.status, 'stopped');
  assert.deepEqual(page.calls.filter(entry => entry.method !== 'pageUrl'), []);
  assert.deepEqual(listener.finished, [result]);
});

test('a report is refused until a compiled run_check in an earlier response follows the last apply_script', async () =>
{
  const page = new FakePage(TAB_A);
  const ran = { ok: true, compiled: true, value: '1', errors: [] };
  page.scriptResults = [ran, ran, ran, { ok: false, compiled: false, error: 'SyntaxError: Unexpected end of input', errors: [] }];
  const report = () => call('report', { results: [{ id: 'c1', met: true, measured: 'seeks to 12.4 s' }], summary: 'done' });
  const client = new ScriptedClient([
    // In the same response as the change and the check: written before any value came back.
    respond(
      setConditions('c1'),
      call('apply_script', { code: 'agent.on(document, "keydown", () => undefined);' }),
      call('run_check', { code: 'return 1;' }),
      report(),
    ),
    // A new script makes the earlier check stale; a check that doesn't compile, or a blank one, measures nothing.
    respond(call('apply_script', { code: 'agent.on(document, "keyup", () => undefined);' })),
    respond(call('run_check', { code: 'return (' })),
    respond(report()),
    respond(call('run_check', { code: '' })),
    respond(report()),
    respond(call('run_check', { code: 'return 1;' })),
    respond(report()),
  ]);
  const { run, listener } = startRun(client, page, { scripts: true });

  const result = await run.run();

  assert.equal(result.status, 'met');
  assert.deepEqual(
    listener.steps.filter(entry => entry.tool === 'report').map(entry => entry.result.startsWith('refused')),
    [true, true, true, false],
  );
});

test('an apply_script that does not compile keeps the applied set and id; one that compiles and fails is recorded for Undo', async () =>
{
  const page = new FakePage(TAB_A);
  const css = 'iframe { width: 100% !important; }';
  const running = 'agent.on(document, "keydown", () => undefined);';
  const stalled = 'agent.on(document, "keyup", () => undefined); await new Promise(() => undefined);';
  page.scriptResults = [
    { ok: true, compiled: true, value: 'undefined', errors: [] },
    { ok: false, compiled: false, error: 'SyntaxError: Unexpected end of input', errors: [] },
    { ok: false, compiled: true, error: 'still running after 10 s; what it registered stays, Undo removes it', errors: [] },
  ];
  const client = new ScriptedClient([
    respond(
      setConditions('c1'),
      call('apply_css', { css }),
      call('apply_script', { code: running }),
      call('apply_script', { code: 'agent.on(document, "keydown", (' }),
      call('apply_css', { css: `${css} main { color: red !important; }` }),
      call('apply_script', { code: stalled }),
    ),
    answer('I stop here.'),
  ]);
  const { run, listener } = startRun(client, page, { scripts: true });

  await run.run();

  assert.match(client.toolResults(1)[3].content, /"compiled":false/);
  assert.deepEqual(listener.applied.map(applied => [applied.appliedId, applied.script]), [
    ['applied-1', ''],
    ['applied-2', running],
    ['applied-3', running],
    ['applied-4', stalled],
  ]);
  assert.equal(page.inserted.length, 4);
  assert.deepEqual(page.removed, page.inserted.slice(0, 3));
});
