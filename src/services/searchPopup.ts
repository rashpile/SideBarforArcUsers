// SearchPopup - the background half of the search popup.
//
// The shortcut snapshots what can be found (SearchCandidates) and shows search.html where the keys
// go: in an iframe over the active tab's page (searchPopupFrame.js, injected with the activeTab
// grant the shortcut gives), or in a focused popup window on pages the extension can't script or
// that have no focus. The page connects a port; queries, picks and closes travel over it, and
// background answers each query from the snapshot. Further presses while the popup is open arrive
// here as commands and are forwarded as moves, as in the Tab Switcher.
//
// The session lives in worker memory only, so its tab and window ids never outlive the browser
// session. The page's pings keep the worker running while the popup is open.

import type { SearchCandidates } from './searchResults.ts';
import type { SearchPicker } from './searchPick.ts';
import { SEARCH_POPUP_PORT_PREFIX, SearchFrameAction } from '../utils/searchPopupMessages.ts';
import type {
  SearchBackgroundMessage,
  SearchPageMessage,
  SearchQuery,
  SearchRow,
} from '../utils/searchPopupMessages.ts';

export interface SearchPopupDeps
{
  // The snapshot for the origin window (fetched with its tabs)
  buildCandidates(win: chrome.windows.Window): Promise<SearchCandidates>;
  picker: SearchPicker;
  newSessionId(): string;
  debug: boolean;
}

type SearchPopupHost =
  | { kind: 'overlay'; tabId: number }
  // windowId is undefined until windows.create resolves; the page may connect before that
  | { kind: 'window'; windowId: number | undefined };

export const SEARCH_POPUP_COMMAND = 'search-popup';

const FRAME_SCRIPT = 'searchPopupFrame.js';
const POPUP_PAGE = 'search.html';
// A frame the site or the profile blocks never connects; after this the popup window takes over
const CONNECT_DEADLINE_MS = 2_000;
const WINDOW_WIDTH = 640;
const WINDOW_HEIGHT = 560;

// Every open starts on All, This Space, with an empty field
const INITIAL_QUERY: SearchQuery = { text: '', scope: 'all', allSpaces: false };

// Only the extension's own popup page may take a session, whatever query string it carries
function isPopupPage(url: string | undefined): boolean
{
  if (!url) return false;
  try
  {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}` === chrome.runtime.getURL(POPUP_PAGE);
  }
  catch
  {
    return false;
  }
}

interface SearchSessionInit
{
  id: string;
  originWindow: chrome.windows.Window;
  originWindowId: number;
  restored: boolean;
  candidates: SearchCandidates;
  shortcut: string | undefined;
}

// One open popup: where it is shown, the port to its page and the snapshot it searches
class SearchSession
{
  readonly originWindow: chrome.windows.Window;
  readonly originWindowId: number;
  // What stateReady resolved to when the popup opened; the picker checks it
  readonly restored: boolean;
  readonly candidates: SearchCandidates;
  readonly shortcut: string | undefined;
  host: SearchPopupHost | undefined;
  #id: string;
  #port: chrome.runtime.Port | undefined;
  #deadline: ReturnType<typeof setTimeout> | undefined;

  constructor(init: SearchSessionInit)
  {
    this.#id = init.id;
    this.originWindow = init.originWindow;
    this.originWindowId = init.originWindowId;
    this.restored = init.restored;
    this.candidates = init.candidates;
    this.shortcut = init.shortcut;
  }

  get connected(): boolean
  {
    return this.#port !== undefined;
  }

  // A page that was handed the old id can no longer take the session
  renew(id: string): void
  {
    this.#id = id;
  }

  pageUrl(hostKind: SearchPopupHost['kind']): string
  {
    const params = new URLSearchParams({ session: this.#id });
    if (hostKind === 'window') params.set('host', 'window');
    return chrome.runtime.getURL(`${POPUP_PAGE}?${params}`);
  }

  // The port of this session's page in this session's host, and only the first one
  accepts(port: chrome.runtime.Port): boolean
  {
    if (this.#port || port.name !== `${SEARCH_POPUP_PORT_PREFIX}${this.#id}`) return false;
    if (!isPopupPage(port.sender?.url)) return false;

    const senderTab = port.sender?.tab;
    const host = this.host;
    if (host?.kind === 'overlay') return senderTab?.id === host.tabId;
    if (host?.kind === 'window') return host.windowId === undefined || senderTab?.windowId === host.windowId;
    return false;
  }

  attach(port: chrome.runtime.Port): void
  {
    this.#port = port;
    this.#clearDeadline();
  }

  holds(port: chrome.runtime.Port): boolean
  {
    return this.#port === port;
  }

  // False when the port is gone
  post(message: SearchBackgroundMessage): boolean
  {
    if (!this.#port) return false;
    try
    {
      this.#port.postMessage(message);
      return true;
    }
    catch
    {
      return false;
    }
  }

  rows(query: SearchQuery): SearchRow[]
  {
    return this.candidates.search(query).map(item => this.candidates.toRow(item, query.allSpaces));
  }

  showsOverlayIn(tabId: number): boolean
  {
    return this.host?.kind === 'overlay' && this.host.tabId === tabId;
  }

  showsWindow(windowId: number): boolean
  {
    return this.host?.kind === 'window' && this.host.windowId === windowId;
  }

  startDeadline(onExpire: () => void): void
  {
    this.#clearDeadline();
    this.#deadline = setTimeout(onExpire, CONNECT_DEADLINE_MS);
  }

  // The page learns it was dropped through its port's onDisconnect and closes itself
  end(): void
  {
    this.#clearDeadline();
    const port = this.#port;
    this.#port = undefined;
    port?.disconnect();
  }

  #clearDeadline(): void
  {
    if (this.#deadline === undefined) return;
    clearTimeout(this.#deadline);
    this.#deadline = undefined;
  }
}

export class SearchPopup
{
  readonly #deps: SearchPopupDeps;
  #session: SearchSession | undefined;
  #opening = false;
  // Presses that came in before the page connected; init hands them over
  #pendingSteps = 0;

  constructor(deps: SearchPopupDeps)
  {
    this.#deps = deps;
  }

  // `restored` is what stateReady resolved to; it only matters for a press that opens the popup
  async handleShortcut(restored: boolean): Promise<void>
  {
    const session = this.#session;
    if (session?.connected)
    {
      if (session.post({ type: 'move', steps: 1 })) return;
      // The page went away before its disconnect reached here - open a fresh popup
      this.#clear();
    }

    if (this.#opening || this.#session)
    {
      this.#pendingSteps++;
      return;
    }

    await this.#open(restored);
  }

  // runtime.onConnect for a port whose name starts with SEARCH_POPUP_PORT_PREFIX
  handleConnect(port: chrome.runtime.Port): void
  {
    const session = this.#session;
    if (!session?.accepts(port))
    {
      this.#log('refused port', port.name, port.sender?.url);
      port.disconnect();
      return;
    }

    session.attach(port);
    port.onMessage.addListener((message: SearchPageMessage) =>
    {
      if (this.#isLive(session, port)) this.#handleMessage(session, message);
    });
    port.onDisconnect.addListener(() =>
    {
      if (this.#isLive(session, port)) this.#clear();
    });

    session.post({
      type: 'init',
      rows: session.rows(INITIAL_QUERY),
      steps: this.#takePendingSteps(),
      shortcut: session.shortcut,
      hasSpaces: session.candidates.hasSpaces,
    });
  }

  // The frame script removed the frame itself (a click outside it, the page got hidden)
  handleFrameClosed(tabId: number): void
  {
    if (this.#session?.showsOverlayIn(tabId)) this.#clear();
  }

  handleTabRemoved(tabId: number): void
  {
    if (this.#session?.showsOverlayIn(tabId)) this.#clear();
  }

  handleWindowRemoved(windowId: number): void
  {
    if (this.#session?.showsWindow(windowId)) this.#clear();
  }

  async #open(restored: boolean): Promise<void>
  {
    this.#opening = true;
    // Unlike the Tab Switcher, the first press only opens the popup; it doesn't move the selection
    this.#pendingSteps = 0;
    let session: SearchSession | undefined;
    try
    {
      const [win, commands] = await Promise.all([
        chrome.windows.getLastFocused({ populate: true, windowTypes: ['normal'] }),
        chrome.commands.getAll(),
      ]);
      if (win.id === undefined || !win.tabs) return;

      const candidates = await this.#deps.buildCandidates(win);
      const shortcut = commands.find(command => command.name === SEARCH_POPUP_COMMAND)?.shortcut || undefined;
      // The session and its id exist before the host does: the page can connect before the SHOW
      // reply or windows.create resolves
      session = new SearchSession({
        id: this.#deps.newSessionId(),
        originWindow: win,
        originWindowId: win.id,
        restored,
        candidates,
        shortcut,
      });
      this.#session = session;

      const activeTabId = win.tabs.find(tab => tab.active)?.id;
      const shown = activeTabId !== undefined && await this.#showOverlay(session, activeTabId);
      if (!shown && this.#session === session) await this.#openWindow(session);
    }
    catch (error)
    {
      console.error('[SearchPopup] failed to open:', error);
      if (session && this.#session === session) this.#clear();
    }
    finally
    {
      this.#opening = false;
    }
  }

  // Draws the popup over the page; false when the page can't be scripted or has no focus
  async #showOverlay(session: SearchSession, tabId: number): Promise<boolean>
  {
    session.host = { kind: 'overlay', tabId };
    try
    {
      await chrome.scripting.executeScript({ target: { tabId }, files: [FRAME_SCRIPT] });
      const response = await chrome.tabs.sendMessage(tabId, {
        action: SearchFrameAction.SHOW,
        url: session.pageUrl('overlay'),
      });
      if (response?.shown)
      {
        if (this.#session === session && !session.connected)
        {
          session.startDeadline(() => void this.#fallBackToWindow(session));
        }
        return true;
      }

      this.#log('page has no keyboard focus - using the window');
    }
    catch (error)
    {
      this.#log('page can\'t be scripted - using the window:', error);
    }
    return false;
  }

  // The frame is up but its page never connected: a frame the site or the profile blocked
  async #fallBackToWindow(session: SearchSession): Promise<void>
  {
    const host = session.host;
    if (this.#session !== session || session.connected || host?.kind !== 'overlay') return;

    this.#log('popup page did not connect in the frame - using the window');
    // If the frame's page loads after all, it must not take the session from the window's page
    session.renew(this.#deps.newSessionId());
    await chrome.tabs.sendMessage(host.tabId, { action: SearchFrameAction.REMOVE }).catch(() => { /* tab gone */ });
    if (this.#session !== session) return;
    try
    {
      await this.#openWindow(session);
    }
    catch (error)
    {
      console.error('[SearchPopup] failed to open the window:', error);
      if (this.#session === session) this.#clear();
    }
  }

  async #openWindow(session: SearchSession): Promise<void>
  {
    session.host = { kind: 'window', windowId: undefined };
    const origin = session.originWindow;
    const left = Math.round((origin.left ?? 0) + ((origin.width ?? 1200) - WINDOW_WIDTH) / 2);
    const top = Math.round((origin.top ?? 0) + ((origin.height ?? 800) - WINDOW_HEIGHT) / 2);

    const created = await chrome.windows.create({
      url: session.pageUrl('window'),
      type: 'popup',
      focused: true,
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
      left,
      top,
    });
    if (created.id === undefined) throw new Error('the popup window has no id');
    session.host = { kind: 'window', windowId: created.id };
  }

  #handleMessage(session: SearchSession, message: SearchPageMessage): void
  {
    try
    {
      switch (message?.type)
      {
        case 'query':
          session.post({ type: 'results', rows: session.rows(message.query) });
          break;
        case 'pick':
          void this.#pick(session, message.rowId);
          break;
        case 'close':
          this.#log('close', message.reason);
          // A blur means the user went to another window or app; pulling Chrome back would undo that
          void this.#finish(session, message.reason !== 'blur');
          break;
        case 'ping':
          break;
      }
    }
    catch (error)
    {
      console.error('[SearchPopup] failed to handle a page message:', error);
    }
  }

  async #pick(session: SearchSession, rowId: string): Promise<void>
  {
    const item = session.candidates.item(rowId);
    this.#log('pick', rowId, item?.kind);
    await this.#finish(session, true);
    if (!item) return;
    try
    {
      await this.#deps.picker.pick(item, session.originWindowId, session.restored);
    }
    catch (error)
    {
      // The snapshot is older than the change: the tab or the record is gone
      console.error('[SearchPopup] failed to open the picked result:', error);
    }
  }

  // Ends the session, then takes its host away
  async #finish(session: SearchSession, refocusOrigin: boolean): Promise<void>
  {
    if (this.#session === session) this.#clear();

    const host = session.host;
    if (host?.kind === 'overlay')
    {
      await chrome.tabs.sendMessage(host.tabId, { action: SearchFrameAction.REMOVE }).catch(() => { /* tab gone */ });
      return;
    }
    if (host?.kind !== 'window') return;

    if (refocusOrigin)
    {
      await chrome.windows.update(session.originWindowId, { focused: true }).catch(() => { /* window gone */ });
    }
    if (host.windowId !== undefined)
    {
      await chrome.windows.remove(host.windowId).catch(() => { /* already closed */ });
    }
  }

  #isLive(session: SearchSession, port: chrome.runtime.Port): boolean
  {
    return this.#session === session && session.holds(port);
  }

  #takePendingSteps(): number
  {
    const steps = this.#pendingSteps;
    this.#pendingSteps = 0;
    return steps;
  }

  #clear(): void
  {
    const session = this.#session;
    this.#session = undefined;
    this.#pendingSteps = 0;
    session?.end();
  }

  #log(...args: unknown[]): void
  {
    if (this.#deps.debug)
    {
      console.log('[SearchPopup]', ...args);
    }
  }
}
