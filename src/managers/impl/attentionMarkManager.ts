// AttentionMarkManager - owns the Mark for Attention marks of tabs and bookmarks.
//
// Background-side implementation of shared/attentionMarkApi.ts. The sidebar
// reaches it through proxies/attentionMarkProxy.ts. Single writer of the
// attentionMarkedTabs and attentionMarkedBookmarks keys: background events
// (tab closed, navigated or moved, bookmark deleted) change the marks too.

import { ManagerId } from '../proxies/messageRouting.ts';
import type { RoutedManager } from '../proxies/messageRouting.ts';
import {
  ATTENTION_MARKED_BOOKMARKS_KEY,
  ATTENTION_MARKED_TABS_KEY,
  ATTENTION_MARKS_CHANGED,
} from '../shared/attentionMarkApi.ts';
import type { AttentionMarkApi, AttentionMarksState } from '../shared/attentionMarkApi.ts';
import { BookmarkMarks, TabMarks } from '../../stores/attentionMarks.ts';
import type { MarkableTabLike } from '../../stores/attentionMarks.ts';

interface BookmarkNodeLike
{
  id: string;
  children?: BookmarkNodeLike[];
}

function collectTreeIds(nodes: readonly BookmarkNodeLike[], ids: Set<string>): Set<string>
{
  for (const node of nodes)
  {
    ids.add(node.id);
    if (node.children) collectTreeIds(node.children, ids);
  }
  return ids;
}

function sameTabMarks(a: TabMarks, b: TabMarks): boolean
{
  const serialize = (marks: TabMarks) => JSON.stringify(marks.toStored().sort((x, y) => x.tabId - y.tabId));
  return serialize(a) === serialize(b);
}

export class AttentionMarkManager implements RoutedManager, AttentionMarkApi
{
  readonly managerId = ManagerId.ATTENTION_MARKS;

  #tabMarks = new TabMarks();
  #bookmarkMarks = new BookmarkMarks();

  // A side whose stored value couldn't be read starts empty and is not written by events, so
  // the unread value isn't overwritten with nothing. The user's next mark change on that side
  // writes it and lifts this. While tab marks aren't loaded, auto-archive doesn't run: it
  // can't tell which tabs to keep.
  #tabMarksLoaded = false;
  #bookmarkMarksLoaded = false;

  #writeTail: Promise<void> = Promise.resolve();

  /** See RoutedManager.dispatch. */
  async dispatch(method: string, message: Record<string, unknown>): Promise<unknown>
  {
    const originId = message.senderId as string | undefined;

    switch (method)
    {
      case 'getState':
        return this.getState();

      case 'markTabs':
        return this.markTabs(message.tabIds as number[], originId);

      case 'clearTabs':
        return this.clearTabs(message.tabIds as number[], originId);

      case 'markBookmarks':
        return this.markBookmarks(message.ids as string[], originId);

      case 'clearBookmarks':
        return this.clearBookmarks(message.ids as string[], originId);

      default:
        throw new Error(`${this.managerId}: unknown method "${method}"`);
    }
  }

  /**
   * Re-attach the stored marks at worker start. `sameBrowserSession` is true on a
   * worker restart (BrowserSessionMarker), when stored tab IDs are exact. Never
   * rejects: each side's failure is logged and leaves that side unloaded.
   */
  async load(sameBrowserSession: boolean): Promise<void>
  {
    await Promise.all([
      this.#loadTabMarks(sameBrowserSession),
      this.#loadBookmarkMarks(),
    ]);
  }

  get tabMarksLoaded(): boolean
  {
    return this.#tabMarksLoaded;
  }

  isTabMarked(tabId: number): boolean
  {
    return this.#tabMarks.isMarked(tabId);
  }

  getState(): AttentionMarksState
  {
    return { tabIds: this.#tabMarks.markedTabIds(), bookmarkIds: this.#bookmarkMarks.markedIds() };
  }

  async markTabs(tabIds: number[], originId?: string): Promise<AttentionMarksState>
  {
    const tabs = await Promise.all(tabIds.map(tabId => chrome.tabs.get(tabId).catch(() => undefined)));
    let changed = false;
    for (const tab of tabs)
    {
      if (tab && this.#tabMarks.mark(tab)) changed = true;
    }
    if (changed) await this.#commitUserTabChange(originId);
    return this.getState();
  }

  async clearTabs(tabIds: number[], originId?: string): Promise<AttentionMarksState>
  {
    let changed = false;
    for (const tabId of tabIds)
    {
      if (this.#tabMarks.clear(tabId)) changed = true;
    }
    if (changed) await this.#commitUserTabChange(originId);
    return this.getState();
  }

  async markBookmarks(ids: string[], originId?: string): Promise<AttentionMarksState>
  {
    if (this.#bookmarkMarks.mark(ids)) await this.#commitUserBookmarkChange(originId);
    return this.getState();
  }

  async clearBookmarks(ids: string[], originId?: string): Promise<AttentionMarksState>
  {
    if (this.#bookmarkMarks.clear(ids)) await this.#commitUserBookmarkChange(originId);
    return this.getState();
  }

  async handleTabRemoved(tabId: number, isWindowClosing: boolean): Promise<void>
  {
    // Quitting the browser closes its windows, and the mark has to outlive that. Records of a
    // window closed for good are dropped at the next worker start, when no live tab matches.
    if (isWindowClosing) return;
    if (!this.#tabMarks.clear(tabId)) return;
    this.#broadcast();
    if (this.#tabMarksLoaded) await this.#writeTabMarks();
  }

  /** A tab navigated or changed window: a marked tab's record follows it so a browser restart can re-match it. */
  async handleTabChanged(tab: MarkableTabLike): Promise<void>
  {
    if (this.#tabMarks.follow(tab) && this.#tabMarksLoaded) await this.#writeTabMarks();
  }

  /** A move or attach shifts the positions of the window's other tabs too: refresh every marked one. */
  async refreshWindowTabs(windowId: number): Promise<void>
  {
    if (this.#tabMarks.markedTabIds().length === 0) return;
    const tabs = await chrome.tabs.query({ windowId });
    let changed = false;
    for (const tab of tabs)
    {
      if (this.#tabMarks.follow(tab)) changed = true;
    }
    if (changed && this.#tabMarksLoaded) await this.#writeTabMarks();
  }

  /** `ids` are a removed bookmark's id and, for a folder, all its descendants'. */
  async handleBookmarksRemoved(ids: string[]): Promise<void>
  {
    if (!this.#bookmarkMarks.clear(ids)) return;
    this.#broadcast();
    if (this.#bookmarkMarksLoaded) await this.#writeBookmarkMarks();
  }

  async #loadTabMarks(sameBrowserSession: boolean): Promise<void>
  {
    let stored: TabMarks;
    let rematched: TabMarks;
    try
    {
      const result = await chrome.storage.local.get(ATTENTION_MARKED_TABS_KEY);
      stored = TabMarks.fromStored(result[ATTENTION_MARKED_TABS_KEY]);
      // After a browser restart or extension reload a stored ID may belong to an unrelated tab
      // now, so it counts only on the record's site
      rematched = stored.markedTabIds().length === 0
        ? stored
        : stored.rematched(await chrome.tabs.query({}), sameBrowserSession ? 'sameWindow' : 'sameWindowAndSite');
    }
    catch (error)
    {
      console.error('[AttentionMarkManager] tab marks not loaded, auto-archive paused until a tab mark changes:', error);
      return;
    }

    this.#tabMarks = rematched;
    this.#tabMarksLoaded = true;

    // Awaited so storage holds only this session's tab IDs before the session marker is set:
    // a later worker restart matches by ID alone and would hand an old ID's mark to whatever
    // tab reuses it.
    if (!sameTabMarks(stored, rematched))
    {
      await this.#writeTabMarks()
        .catch(error => console.error('[AttentionMarkManager] failed to store re-attached tab marks:', error));
    }
  }

  async #loadBookmarkMarks(): Promise<void>
  {
    let stored: BookmarkMarks;
    let kept: BookmarkMarks;
    try
    {
      const result = await chrome.storage.local.get(ATTENTION_MARKED_BOOKMARKS_KEY);
      stored = BookmarkMarks.fromStored(result[ATTENTION_MARKED_BOOKMARKS_KEY]);
      kept = stored.markedIds().length === 0
        ? stored
        : stored.keptIn(collectTreeIds(await chrome.bookmarks.getTree(), new Set()));
    }
    catch (error)
    {
      console.error('[AttentionMarkManager] bookmark marks not loaded:', error);
      return;
    }

    this.#bookmarkMarks = kept;
    this.#bookmarkMarksLoaded = true;

    if (kept.markedIds().length !== stored.markedIds().length)
    {
      await this.#writeBookmarkMarks()
        .catch(error => console.error('[AttentionMarkManager] failed to store kept bookmark marks:', error));
    }
  }

  async #commitUserTabChange(originId?: string): Promise<void>
  {
    this.#tabMarksLoaded = true;
    this.#broadcast(originId);
    await this.#writeTabMarks();
  }

  async #commitUserBookmarkChange(originId?: string): Promise<void>
  {
    this.#bookmarkMarksLoaded = true;
    this.#broadcast(originId);
    await this.#writeBookmarkMarks();
  }

  #writeTabMarks(): Promise<void>
  {
    return this.#write(ATTENTION_MARKED_TABS_KEY, () => this.#tabMarks.toStored());
  }

  #writeBookmarkMarks(): Promise<void>
  {
    return this.#write(ATTENTION_MARKED_BOOKMARKS_KEY, () => this.#bookmarkMarks.toStored());
  }

  // Writes run one at a time and each takes the key's value from memory when it runs, so an
  // older write can't land after a newer one
  #write(key: string, value: () => unknown): Promise<void>
  {
    const result = this.#writeTail.then(() => chrome.storage.local.set({ [key]: value() }));
    this.#writeTail = result.catch(() => {});
    return result;
  }

  // senderId lets the context that asked for the change skip its own echo (CONTEXT_ID in messageRouting.ts)
  #broadcast(originId?: string): void
  {
    chrome.runtime.sendMessage({
      action: ATTENTION_MARKS_CHANGED,
      state: this.getState(),
      senderId: originId,
    }).catch(() =>
    {
      // No sidebar open
    });
  }
}
