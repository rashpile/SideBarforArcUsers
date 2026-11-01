import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { PageAgentChatData } from '../services/pageAgent/pageAgentChat';
import type { PageAgentChats } from '../services/pageAgent/pageAgentChats';

export interface PageAgentChatView<Settings>
{
  /** Undefined while the chat loads and when there is no tab. */
  chat: PageAgentChatData | undefined;
  /** True while the tab has a run, including the moments a stopped run needs to wind down. */
  running: boolean;
  /** Why the last drawer action failed; shown only for the tab it happened on, until the next action. */
  actionError: string | null;
  send(text: string, settings: Settings): void;
  stop(): void;
  undo(): void;
  reapply(): void;
  /** Puts the tab's saved page style on the page as the chat's stylesheet. */
  applySaved(): void;
  /** Shows an answered turn's answer in a popup on the tab's page. */
  showOnPage(turnIndex: number): void;
  /**
   * Runs another drawer action for this tab (saving its style, say); a failure shows in
   * actionError as "<label> failed: <reason>", like Undo's.
   */
  runAction(label: string, action: () => Promise<unknown>): void;
}

interface TabError
{
  tabId: number;
  message: string;
}

/**
 * The chat of one tab, read from the panel's PageAgentChats. The chats outlive this hook: a run
 * keeps going and saving when the drawer switches to another tab or closes.
 */
export function usePageAgentChat<Settings>(
  chats: PageAgentChats<Settings>,
  tabId: number | undefined,
  /** The rev of the tab's saved page style, or null when the tab's bookmark has none. */
  savedStyleRev: string | null = null,
): PageAgentChatView<Settings>
{
  // chat.data keeps its identity until the chat changes, so it is a stable snapshot.
  const chat = useSyncExternalStore(
    chats.subscribe,
    () => (tabId === undefined ? undefined : chats.peek(tabId)?.data),
  );
  const running = useSyncExternalStore(
    chats.subscribe,
    () => tabId !== undefined && chats.isRunning(tabId),
  );
  const [actionError, setActionError] = useState<TabError | null>(null);

  // A reload while the drawer was closed or showed another tab went unseen, and tabs.onUpdated
  // isn't reliable in the side panel, so the chat is checked whenever it is shown (checkMarker
  // reads the page only for a chat with applied CSS or a tab with a saved style). It is checked
  // again when the tab's saved style changes: the styles can load after the drawer opened.
  useEffect(() =>
  {
    if (tabId === undefined)
    {
      return;
    }
    chats.get(tabId)
      .then(() => chats.checkMarker(tabId))
      .catch(error => console.error('[usePageAgentChat] failed to load a chat:', error));
  }, [chats, tabId, savedStyleRev]);

  const send = useCallback((text: string, settings: Settings) =>
  {
    if (tabId === undefined)
    {
      return;
    }
    setActionError(null);
    chats.send(tabId, text, settings)
      .catch(error => console.error('[usePageAgentChat] run failed:', error));
  }, [chats, tabId]);

  const stop = useCallback(() =>
  {
    if (tabId !== undefined)
    {
      chats.stop(tabId);
    }
  }, [chats, tabId]);

  const runAction = useCallback((label: string, action: () => Promise<unknown>) =>
  {
    if (tabId === undefined)
    {
      return;
    }
    setActionError(null);
    action()
      .catch(error => setActionError({ tabId, message: `${label} failed: ${errorMessage(error)}` }));
  }, [tabId]);

  const undo = useCallback(() =>
  {
    if (tabId !== undefined)
    {
      runAction('Undo', () => chats.undo(tabId));
    }
  }, [chats, tabId, runAction]);

  const reapply = useCallback(() =>
  {
    if (tabId !== undefined)
    {
      runAction('Re-apply', () => chats.reapply(tabId));
    }
  }, [chats, tabId, runAction]);

  const applySaved = useCallback(() =>
  {
    if (tabId !== undefined)
    {
      runAction('Apply', () => chats.applySaved(tabId));
    }
  }, [chats, tabId, runAction]);

  const showOnPage = useCallback((turnIndex: number) =>
  {
    if (tabId !== undefined)
    {
      runAction('Show on page', () => chats.showOnPage(tabId, turnIndex));
    }
  }, [chats, tabId, runAction]);

  return {
    chat,
    running,
    actionError: actionError !== null && actionError.tabId === tabId ? actionError.message : null,
    send,
    stop,
    undo,
    reapply,
    applySaved,
    showOnPage,
    runAction,
  };
}

function errorMessage(error: unknown): string
{
  return error instanceof Error && error.message ? error.message : String(error);
}
