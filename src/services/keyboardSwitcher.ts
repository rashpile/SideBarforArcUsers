// KeyboardSwitcher - the background half of the Cmd+Tab-style switchers (spike).
//
// A shortcut opens a list (the window's tabs, or the Spaces), most recently
// used first. Holding the modifier and pressing the shortcut again moves the
// selection; releasing the modifier picks the selected card. Only a page with
// keyboard focus sees that release, so the list lives where the keys go:
// - drawn over the active tab's page by switcherOverlay.js, injected with the
//   activeTab grant the shortcut gives
// - in a focused popup window (switcher.html, same script) for pages the
//   extension can't script: chrome://, the New Tab page, the Web Store
// Chrome usually keeps the shortcut's keydown from the page, so repeated
// presses arrive here as commands and are forwarded to the list.

import { fetchAsBase64, getFaviconUrl } from '../utils/favicon';
import { SwitcherCard, SwitcherListData, SwitcherMessageAction } from '../utils/switcherMessages';

export type SwitcherKind = 'tabs' | 'spaces';

export interface KeyboardSwitcherDeps
{
  // The list for a window (fetched with its tabs), current item first
  buildCards(kind: SwitcherKind, window: chrome.windows.Window): Promise<SwitcherCard[]>;
  // Switch to the card the user picked
  pick(kind: SwitcherKind, windowId: number, cardId: string): Promise<void>;
}

type SwitcherHost =
  | { kind: 'overlay'; tabId: number }
  | { kind: 'window'; windowId: number };

// Spaces cycle one way only; Arrow Up in the open list goes back
const COMMANDS: Record<string, { kind: SwitcherKind; direction: 1 | -1 }> = {
  'tab-switcher-next': { kind: 'tabs', direction: 1 },
  'tab-switcher-prev': { kind: 'tabs', direction: -1 },
  'space-switcher-next': { kind: 'spaces', direction: 1 },
};

const NEXT_COMMAND: Record<SwitcherKind, string> = {
  tabs: 'tab-switcher-next',
  spaces: 'space-switcher-next',
};

const OVERLAY_SCRIPT = 'switcherOverlay.js';

// Window sizing, matching the card layout in switcherOverlay.ts
const VISIBLE_CARDS = 8;
const CARD_HEIGHT = 56;
const PANEL_PADDING = 16;
const DEBUG_LINE_HEIGHT = 22;
const TITLE_BAR_HEIGHT = 30;
const WINDOW_WIDTH = 460;

export function parseSwitcherCommand(command: string): { kind: SwitcherKind; direction: 1 | -1 } | undefined
{
  return COMMANDS[command];
}

// KeyboardEvent.code of a shortcut's key ("⌘E" -> "KeyE"), so a press that
// reaches the page rather than Chrome still moves the selection
function keyCodeOf(shortcut: string | undefined): string | undefined
{
  const key = shortcut?.slice(-1).toUpperCase();
  if (!key) return undefined;
  if (/[A-Z]/.test(key)) return `Key${key}`;
  if (/[0-9]/.test(key)) return `Digit${key}`;
  if (key === ',') return 'Comma';
  if (key === '.') return 'Period';
  return undefined;
}

export class KeyboardSwitcher
{
  #deps: KeyboardSwitcherDeps;
  #host: SwitcherHost | undefined;
  #kind: SwitcherKind = 'tabs';
  #opening = false;
  // The switcher window asked for its list, so it can take MOVE messages
  #windowReady = false;
  // Presses that came in while the list was opening, sent once it can take them
  #pendingSteps = 0;
  #originWindowId: number | undefined;
  #cards: SwitcherCard[] = [];
  #repeatKeyCode: string | undefined;

  constructor(deps: KeyboardSwitcherDeps)
  {
    this.#deps = deps;
  }

  // A press of either switcher's shortcut while a list is open moves that list
  async handleShortcut(kind: SwitcherKind, direction: 1 | -1): Promise<void>
  {
    if (this.#opening || (this.#host?.kind === 'window' && !this.#windowReady))
    {
      this.#pendingSteps += direction;
      return;
    }

    if (this.#host)
    {
      if (await this.#send({ action: SwitcherMessageAction.MOVE, steps: direction })) return;
      // The list is gone (its page navigated away, its window closed) - open a fresh one
      this.#clear();
    }

    await this.#open(kind, direction);
  }

  // The switcher window loaded and asks for its list and the presses it missed
  handleWindowReady(): SwitcherListData
  {
    this.#windowReady = true;
    return this.#listData();
  }

  async commit(cardId: string, reason: string): Promise<void>
  {
    if (import.meta.env.DEV)
    {
      console.log(`[KeyboardSwitcher] commit ${this.#kind} ${cardId} (${reason})`);
    }

    const host = this.#host;
    const kind = this.#kind;
    const originWindowId = this.#originWindowId;
    this.#clear();
    if (originWindowId !== undefined) await this.#deps.pick(kind, originWindowId, cardId);
    if (host?.kind === 'window') await this.#closeWindow(host.windowId, originWindowId);
  }

  async cancel(reason: string): Promise<void>
  {
    if (import.meta.env.DEV)
    {
      console.log(`[KeyboardSwitcher] cancel (${reason})`);
    }

    const host = this.#host;
    const originWindowId = this.#originWindowId;
    this.#clear();
    if (host?.kind === 'window') await this.#closeWindow(host.windowId, originWindowId);
  }

  handleWindowRemoved(windowId: number): void
  {
    if (this.#host?.kind === 'window' && this.#host.windowId === windowId) this.#clear();
  }

  handleTabRemoved(tabId: number): void
  {
    if (this.#host?.kind === 'overlay' && this.#host.tabId === tabId) this.#clear();
  }

  async #open(kind: SwitcherKind, direction: number): Promise<void>
  {
    this.#opening = true;
    this.#kind = kind;
    this.#pendingSteps = direction;
    try
    {
      const [win, commands] = await Promise.all([
        chrome.windows.getLastFocused({ populate: true, windowTypes: ['normal'] }),
        chrome.commands.getAll(),
      ]);
      if (win.id === undefined || !win.tabs) return;

      this.#originWindowId = win.id;
      this.#cards = await this.#deps.buildCards(kind, win);
      this.#repeatKeyCode = keyCodeOf(commands.find(command => command.name === NEXT_COMMAND[kind])?.shortcut);

      const activeTabId = win.tabs.find(tab => tab.active)?.id;
      if (activeTabId === undefined || !await this.#showOverlay(activeTabId))
      {
        await this.#openWindow(win);
      }
    }
    catch (error)
    {
      console.error('[KeyboardSwitcher] failed to open:', error);
    }
    finally
    {
      this.#opening = false;
    }

    // Presses that came in after the list took its starting steps
    const canTakeMoves = this.#host?.kind === 'overlay' || this.#windowReady;
    if (canTakeMoves && this.#pendingSteps !== 0)
    {
      await this.#send({ action: SwitcherMessageAction.MOVE, steps: this.#takePendingSteps() });
    }
  }

  // Draws the list over the page; false when the page can't be scripted or has no focus
  async #showOverlay(tabId: number): Promise<boolean>
  {
    let data: SwitcherListData | undefined;
    try
    {
      await chrome.scripting.executeScript({ target: { tabId }, files: [OVERLAY_SCRIPT] });
      data = this.#listData();
      const response = await chrome.tabs.sendMessage(tabId, { action: SwitcherMessageAction.SHOW, ...data });
      if (response?.shown)
      {
        this.#host = { kind: 'overlay', tabId };
        void this.#sendOverlayIcons();
        return true;
      }

      if (import.meta.env.DEV)
      {
        console.log('[KeyboardSwitcher] page has no keyboard focus - using the window');
      }
    }
    catch (error)
    {
      if (import.meta.env.DEV)
      {
        console.log('[KeyboardSwitcher] page can\'t be scripted - using the window:', error);
      }
    }

    this.#pendingSteps += data?.steps ?? 0;
    return false;
  }

  // The overlay draws first letters, then gets the favicons from here as data
  // URLs: making _favicon web-accessible instead would let any site probe the
  // favicon cache for the user's history. The window loads _favicon itself.
  async #sendOverlayIcons(): Promise<void>
  {
    const icons: Record<string, string> = {};
    await Promise.all(this.#cards.map(async (card) =>
    {
      if (!card.faviconPageUrl) return;
      const dataUrl = await fetchAsBase64(getFaviconUrl(card.faviconPageUrl));
      if (dataUrl) icons[card.id] = dataUrl;
    }));
    if (Object.keys(icons).length > 0) await this.#send({ action: SwitcherMessageAction.ICONS, icons });
  }

  async #openWindow(origin: chrome.windows.Window): Promise<void>
  {
    const cardCount = Math.max(1, Math.min(this.#cards.length, VISIBLE_CARDS));
    const height = cardCount * CARD_HEIGHT + PANEL_PADDING + DEBUG_LINE_HEIGHT + TITLE_BAR_HEIGHT;
    const left = Math.round((origin.left ?? 0) + ((origin.width ?? 1200) - WINDOW_WIDTH) / 2);
    const top = Math.round((origin.top ?? 0) + ((origin.height ?? 800) - height) / 2);

    const created = await chrome.windows.create({
      url: chrome.runtime.getURL('switcher.html'),
      type: 'popup',
      focused: true,
      width: WINDOW_WIDTH,
      height,
      left,
      top,
    });
    if (created.id !== undefined) this.#host = { kind: 'window', windowId: created.id };
  }

  async #closeWindow(windowId: number, originWindowId: number | undefined): Promise<void>
  {
    if (originWindowId !== undefined)
    {
      await chrome.windows.update(originWindowId, { focused: true }).catch(() => { /* window gone */ });
    }
    await chrome.windows.remove(windowId).catch(() => { /* already closed */ });
  }

  // True when the list took the message
  async #send(message: Record<string, unknown>): Promise<boolean>
  {
    const host = this.#host;
    if (!host) return false;
    try
    {
      const response = host.kind === 'overlay'
        ? await chrome.tabs.sendMessage(host.tabId, message)
        : await chrome.runtime.sendMessage(message);
      return response?.ok === true;
    }
    catch
    {
      return false;
    }
  }

  // Hands the pending presses over to the list
  #listData(): SwitcherListData
  {
    return { cards: this.#cards, steps: this.#takePendingSteps(), repeatKeyCode: this.#repeatKeyCode };
  }

  #takePendingSteps(): number
  {
    const steps = this.#pendingSteps;
    this.#pendingSteps = 0;
    return steps;
  }

  #clear(): void
  {
    this.#host = undefined;
    this.#windowReady = false;
    this.#pendingSteps = 0;
  }
}
