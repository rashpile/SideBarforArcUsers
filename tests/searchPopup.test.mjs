import assert from 'node:assert/strict';
import test from 'node:test';

import { SearchPopup } from '../src/services/searchPopup.ts';
import { SEARCH_POPUP_PORT_PREFIX, SearchFrameAction } from '../src/utils/searchPopupMessages.ts';

// Node's URL gives non-special schemes such as chrome-extension: an opaque origin ("null"), Chrome
// doesn't; an https base keeps isPopupPage's origin check working as it does in Chrome
const EXTENSION = 'https://extension.invalid/';
const ORIGIN_WINDOW = 1;
const ACTIVE_TAB = 10;
const POPUP_WINDOW = 50;
const OVERLAY_TAB = { id: ACTIVE_TAB, windowId: ORIGIN_WINDOW };
const POPUP_WINDOW_TAB = { id: 77, windowId: POPUP_WINDOW };

// Lets the promise chains a call started run to their end
const flush = () => new Promise(resolve => setImmediate(resolve));

const sessionOf = (url) => new URL(url).searchParams.get('session');

function deferred()
{
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

class FakePort
{
  constructor(name, sender)
  {
    this.name = name;
    this.sender = sender;
    this.posted = [];
    this.disconnected = false;
    this.messageListeners = [];
    this.disconnectListeners = [];
    this.onMessage = { addListener: (listener) => this.messageListeners.push(listener) };
    this.onDisconnect = { addListener: (listener) => this.disconnectListeners.push(listener) };
  }

  postMessage(message)
  {
    this.posted.push(message);
  }

  disconnect()
  {
    this.disconnected = true;
  }

  // A message from the page
  send(message)
  {
    for (const listener of this.messageListeners) listener(message);
  }

  get init()
  {
    return this.posted.find(message => message.type === 'init');
  }
}

// The page a page URL loads, connecting from the given tab
function pagePort(url, tab)
{
  return new FakePort(`${SEARCH_POPUP_PORT_PREFIX}${sessionOf(url)}`, { url, tab });
}

// Fakes the chrome APIs SearchPopup calls. `showsOverlay: false` is a page with no keyboard focus,
// so the popup opens in a window.
function harness(t, { showsOverlay = true } = {})
{
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const pageUrls = [];
  const sent = [];
  const createdWindows = [];
  let openGate;
  let createGate;
  let failNextOpen = false;
  let sessions = 0;

  globalThis.chrome = {
    runtime: { getURL: (path) => `${EXTENSION}${path}` },
    commands: { getAll: async () => [{ name: 'search-popup', shortcut: '⌥E' }] },
    scripting: { executeScript: async () => [] },
    windows: {
      getLastFocused: async () =>
      {
        if (openGate) await openGate.promise;
        if (failNextOpen)
        {
          failNextOpen = false;
          throw new Error('no window');
        }
        return {
          id: ORIGIN_WINDOW,
          left: 0,
          top: 0,
          width: 1200,
          height: 800,
          tabs: [{ id: 9, active: false }, { id: ACTIVE_TAB, active: true }],
        };
      },
      create: async (props) =>
      {
        createdWindows.push(props);
        pageUrls.push(props.url);
        if (createGate) await createGate.promise;
        return { id: POPUP_WINDOW };
      },
      update: async () => ({}),
      remove: async () => {},
    },
    tabs: {
      sendMessage: async (tabId, message) =>
      {
        sent.push({ tabId, message });
        if (message.action !== SearchFrameAction.SHOW) return undefined;
        pageUrls.push(message.url);
        return { shown: showsOverlay };
      },
    },
  };

  const candidates = {
    search: () => [],
    toRow: () => { throw new Error('no rows to show'); },
    hasSpaces: true,
    item: () => undefined,
  };
  const popup = new SearchPopup({
    buildCandidates: async () => candidates,
    picker: { pick: async () => {} },
    newSessionId: () => `s${++sessions}`,
    debug: false,
  });

  return {
    popup,
    sent,
    createdWindows,
    lastPageUrl: () => pageUrls.at(-1),
    // The next open waits in getLastFocused until the returned function is called
    holdOpen()
    {
      openGate = deferred();
      const gate = openGate;
      return () =>
      {
        openGate = undefined;
        gate.resolve();
      };
    },
    holdWindowCreate()
    {
      createGate = deferred();
      const gate = createGate;
      return () =>
      {
        createGate = undefined;
        gate.resolve();
      };
    },
    failNextOpen()
    {
      failNextOpen = true;
    },
    connect(url, tab)
    {
      const port = pagePort(url, tab);
      popup.handleConnect(port);
      return port;
    },
  };
}

test('presses made while the popup opens reach init as steps; a press after it connected moves by one', async (t) =>
{
  const h = harness(t);
  const release = h.holdOpen();
  const opening = h.popup.handleShortcut(true);
  // Before the snapshot exists
  await h.popup.handleShortcut(true);
  await h.popup.handleShortcut(true);
  release();
  await opening;
  // The frame is up, its page hasn't connected yet
  await h.popup.handleShortcut(true);

  const port = h.connect(h.lastPageUrl(), OVERLAY_TAB);
  assert.equal(port.disconnected, false);
  assert.equal(port.init.steps, 3);

  await h.popup.handleShortcut(true);
  assert.deepEqual(port.posted.at(-1), { type: 'move', steps: 1 });
  assert.equal(h.createdWindows.length, 0);
});

test('the next popup starts at 0 steps after one whose presses reached init', async (t) =>
{
  const h = harness(t);
  const release = h.holdOpen();
  const opening = h.popup.handleShortcut(true);
  await h.popup.handleShortcut(true);
  await h.popup.handleShortcut(true);
  release();
  await opening;
  const first = h.connect(h.lastPageUrl(), OVERLAY_TAB);
  assert.equal(first.init.steps, 2);
  first.send({ type: 'close', reason: 'esc' });
  await flush();

  await h.popup.handleShortcut(true);
  const second = h.connect(h.lastPageUrl(), OVERLAY_TAB);

  assert.notEqual(sessionOf(h.lastPageUrl()), first.name.slice(SEARCH_POPUP_PORT_PREFIX.length));
  assert.equal(second.disconnected, false);
  assert.equal(second.init.steps, 0);
});

// Each way a popup can end before its page takes the presses counted for it
const endsBeforeConnect = [
  {
    name: 'the frame was closed from the page',
    showsOverlay: true,
    end: (h) => h.popup.handleFrameClosed(ACTIVE_TAB),
    page: OVERLAY_TAB,
  },
  {
    name: 'the tab under the frame was closed',
    showsOverlay: true,
    end: (h) => h.popup.handleTabRemoved(ACTIVE_TAB),
    page: OVERLAY_TAB,
  },
  {
    name: 'the popup window was closed',
    showsOverlay: false,
    end: (h) => h.popup.handleWindowRemoved(POPUP_WINDOW),
    page: POPUP_WINDOW_TAB,
  },
];

for (const scenario of endsBeforeConnect)
{
  test(`presses for a popup that ended unconnected (${scenario.name}) don't reach the next popup`, async (t) =>
  {
    const h = harness(t, { showsOverlay: scenario.showsOverlay });
    await h.popup.handleShortcut(true);
    await h.popup.handleShortcut(true);
    await h.popup.handleShortcut(true);
    scenario.end(h);

    await h.popup.handleShortcut(true);
    const port = h.connect(h.lastPageUrl(), scenario.page);

    assert.equal(port.disconnected, false);
    assert.equal(port.init.steps, 0);
  });
}

test('presses during an open that failed before it had a session don\'t reach the next popup', async (t) =>
{
  t.mock.method(console, 'error', () => {});
  const h = harness(t);
  h.failNextOpen();
  const release = h.holdOpen();
  const opening = h.popup.handleShortcut(true);
  await h.popup.handleShortcut(true);
  await h.popup.handleShortcut(true);
  release();
  await opening;

  await h.popup.handleShortcut(true);
  const port = h.connect(h.lastPageUrl(), OVERLAY_TAB);

  assert.equal(port.disconnected, false);
  assert.equal(port.init.steps, 0);
});

test('only the session\'s own page in the host tab takes the overlay session, and only once', async (t) =>
{
  const h = harness(t);
  await h.popup.handleShortcut(true);
  const url = h.lastPageUrl();
  const name = `${SEARCH_POPUP_PORT_PREFIX}${sessionOf(url)}`;

  const refused = [
    ['another session id', new FakePort(`${SEARCH_POPUP_PORT_PREFIX}other`, { url, tab: OVERLAY_TAB })],
    ['another page of the extension', new FakePort(name, { url: `${EXTENSION}sidebar.html?session=${sessionOf(url)}`, tab: OVERLAY_TAB })],
    ['another extension', new FakePort(name, { url: url.replace(EXTENSION, 'https://other-extension.invalid/'), tab: OVERLAY_TAB })],
    ['a web page', new FakePort(name, { url: `https://site.test/search.html?session=${sessionOf(url)}`, tab: OVERLAY_TAB })],
    ['no sender URL', new FakePort(name, { tab: OVERLAY_TAB })],
    ['another tab of the window', new FakePort(name, { url, tab: { id: 9, windowId: ORIGIN_WINDOW } })],
    ['no sender tab', new FakePort(name, { url })],
  ];
  for (const [why, port] of refused)
  {
    h.popup.handleConnect(port);
    assert.equal(port.disconnected, true, why);
    assert.deepEqual(port.posted, [], why);
  }

  const page = h.connect(url, OVERLAY_TAB);
  assert.equal(page.disconnected, false);
  assert.equal(page.init.type, 'init');

  const second = h.connect(url, OVERLAY_TAB);
  assert.equal(second.disconnected, true);
  assert.deepEqual(second.posted, []);
});

test('the popup window session is taken only by its page in that window', async (t) =>
{
  const h = harness(t, { showsOverlay: false });
  await h.popup.handleShortcut(true);
  const url = h.lastPageUrl();
  assert.equal(new URL(url).searchParams.get('host'), 'window');

  const otherWindow = h.connect(url, { id: 78, windowId: POPUP_WINDOW + 1 });
  assert.equal(otherWindow.disconnected, true);
  const originTab = h.connect(url, OVERLAY_TAB);
  assert.equal(originTab.disconnected, true);

  const page = h.connect(url, POPUP_WINDOW_TAB);
  assert.equal(page.disconnected, false);
  assert.equal(page.init.type, 'init');
});

test('a frame page that doesn\'t connect within 2 s gives way to a window, and its session id is refused after', async (t) =>
{
  const h = harness(t);
  await h.popup.handleShortcut(true);
  const frameUrl = h.lastPageUrl();

  t.mock.timers.tick(1_999);
  await flush();
  assert.equal(h.createdWindows.length, 0);

  const releaseCreate = h.holdWindowCreate();
  t.mock.timers.tick(1);
  await flush();
  assert.deepEqual(h.sent.at(-1), { tabId: ACTIVE_TAB, message: { action: SearchFrameAction.REMOVE } });
  assert.equal(h.createdWindows.length, 1);
  const windowUrl = h.createdWindows[0].url;
  assert.notEqual(sessionOf(windowUrl), sessionOf(frameUrl));

  // While windows.create is pending the window's id is unknown, so only the id tells the pages apart
  const lateFrame = h.connect(frameUrl, OVERLAY_TAB);
  assert.equal(lateFrame.disconnected, true);
  assert.deepEqual(lateFrame.posted, []);

  releaseCreate();
  await flush();
  const windowPage = h.connect(windowUrl, POPUP_WINDOW_TAB);
  assert.equal(windowPage.disconnected, false);
  assert.equal(windowPage.init.type, 'init');
});

test('a frame page that connects in time keeps the overlay when the deadline passes', async (t) =>
{
  const h = harness(t);
  await h.popup.handleShortcut(true);
  t.mock.timers.tick(1_000);
  const page = h.connect(h.lastPageUrl(), OVERLAY_TAB);

  t.mock.timers.tick(5_000);
  await flush();

  assert.equal(page.disconnected, false);
  assert.equal(h.createdWindows.length, 0);
  assert.equal(h.sent.some(({ message }) => message.action === SearchFrameAction.REMOVE), false);
});
