// The one owner of page agent chats and runs in a side panel. It lives as long as the panel, not
// the drawer: a run on tab A keeps applying its events to A's chat and saving them while the drawer
// shows tab B or is closed. The hook and the tab lifecycle handlers change chats only through it.

import type { SavedPageStyle } from '../../stores/savedPageStyles.ts';
import { isSameOriginHttpUrl } from '../../utils/aiConfig.ts';
import { withMarker } from '../../utils/pageAgentCss.ts';
import { PageAgentChat } from './pageAgentChat.ts';
import type { PageAgentNotice } from './pageAgentChat.ts';
import type { PageAgentChatStore } from './pageAgentChatStore.ts';
import type {
  PageAgentAppliedCss,
  PageAgentHistoryTurn,
  PageAgentPageAdapter,
  PageAgentRunListener,
  PageAgentRunResult,
} from './pageAgentRun.ts';

/** A started run, as PageAgentRun is one. */
export interface PageAgentLiveRun
{
  run(): Promise<PageAgentRunResult>;
  stop(): void;
}

export interface PageAgentRunStart<Settings>
{
  tabId: number;
  request: string;
  history: PageAgentHistoryTurn[];
  currentCss: string;
  insertedText: string;
  listener: PageAgentRunListener;
  settings: Settings;
}

export type PageAgentRunFactory<Settings> = (start: PageAgentRunStart<Settings>) => PageAgentLiveRun;

/** What Undo, Re-apply, applying a saved style and the marker check do to a page. */
export interface PageAgentChatPage extends Pick<PageAgentPageAdapter, 'insertCss' | 'removeCss' | 'pageUrl'>
{
  /** The applied id of the agent's stylesheet on the page, or '' when the page has none. */
  readMarker(tabId: number): Promise<string>;
}

/** The saved page style of the bookmark or Favorite a tab was opened from. */
export interface PageAgentTabSavedStyle
{
  bookmarkId: string;
  style: SavedPageStyle;
}

export interface PageAgentSavedStyles
{
  /** Read at call time: the tab's association and the saved styles change while the panel is open. */
  styleForTab(tabId: number): PageAgentTabSavedStyle | null;
}

export interface PageAgentChatsOptions<Settings>
{
  store: PageAgentChatStore;
  runFactory: PageAgentRunFactory<Settings>;
  page: PageAgentChatPage;
  /** Without it no tab has a saved style. */
  savedStyles?: PageAgentSavedStyles;
  createId?: () => string;
  debug?: boolean;
}

export class PageAgentChats<Settings>
{
  readonly #store: PageAgentChatStore;
  readonly #runFactory: PageAgentRunFactory<Settings>;
  readonly #page: PageAgentChatPage;
  readonly #savedStyles: PageAgentSavedStyles | null;
  readonly #createId: () => string;
  readonly #debug: boolean;
  readonly #chats = new Map<number, PageAgentChat>();
  readonly #loads = new Map<number, Promise<PageAgentChat>>();
  readonly #runs = new Map<number, PageAgentLiveRun>();
  // Tab ids aren't reused within a browser session, so a closed tab stays closed.
  readonly #closedTabs = new Set<number>();
  readonly #listeners = new Set<() => void>();

  constructor(options: PageAgentChatsOptions<Settings>)
  {
    this.#store = options.store;
    this.#runFactory = options.runFactory;
    this.#page = options.page;
    this.#savedStyles = options.savedStyles ?? null;
    this.#createId = options.createId ?? (() => crypto.randomUUID());
    this.#debug = options.debug ?? false;
  }

  /** The chat if this panel has loaded it. */
  peek(tabId: number): PageAgentChat | undefined
  {
    return this.#chats.get(tabId);
  }

  /** True from Send until the run has finished, also while a stopped run winds down. */
  isRunning(tabId: number): boolean
  {
    return this.#runs.has(tabId);
  }

  /** Loads the tab's chat once and keeps it for the panel's lifetime. */
  async get(tabId: number): Promise<PageAgentChat>
  {
    const cached = this.#chats.get(tabId);
    if (cached)
    {
      return cached;
    }
    if (this.#closedTabs.has(tabId))
    {
      return PageAgentChat.empty(tabId);
    }
    let load = this.#loads.get(tabId);
    if (!load)
    {
      load = this.#load(tabId);
      this.#loads.set(tabId, load);
    }
    return await load;
  }

  /**
   * Runs the agent on the tab for one user message and resolves when the run has ended. Ignored
   * while the tab already has a run: one live run per tab.
   */
  async send(tabId: number, request: string, settings: Settings): Promise<void>
  {
    const text = request.trim();
    if (!text || this.#runs.has(tabId) || this.#closedTabs.has(tabId))
    {
      return;
    }
    const chat = await this.get(tabId);
    if (this.#runs.has(tabId) || !this.#owns(chat))
    {
      return;
    }

    const history = chat.history();
    const turn = chat.startTurn(text);
    let run: PageAgentLiveRun;
    try
    {
      run = this.#runFactory({
        tabId,
        request: text,
        history,
        currentCss: chat.appliedCss,
        insertedText: chat.appliedInsertedText,
        listener: this.#runListener(chat, turn),
        settings,
      });
    }
    catch (error)
    {
      chat.failTurn(turn, errorMessage(error));
      this.#changed(chat);
      return;
    }
    this.#runs.set(tabId, run);
    this.#changed(chat);

    try
    {
      await run.run();
    }
    catch (error)
    {
      if (this.#owns(chat) && chat.turnStatus(turn) === 'running')
      {
        chat.failTurn(turn, errorMessage(error));
        this.#changed(chat);
      }
    }
    finally
    {
      if (this.#runs.get(tabId) === run)
      {
        this.#runs.delete(tabId);
      }
      this.#notify();
    }
  }

  /** The run ends as stopped and reports that through its own onFinished. */
  stop(tabId: number): void
  {
    this.#runs.get(tabId)?.stop();
  }

  /** Removes the applied stylesheet from the page and forgets it. Rejects when the page refused. */
  async undo(tabId: number): Promise<void>
  {
    if (this.#runs.has(tabId))
    {
      return;
    }
    const chat = await this.get(tabId);
    if (!chat.appliedCss && !chat.appliedInsertedText)
    {
      return;
    }
    // Also with a notice set: the marker may have missed a stylesheet that is still there, and
    // removing one that is gone does nothing.
    if (chat.appliedInsertedText)
    {
      await this.#page.removeCss(tabId, chat.appliedInsertedText);
    }
    if (this.#owns(chat))
    {
      chat.clearApplied();
      this.#changed(chat);
    }
  }

  /** Inserts the applied stylesheet again after a reload or on another page of the same site, under a new id. */
  async reapply(tabId: number): Promise<void>
  {
    if (this.#runs.has(tabId))
    {
      return;
    }
    const chat = await this.get(tabId);
    const css = chat.appliedCss;
    if (!css)
    {
      return;
    }
    if (chat.appliedInsertedText)
    {
      await this.#page.removeCss(tabId, chat.appliedInsertedText);
    }
    const appliedId = this.#createId();
    const insertedText = withMarker(css, appliedId);
    const url = await this.#page.pageUrl(tabId);
    await this.#page.insertCss(tabId, insertedText);
    if (this.#owns(chat))
    {
      chat.recordApplied({ css, insertedText, appliedId, url });
      this.#changed(chat);
    }
  }

  /**
   * Puts the tab's saved style on the page as the chat's stylesheet, in place of the chat's own.
   * Rejects when the page refused.
   */
  async applySaved(tabId: number): Promise<void>
  {
    if (this.#runs.has(tabId))
    {
      return;
    }
    const chat = await this.get(tabId);
    const saved = this.#savedStyleFor(tabId);
    if (!saved || this.#runs.has(tabId))
    {
      return;
    }
    const { style } = saved;
    // The background may have inserted it already; a second copy of the same text stays after Undo.
    const marker = await this.#page.readMarker(tabId);
    const url = await this.#page.pageUrl(tabId);
    if (marker !== style.appliedId)
    {
      if (chat.appliedInsertedText)
      {
        await this.#page.removeCss(tabId, chat.appliedInsertedText);
      }
      await this.#page.insertCss(tabId, style.insertedText);
    }
    if (this.#owns(chat))
    {
      chat.recordApplied(savedAsApplied(style, url));
      this.#changed(chat);
    }
  }

  /**
   * Tells whether the page still has the applied stylesheet (a reload or navigation drops it) and
   * sets the chat's notice, or adopts the tab's saved style when the background put it on the
   * page. Only chats this panel has loaded are checked, so a panel never writes the chat of a tab
   * in another window; a chat is checked again when it is shown. Never rejects.
   */
  async checkMarker(tabId: number): Promise<void>
  {
    const chat = this.#chats.get(tabId);
    // During a run the marker can be read between removeCSS and insertCSS.
    if (!chat || this.#runs.has(tabId))
    {
      return;
    }
    const saved = this.#savedStyleFor(tabId);
    // Nothing to check or adopt: no page read on every load, and no notice in an empty chat.
    if (!chat.appliedInsertedText && !saved)
    {
      return;
    }
    const appliedId = chat.appliedId;
    const savedRev = saved?.style.rev ?? null;
    let adopted: PageAgentAppliedCss | null = null;
    let notice: PageAgentNotice = 'none';
    try
    {
      const marker = await this.#page.readMarker(tabId);
      if (saved && marker === saved.style.appliedId && marker !== appliedId)
      {
        // The background's sheet becomes the chat's, so Undo removes it, Show CSS shows it and a
        // run's apply_css replaces it instead of stacking a second sheet.
        adopted = savedAsApplied(saved.style, await this.#page.pageUrl(tabId));
      }
      else if (!chat.appliedInsertedText)
      {
        return;
      }
      else if (marker === appliedId)
      {
        notice = 'none';
      }
      else if (marker === '')
      {
        const url = await this.#page.pageUrl(tabId);
        if (url === chat.appliedUrl)
        {
          notice = 'reloaded';
        }
        else
        {
          notice = isSameOriginHttpUrl(url, chat.appliedUrl) ? 'navigated-same-site' : 'navigated-other-site';
        }
      }
      else
      {
        return;
      }
    }
    catch (error)
    {
      // A page that is loading or can't be scripted; the next check reads it again.
      this.#log('marker check failed', error);
      return;
    }
    // The answer is stale if a run, Re-apply or a new save changed the stylesheet while the page was read.
    if (
      !this.#owns(chat)
      || this.#runs.has(tabId)
      || chat.appliedId !== appliedId
      || (this.#savedStyleFor(tabId)?.style.rev ?? null) !== savedRev
    )
    {
      return;
    }
    if (adopted)
    {
      chat.recordApplied(adopted);
      this.#changed(chat);
    }
    else if (chat.setNotice(notice))
    {
      this.#changed(chat);
    }
  }

  /** Stops the tab's run, ignores its last events, and deletes the stored chat. */
  async tabClosed(tabId: number): Promise<void>
  {
    this.#closedTabs.add(tabId);
    this.#runs.get(tabId)?.stop();
    this.#chats.delete(tabId);
    this.#notify();
    try
    {
      await this.#store.delete(tabId);
    }
    catch (error)
    {
      console.error('[PageAgentChats] failed to delete the chat of a closed tab:', error);
    }
  }

  /** Deletes the stored chats of tabs that no longer exist, for closes no panel saw. */
  async sweep(existingTabIds: Iterable<number>): Promise<void>
  {
    try
    {
      await this.#store.sweep(existingTabIds);
    }
    catch (error)
    {
      console.error('[PageAgentChats] failed to sweep chats of closed tabs:', error);
    }
  }

  subscribe = (listener: () => void): (() => void) =>
  {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  async #load(tabId: number): Promise<PageAgentChat>
  {
    let chat: PageAgentChat;
    try
    {
      chat = (await this.#store.load(tabId)) ?? PageAgentChat.empty(tabId);
    }
    catch (error)
    {
      console.error('[PageAgentChats] failed to load a chat:', error);
      chat = PageAgentChat.empty(tabId);
    }
    this.#loads.delete(tabId);
    if (this.#closedTabs.has(tabId))
    {
      return chat;
    }
    this.#chats.set(tabId, chat);
    this.#notify();
    return chat;
  }

  // Bound to the chat and turn the run was started for, whichever tab the drawer shows.
  #runListener(chat: PageAgentChat, turn: number): PageAgentRunListener
  {
    return {
      onStep: step => this.#apply(chat, () => chat.addStep(turn, step)),
      onConditions: (conditions, replaced) => this.#apply(chat, () => chat.setConditions(turn, conditions, replaced)),
      onCssApplied: applied => this.#apply(chat, () => chat.recordApplied(applied)),
      onFinished: result => this.#apply(chat, () => chat.finishTurn(turn, result)),
    };
  }

  #apply(chat: PageAgentChat, change: () => void): void
  {
    // After tabClosed the stopped run still reports; writing its events would bring the key back.
    if (!this.#owns(chat))
    {
      return;
    }
    change();
    this.#changed(chat);
  }

  #savedStyleFor(tabId: number): PageAgentTabSavedStyle | null
  {
    return this.#savedStyles?.styleForTab(tabId) ?? null;
  }

  #owns(chat: PageAgentChat): boolean
  {
    return !this.#closedTabs.has(chat.tabId) && this.#chats.get(chat.tabId) === chat;
  }

  #changed(chat: PageAgentChat): void
  {
    this.#store.save(chat).catch(error => console.error('[PageAgentChats] failed to save a chat:', error));
    this.#notify();
  }

  #notify(): void
  {
    for (const listener of [...this.#listeners])
    {
      listener();
    }
  }

  #log(...values: unknown[]): void
  {
    if (this.#debug)
    {
      console.log('[page-agent]', ...values);
    }
  }
}

function savedAsApplied(style: SavedPageStyle, url: string): PageAgentAppliedCss
{
  return { css: style.css, insertedText: style.insertedText, appliedId: style.appliedId, url };
}

function errorMessage(error: unknown): string
{
  return error instanceof Error && error.message ? error.message : String(error);
}
