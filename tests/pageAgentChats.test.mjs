import assert from 'node:assert/strict';
import test from 'node:test';

import { PageAgentChatStore } from '../src/services/pageAgent/pageAgentChatStore.ts';
import { PageAgentChats } from '../src/services/pageAgent/pageAgentChats.ts';
import { SavedPageStyle } from '../src/stores/savedPageStyles.ts';

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
    this.finished = false;
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
    this.finished = true;
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

  /** The tab's run that hasn't finished yet. */
  async runFor(tabId)
  {
    for (let attempt = 0; attempt < 50; attempt++)
    {
      const run = this.runs.find(entry => entry.start.tabId === tabId && !entry.finished);
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
    this.markerReads = 0;
    this.popups = new Map();
    this.popupCalls = [];
  }

  async showPopup(tabId, title, answer)
  {
    this.popupCalls.push({ method: 'showPopup', tabId });
    this.popups.set(tabId, { title, entries: [answer] });
  }

  async appendToPopup(tabId, answer)
  {
    this.popupCalls.push({ method: 'appendToPopup', tabId });
    const popup = this.popups.get(tabId);
    if (!popup)
    {
      return false;
    }
    popup.entries.push(answer);
    return true;
  }

  /** The popup's close button. */
  closePopup(tabId)
  {
    this.popups.delete(tabId);
  }

  popupOf(tabId)
  {
    return this.popups.get(tabId);
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
    this.markerReads++;
    return this.marker;
  }

  async pageUrl()
  {
    return this.url;
  }
}

/** The side panel's lookup of a tab's saved style; tests set a tab's style as its bookmark gets one. */
class FakeSavedStyles
{
  constructor()
  {
    this.byTab = new Map();
  }

  set(tabId, bookmarkId, style)
  {
    this.byTab.set(tabId, { bookmarkId, style });
  }

  styleForTab(tabId)
  {
    return this.byTab.get(tabId) ?? null;
  }
}

function setup(initialItems = {})
{
  const area = new FakeSessionArea(initialItems);
  const store = new PageAgentChatStore(area);
  const factory = new FakeRunFactory();
  const page = new FakePage();
  const savedStyles = new FakeSavedStyles();
  let nextId = 0;
  const chats = new PageAgentChats({
    store,
    runFactory: factory.create,
    page,
    savedStyles,
    createId: () => `reapplied-${++nextId}`,
  });
  return { area, store, factory, page, savedStyles, chats };
}

const savedStyle = (rev, css = CSS) => new SavedPageStyle(css, true, 'https://site.test', rev);

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

const answered = summary => ({ status: 'answered', conditions: [], replaced: [], summary });

async function finishTurn(chats, factory, tabId, request, result)
{
  const sending = chats.send(tabId, request, SETTINGS);
  const run = await factory.runFor(tabId);
  run.finish(result);
  await sending;
  return run;
}

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

test('checkMarker adopts the saved style the background put on the page into an empty chat, and the next run replaces it', async () =>
{
  const { store, factory, page, savedStyles, chats } = setup();
  const style = savedStyle('r1');
  savedStyles.set(TAB_A, '42', style);
  await chats.get(TAB_A);
  page.marker = 'saved-r1';

  await chats.checkMarker(TAB_A);

  const chat = chats.peek(TAB_A);
  assert.equal(chat.data.turns.length, 0);
  assert.equal(chat.appliedCss, CSS);
  assert.equal(chat.appliedInsertedText, style.insertedText);
  assert.equal(chat.appliedId, 'saved-r1');
  assert.equal(chat.appliedUrl, URL_A);
  assert.equal(chat.notice, 'none');
  assert.equal((await store.load(TAB_A)).appliedId, 'saved-r1');

  const sending = chats.send(TAB_A, 'make the title bigger', SETTINGS);
  const run = await factory.runFor(TAB_A);
  assert.equal(run.start.currentCss, CSS);
  assert.equal(run.start.insertedText, style.insertedText, 'so the run removes the saved sheet before it inserts its own');
  run.finish(metResult);
  await sending;
});

test('after a reload checkMarker adopts the saved sheet in place of the dropped one of the run, without a notice', async () =>
{
  const { page, savedStyles, chats } = setup({ [`pageAgentChat:${TAB_A}`]: storedChatWithCss(TAB_A) });
  const style = savedStyle('r1');
  savedStyles.set(TAB_A, '42', style);
  await chats.get(TAB_A);
  page.marker = 'saved-r1';

  await chats.checkMarker(TAB_A);

  const chat = chats.peek(TAB_A);
  assert.equal(chat.data.turns.length, 1, 'the turns stay');
  assert.equal(chat.appliedId, 'saved-r1');
  assert.equal(chat.appliedInsertedText, style.insertedText);
  assert.equal(chat.notice, 'none');
});

test('checkMarker adopts nothing for the marker of an older save, and an empty chat gets no notice', async () =>
{
  const { store, page, savedStyles, chats } = setup();
  savedStyles.set(TAB_A, '42', savedStyle('r2'));
  await chats.get(TAB_A);

  for (const marker of ['saved-r1', ''])
  {
    page.marker = marker;
    await chats.checkMarker(TAB_A);

    const chat = chats.peek(TAB_A);
    assert.equal(chat.appliedId, '', `marker "${marker}"`);
    assert.equal(chat.appliedInsertedText, '', `marker "${marker}"`);
    assert.equal(chat.notice, 'none', `marker "${marker}"`);
  }
  assert.equal(await store.load(TAB_A), null, 'nothing written');
});

test('checkMarker does not read the page of an empty chat on a tab without a saved style', async () =>
{
  const { store, page, chats } = setup();
  await chats.get(TAB_A);
  page.marker = '';

  await chats.checkMarker(TAB_A);

  assert.equal(page.markerReads, 0);
  assert.equal(chats.peek(TAB_A).notice, 'none');
  assert.equal(await store.load(TAB_A), null);
});

test('applySaved only records the saved style when the page already has it', async () =>
{
  const { page, savedStyles, chats } = setup();
  const style = savedStyle('r1');
  savedStyles.set(TAB_A, '42', style);
  await chats.get(TAB_A);
  page.marker = 'saved-r1';

  await chats.applySaved(TAB_A);

  assert.deepEqual(page.inserted, [], 'a second copy would stay on the page after Undo');
  assert.deepEqual(page.removed, []);
  const chat = chats.peek(TAB_A);
  assert.equal(chat.appliedId, 'saved-r1');
  assert.equal(chat.appliedInsertedText, style.insertedText);
});

test('applySaved replaces the chat stylesheet on the page with the saved one', async () =>
{
  const stored = storedChatWithCss(TAB_A);
  const { store, page, savedStyles, chats } = setup({ [`pageAgentChat:${TAB_A}`]: stored });
  const style = savedStyle('r1', 'video { width: 100% !important; }');
  savedStyles.set(TAB_A, '42', style);
  await chats.get(TAB_A);
  page.marker = 'id-1';
  page.url = 'https://site.test/videos/2';

  await chats.applySaved(TAB_A);

  assert.deepEqual(page.removed, [{ tabId: TAB_A, text: stored.appliedInsertedText }]);
  assert.deepEqual(page.inserted, [{ tabId: TAB_A, text: style.insertedText }]);
  const chat = chats.peek(TAB_A);
  assert.equal(chat.appliedCss, style.css);
  assert.equal(chat.appliedInsertedText, style.insertedText);
  assert.equal(chat.appliedId, 'saved-r1');
  assert.equal(chat.appliedUrl, 'https://site.test/videos/2');
  assert.equal((await store.load(TAB_A)).appliedId, 'saved-r1');
});

test('applySaved is ignored while the tab has a live run', async () =>
{
  const { factory, page, savedStyles, chats } = setup();
  savedStyles.set(TAB_A, '42', savedStyle('r1'));
  const sending = chats.send(TAB_A, 'make the player full width', SETTINGS);
  const run = await factory.runFor(TAB_A);

  await chats.applySaved(TAB_A);

  assert.equal(page.markerReads, 0);
  assert.deepEqual(page.inserted, []);
  assert.deepEqual(page.removed, []);
  assert.equal(chats.peek(TAB_A).appliedId, '');
  run.finish(metResult);
  await sending;
});

test('a follow-up run gets the earlier answers in its history, one over 4000 characters cut with a note', async () =>
{
  const { factory, chats } = setup();
  const shortAnswer = '## Summary\n\nThe page is about **grid** layout.';
  const longAnswer = `${'a'.repeat(3990)}TAIL OF THE ANSWER${'b'.repeat(500)}`;
  await finishTurn(chats, factory, TAB_A, 'summary page', answered(shortAnswer));
  await finishTurn(chats, factory, TAB_A, 'explain every section', answered(longAnswer));

  const sending = chats.send(TAB_A, 'and the conclusion?', SETTINGS);
  const run = await factory.runFor(TAB_A);
  const [first, second] = run.start.history;
  assert.equal(first.status, 'answered');
  assert.equal(first.summary, shortAnswer);
  assert.equal(second.summary, `${longAnswer.slice(0, 4000)}\n[answer cut at 4000 characters]`);
  assert.equal(chats.peek(TAB_A).answerOf(1).markdown, longAnswer, 'the chat keeps the whole answer');
  run.finish(answered('It ends with a summary.'));
  await sending;
});

test('an answer of a run on tab A goes to the popup open on A while the drawer shows tab B', async () =>
{
  const { factory, page, chats } = setup();
  await finishTurn(chats, factory, TAB_A, 'summary page', answered('The page is about layout.'));
  await chats.showOnPage(TAB_A, 0);
  page.popupCalls = [];

  const sending = chats.send(TAB_A, 'explain grid', SETTINGS);
  const run = await factory.runFor(TAB_A);
  await chats.get(TAB_B);
  run.finish(answered('Grid is a two-dimensional layout.'));
  await sending;

  assert.deepEqual(page.popupOf(TAB_A).entries, [
    { question: 'summary page', markdown: 'The page is about layout.' },
    { question: 'explain grid', markdown: 'Grid is a two-dimensional layout.' },
  ]);
  assert.equal(page.popupOf(TAB_B), undefined);
  assert.deepEqual(page.popupCalls, [{ method: 'appendToPopup', tabId: TAB_A }]);
});

test('after the popup is closed the next answer appends nothing and opens no popup', async () =>
{
  const { factory, page, chats } = setup();
  await finishTurn(chats, factory, TAB_A, 'summary page', answered('The page is about layout.'));
  await chats.showOnPage(TAB_A, 0);
  page.closePopup(TAB_A);
  page.popupCalls = [];

  await finishTurn(chats, factory, TAB_A, 'explain grid', answered('Grid is a two-dimensional layout.'));

  assert.equal(page.popupOf(TAB_A), undefined);
  assert.deepEqual(page.popupCalls, [{ method: 'appendToPopup', tabId: TAB_A }], 'an append only, never an open');
  assert.equal(chats.peek(TAB_A).data.turns[1].status, 'answered');
});

test('a turn whose run opened the popup and a style turn append nothing to the open popup', async () =>
{
  const { factory, page, chats } = setup();
  await finishTurn(chats, factory, TAB_A, 'summary page', answered('The page is about layout.'));
  await chats.showOnPage(TAB_A, 0);
  page.popupCalls = [];

  // show_popup went through the run's own adapter; appending it again would show it twice.
  await finishTurn(chats, factory, TAB_A, 'show the summary in a popup', {
    ...answered('A summary in a popup.'),
    openedPopup: true,
  });
  await finishTurn(chats, factory, TAB_A, 'make the player full width', metResult);

  assert.deepEqual(page.popupCalls, []);
  assert.equal(page.popupOf(TAB_A).entries.length, 1);
});
