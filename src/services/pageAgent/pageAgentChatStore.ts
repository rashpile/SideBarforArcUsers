// Page agent chats in chrome.storage.session, one key per tab. Session storage matches tab ids:
// both last for one browser session. Writes go through one queue, so the save of a later event
// never lands before an earlier one, and a delete after a save stays deleted.

import { PageAgentChat } from './pageAgentChat.ts';

export const PAGE_AGENT_CHAT_KEY_PREFIX = 'pageAgentChat:';

/** The part of chrome.storage.session the store needs. */
export interface PageAgentChatStorageArea
{
  get(keys: string | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

const chatKey = (tabId: number): string => `${PAGE_AGENT_CHAT_KEY_PREFIX}${tabId}`;

export class PageAgentChatStore
{
  readonly #area: PageAgentChatStorageArea;
  #tail: Promise<void> = Promise.resolve();

  constructor(area: PageAgentChatStorageArea)
  {
    this.#area = area;
  }

  /** The stored chat of the tab, or null when there is none. Reads after the queued writes. */
  async load(tabId: number): Promise<PageAgentChat | null>
  {
    await this.#tail;
    const key = chatKey(tabId);
    const result = await this.#area.get(key);
    return PageAgentChat.fromStored(result[key], tabId);
  }

  save(chat: PageAgentChat): Promise<void>
  {
    // Taken now: the chat keeps changing while the write waits in the queue.
    const items = { [chatKey(chat.tabId)]: chat.toStored() };
    return this.#enqueue(() => this.#area.set(items));
  }

  delete(tabId: number): Promise<void>
  {
    return this.#enqueue(() => this.#area.remove(chatKey(tabId)));
  }

  /** Deletes the chats of tabs that no longer exist; other keys stay. */
  sweep(existingTabIds: Iterable<number>): Promise<void>
  {
    const existing = new Set(existingTabIds);
    return this.#enqueue(async () =>
    {
      const all = await this.#area.get(null);
      const stale = Object.keys(all).filter(key =>
        key.startsWith(PAGE_AGENT_CHAT_KEY_PREFIX) &&
        !existing.has(Number(key.slice(PAGE_AGENT_CHAT_KEY_PREFIX.length))));
      if (stale.length > 0)
      {
        await this.#area.remove(stale);
      }
    });
  }

  #enqueue(task: () => Promise<void>): Promise<void>
  {
    const result = this.#tail.then(task, task);
    this.#tail = result.catch(() => {});
    return result;
  }
}
