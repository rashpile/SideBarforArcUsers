import assert from 'node:assert/strict';
import test from 'node:test';

import { PageAgentChatStore } from '../src/services/pageAgent/pageAgentChatStore.ts';
import { PageAgentChats } from '../src/services/pageAgent/pageAgentChats.ts';

const TAB_A = 11;
const TAB_B = 22;
const URL_A = 'https://site.test/videos/1';
const CSS = 'iframe { width: 100% !important; }';
const SETTINGS = { model: 'test-model' };

const nextTask = () => new Promise(resolve => setTimeout(resolve, 0));

/** chrome.storage.session: values are copied, and every call answers on a later task, as over IPC. */
class FakeSessionArea
{
  constructor(initial = {})
  {
    this.items = structuredClone(initial);
  }

  async get(keys)
  {
    await nextTask();
    if (keys === null)
    {
      return structuredClone(this.items);
    }
    return keys in this.items ? { [keys]: structuredClone(this.items[keys]) } : {};
  }

  async set(values)
  {
    await nextTask();
    Object.assign(this.items, structuredClone(values));
  }

  async remove(keys)
  {
    await nextTask();
    for (const key of Array.isArray(keys) ? keys : [keys])
    {
      delete this.items[key];
    }
  }
}

/** A run whose events the test sends; run() resolves once the test finishes it. */
class FakeRun
{
  constructor(start)
  {
    this.start = start;
    this.listener = start.listener;
    this.stopped = false;
    this.done = new Promise(resolve =>
    {
      this.resolve = resolve;
    });
  }

  run()
  {
    return this.done;
  }

  stop()
  {
    this.stopped = true;
  }

  finish(result)
  {
    this.listener.onFinished(result);
    this.resolve(result);
  }
}

class FakeRunFactory
{
  constructor()
  {
    this.runs = [];
    this.create = start =>
    {
      const run = new FakeRun(start);
      this.runs.push(run);
      return run;
    };
  }

  async runFor(tabId)
  {
    for (let attempt = 0; attempt < 50; attempt++)
    {
      const run = this.runs.find(entry => entry.start.tabId === tabId);
      if (run)
      {
        return run;
      }
      await nextTask();
    }
    throw new Error(`no run started on tab ${tabId}`);
  }
}

class FakePage
{
  constructor()
  {
    this.marker = '';
    this.url = URL_A;
    this.removed = [];
    this.inserted = [];
  }

  async insertCss(tabId, text)
  {
    this.inserted.push({ tabId, text });
  }

  async removeCss(tabId, text)
  {
    this.removed.push({ tabId, text });
  }

  async readMarker()
  {
    return this.marker;
  }

  async pageUrl()
  {
    return this.url;
  }
}

function setup(initialItems = {})
{
  const area = new FakeSessionArea(initialItems);
  const store = new PageAgentChatStore(area);
  const factory = new FakeRunFactory();
  const page = new FakePage();
  let nextId = 0;
  const chats = new PageAgentChats({
    store,
    runFactory: factory.create,
    page,
    createId: () => `reapplied-${++nextId}`,
  });
  return { area, store, factory, page, chats };
}

function storedChatWithCss(tabId, overrides = {})
{
  return {
    tabId,
    turns: [{
      request: 'make the player full width',
      status: 'met',
      conditions: [{ id: 'c1', text: 'iframe fills the content area', met: true, measured: '1738px' }],
      replaced: [],
      steps: [],
      summary: 'done',
    }],
    appliedCss: CSS,
    appliedInsertedText: `${CSS}\n:root { --sidebar-page-agent: "id-1" !important; }`,
    appliedId: 'id-1',
    appliedUrl: URL_A,
    notice: 'none',
    ...overrides,
  };
}

const metResult = {
  status: 'met',
  conditions: [{ id: 'c1', text: 'iframe fills the content area', met: true, measured: '1738px' }],
  replaced: [],
  summary: 'The player fills the content area.',
};

test('a run on tab A that finishes while the drawer shows tab B saves its final status and stylesheet', async () =>
{
  const { store, factory, chats } = setup();

  const sending = chats.send(TAB_A, 'make the player full width', SETTINGS);
  const runA = await factory.runFor(TAB_A);
  await chats.get(TAB_B);
  runA.listener.onConditions([{ id: 'c1', text: 'iframe fills the content area' }], []);
  runA.listener.onCssApplied({ css: CSS, insertedText: `${CSS} /* marker */`, appliedId: 'id-1', url: URL_A });
  runA.finish(metResult);
  await sending;

  const saved = await store.load(TAB_A);
  assert.equal(saved.data.turns.length, 1);
  assert.equal(saved.data.turns[0].status, 'met');
  assert.deepEqual(saved.data.turns[0].conditions, metResult.conditions);
  assert.equal(saved.appliedCss, CSS);
  assert.equal(saved.appliedInsertedText, `${CSS} /* marker */`);
  assert.equal(saved.appliedId, 'id-1');
  assert.equal(await store.load(TAB_B), null, 'showing tab B writes nothing for B');
  assert.equal(chats.isRunning(TAB_A), false);
});

test('tabClosed during a run leaves no stored chat after the stopped run reports its last events', async () =>
{
  const { area, store, factory, chats } = setup();

  const sending = chats.send(TAB_A, 'make the player full width', SETTINGS);
  const runA = await factory.runFor(TAB_A);
  runA.listener.onConditions([{ id: 'c1', text: 'iframe fills the content area' }], []);
  runA.listener.onStep({ tool: 'get_page_outline', args: '', result: '{}' });

  const closing = chats.tabClosed(TAB_A);
  assert.equal(runA.stopped, true, 'closing the tab stops its run');
  // What a run stopped mid-insertCSS still reports.
  runA.listener.onCssApplied({ css: CSS, insertedText: CSS, appliedId: 'id-1', url: URL_A });
  runA.listener.onStep({ tool: 'apply_css', args: '35 characters', result: 'ok', css: CSS });
  runA.finish({ ...metResult, status: 'stopped', summary: 'Stopped.' });
  await Promise.all([closing, sending]);

  assert.equal(await store.load(TAB_A), null);
  assert.equal(`pageAgentChat:${TAB_A}` in area.items, false);
});

test('sweep deletes only the chats of tabs that no longer exist and leaves other keys alone', async () =>
{
  const { area, chats } = setup({
    'pageAgentChat:11': storedChatWithCss(11),
    'pageAgentChat:22': storedChatWithCss(22),
    'pageAgentChat:33': storedChatWithCss(33),
    tabAssociations_1: { 11: 'bookmark-1' },
    'browserSessionMarker:sidebar': true,
  });

  await chats.sweep([11, 33, 44]);

  assert.deepEqual(Object.keys(area.items).sort(), [
    'browserSessionMarker:sidebar',
    'pageAgentChat:11',
    'pageAgentChat:33',
    'tabAssociations_1',
  ]);
});

test('a saved chat is stored without the screenshot image', async () =>
{
  const { area, store, factory, chats } = setup();
  const image = 'data:image/jpeg;base64,/9j/AAAA';

  const sending = chats.send(TAB_A, 'make the player full width', SETTINGS);
  const runA = await factory.runFor(TAB_A);
  runA.listener.onStep({ tool: 'screenshot', args: '', result: 'attached', screenshotDataUrl: image });
  runA.finish(metResult);
  await sending;
  await store.load(TAB_A);

  const stored = area.items[`pageAgentChat:${TAB_A}`];
  assert.equal(JSON.stringify(stored).includes('data:image'), false);
  assert.deepEqual(stored.turns[0].steps, [{ tool: 'screenshot', args: '', result: 'attached' }]);
  assert.equal(chats.peek(TAB_A).data.turns[0].steps[0].screenshotDataUrl, image, 'the open panel keeps it');
});

test('checkMarker clears the notice when the page still has the applied stylesheet', async () =>
{
  const { store, page, chats } = setup({ [`pageAgentChat:${TAB_A}`]: storedChatWithCss(TAB_A, { notice: 'reloaded' }) });
  await chats.get(TAB_A);
  page.marker = 'id-1';

  await chats.checkMarker(TAB_A);

  assert.equal(chats.peek(TAB_A).notice, 'none');
  assert.equal((await store.load(TAB_A)).notice, 'none');
});

test('checkMarker sets reloaded when the stylesheet is gone and the URL is the same', async () =>
{
  const { store, page, chats } = setup({ [`pageAgentChat:${TAB_A}`]: storedChatWithCss(TAB_A) });
  await chats.get(TAB_A);
  page.marker = '';
  page.url = URL_A;

  await chats.checkMarker(TAB_A);

  assert.equal(chats.peek(TAB_A).notice, 'reloaded');
  assert.equal((await store.load(TAB_A)).notice, 'reloaded');
});

test('checkMarker tells another page on the same site (Re-apply offered) from another site', async () =>
{
  const { page, chats } = setup({ [`pageAgentChat:${TAB_A}`]: storedChatWithCss(TAB_A) });
  await chats.get(TAB_A);
  page.marker = '';

  page.url = 'https://site.test/videos/2';
  await chats.checkMarker(TAB_A);
  assert.equal(chats.peek(TAB_A).notice, 'navigated-same-site');

  page.url = 'https://other.test/videos/1';
  await chats.checkMarker(TAB_A);
  assert.equal(chats.peek(TAB_A).notice, 'navigated-other-site');
});

test('undo removes the inserted stylesheet by its exact text even when a notice is set', async () =>
{
  const stored = storedChatWithCss(TAB_A, { notice: 'reloaded' });
  const { store, page, chats } = setup({ [`pageAgentChat:${TAB_A}`]: stored });
  await chats.get(TAB_A);

  await chats.undo(TAB_A);

  assert.deepEqual(page.removed, [{ tabId: TAB_A, text: stored.appliedInsertedText }]);
  const chat = chats.peek(TAB_A);
  assert.equal(chat.appliedCss, '');
  assert.equal(chat.appliedInsertedText, '');
  assert.equal(chat.notice, 'none');
  assert.equal((await store.load(TAB_A)).appliedInsertedText, '');
});
