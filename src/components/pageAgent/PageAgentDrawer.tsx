import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import clsx from 'clsx';
import { Camera, KeyRound, Paintbrush, Play, Send, Settings, Sparkles, Square, Trash2, X } from 'lucide-react';
import { bookmarkTreeStore } from '../../hooks/useBookmarks';
import { useChromeLocalStorage } from '../../hooks/useChromeLocalStorage';
import { usePageAgentChat } from '../../hooks/usePageAgentChat';
import type { PageStyleActions } from '../../hooks/usePageStyles';
import type { PageAgentChats } from '../../services/pageAgent/pageAgentChats';
import type { SavedPageStyle } from '../../stores/savedPageStyles';
import type { AiRenameSettings } from '../../utils/aiConfig';
import { PageAgentMessages } from './PageAgentMessages';

export const PAGE_AGENT_DRAWER_HEIGHT_KEY = 'pageAgentDrawerHeight';

// Keeps both the drawer and the tab list above it usable.
const MIN_PART_HEIGHT = 160;
const DEFAULT_HEIGHT_RATIO = 0.45;
const PAGE_ORIGINS: readonly string[] = ['http://*/*', 'https://*/*'];
// captureVisibleTab needs <all_urls> (or activeTab, which a side panel never gets).
const SCREENSHOT_ORIGINS: readonly string[] = ['<all_urls>'];

interface PageAgentDrawerProps
{
  chats: PageAgentChats<AiRenameSettings>;
  /** This window's active tab; the drawer shows its chat and follows tab switches. */
  tabId: number | undefined;
  tabUrl: string | undefined;
  /** The bookmark or Favorite the active tab was opened from, or null for a tab of its own. */
  bookmarkId: string | null;
  /** The page style saved to that bookmark, or null. */
  savedStyle: SavedPageStyle | null;
  pageStyles: PageStyleActions;
  aiSettings: AiRenameSettings;
  onOpenSettings: () => void;
  onClose: () => void;
}

/** Why the input is disabled, in the order the user has to fix them. */
type InputBlock =
  | { kind: 'no-tab' }
  | { kind: 'page'; reason: string }
  | { kind: 'settings' }
  | { kind: 'page-access' };

export const PageAgentDrawer: React.FC<PageAgentDrawerProps> = ({
  chats,
  tabId,
  tabUrl,
  bookmarkId,
  savedStyle,
  pageStyles,
  aiSettings,
  onOpenSettings,
  onClose,
}) =>
{
  const { chat, running, actionError, send, stop, undo, reapply, applySaved, runAction } =
    usePageAgentChat(chats, tabId, savedStyle?.rev ?? null);
  const bookmarkTitle = useBookmarkTitle(bookmarkId);
  const [hasPageAccess, requestPageAccess] = useOriginsGranted(PAGE_ORIGINS);
  const [hasScreenshotAccess, requestScreenshotAccess] = useOriginsGranted(SCREENSHOT_ORIGINS);
  const { height, startResize } = useDrawerHeight();
  const [draft, setDraft] = useState('');

  const block = inputBlock(tabId, tabUrl, aiSettings, hasPageAccess);
  const canSend = block === null && !running && draft.trim() !== '';

  const submit = () =>
  {
    if (!canSend)
    {
      return;
    }
    send(draft, aiSettings);
    setDraft('');
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) =>
  {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing)
    {
      event.preventDefault();
      submit();
    }
  };

  // Saved with the URL the CSS was applied on: its origin is the site the style comes back on.
  const saveStyle = () =>
  {
    if (bookmarkId !== null && chat)
    {
      const { appliedCss, appliedUrl } = chat;
      runAction('Save', () => pageStyles.save(bookmarkId, appliedCss, appliedUrl));
    }
  };

  const setAutoApply = (on: boolean) =>
  {
    if (bookmarkId !== null)
    {
      runAction('Auto-apply', () => pageStyles.setAutoApply(bookmarkId, on));
    }
  };

  const removeStyle = () =>
  {
    if (bookmarkId !== null)
    {
      runAction('Remove', () => pageStyles.remove(bookmarkId));
    }
  };

  return (
    <div
      className="shrink-0 flex flex-col border-t border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 text-[0.9em]"
      style={{ height }}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the page agent"
        className="h-1.5 shrink-0 cursor-row-resize touch-none hover:bg-blue-200 dark:hover:bg-blue-800"
        onPointerDown={startResize}
      />

      <div className="flex items-center gap-1.5 px-2 pb-1">
        <Sparkles size={14} className="shrink-0 text-blue-500" />
        <span className="shrink-0 font-medium">Page agent</span>
        <span className="shrink-0 text-[0.85em] text-gray-400">experimental</span>
        <TabChip url={tabId === undefined ? undefined : tabUrl} />
        <button
          type="button"
          onClick={onClose}
          title="Close the page agent"
          className="shrink-0 p-0.5 rounded text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-200 dark:hover:bg-gray-700"
        >
          <X size={14} />
        </button>
      </div>

      {bookmarkId !== null && (
        <StyleStrip
          title={bookmarkTitle}
          savedStyle={savedStyle}
          stylesheet={chat?.appliedCss}
          running={running}
          onSetAutoApply={setAutoApply}
          onApply={applySaved}
          onRemove={removeStyle}
        />
      )}

      {/* Keyed by tab, so expanded steps and Show CSS don't carry over to another tab's chat. */}
      <PageAgentMessages
        key={tabId ?? 'none'}
        chat={chat}
        running={running}
        actionError={actionError}
        hasBookmark={bookmarkId !== null}
        savedStyle={savedStyle}
        onUndo={undo}
        onReapply={reapply}
        onSave={saveStyle}
      />

      <div className="shrink-0 border-t border-gray-200 dark:border-gray-700 px-2 py-1.5 space-y-1.5">
        {block && (
          <BlockNotice block={block} onOpenSettings={onOpenSettings} onRequestPageAccess={requestPageAccess} />
        )}
        {!block && aiSettings.acceptsImages && hasScreenshotAccess === false && (
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
            <span className="flex-1">Screenshots need access to all pages; without it the agent checks numbers only.</span>
            <button type="button" onClick={requestScreenshotAccess} className={actionButtonClass}>
              <Camera size={12} />
              Grant screenshot access
            </button>
          </div>
        )}
        <div className="flex items-end gap-1.5">
          <textarea
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={block !== null}
            rows={2}
            placeholder={block ? '' : 'Describe the change, e.g. “make the video full width”'}
            className="flex-1 min-w-0 resize-none rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-1.5 py-1 outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
          {running ? (
            <button
              type="button"
              onClick={stop}
              title="Stop the agent"
              className="shrink-0 inline-flex items-center gap-1 px-2 py-1.5 rounded bg-red-500 text-white hover:bg-red-600"
            >
              <Square size={12} />
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              title="Send (Enter)"
              className="shrink-0 inline-flex items-center gap-1 px-2 py-1.5 rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send size={12} />
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const actionButtonClass = 'shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600 ' +
  'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

interface StyleStripProps
{
  title: string;
  savedStyle: SavedPageStyle | null;
  /** The chat's current stylesheet; undefined while the chat loads. */
  stylesheet: string | undefined;
  running: boolean;
  onSetAutoApply: (on: boolean) => void;
  onApply: () => void;
  onRemove: () => void;
}

/**
 * The tab's bookmark and the style saved to it. Toggle and Remove change only later page loads;
 * the page in front of the user changes through Apply and Undo.
 */
const StyleStrip: React.FC<StyleStripProps> = ({
  title,
  savedStyle,
  stylesheet,
  running,
  onSetAutoApply,
  onApply,
  onRemove,
}) =>
{
  const waitTitle = 'Wait until the agent has finished';
  // By CSS text, not applied id: right after a save the sheet on the page still has the run's id.
  const showApply = savedStyle !== null && stylesheet !== undefined && stylesheet !== savedStyle.css;

  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-2 pb-1 text-[0.85em] text-gray-600 dark:text-gray-300">
      <Paintbrush size={12} className={clsx('shrink-0', savedStyle ? 'text-blue-500' : 'text-gray-400')} />
      <span className="min-w-0 flex-1 truncate" title={title}>{title}</span>
      <span className="shrink-0 text-gray-500 dark:text-gray-400">{savedStyle ? 'style saved' : 'no saved style'}</span>
      {savedStyle && (
        <span className="shrink-0 flex items-center gap-1.5">
          <label
            className={clsx('inline-flex items-center gap-1', running ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer')}
            title={running ? waitTitle : 'Apply the saved style whenever a page of this site loads in the bookmark’s tab'}
          >
            <input
              type="checkbox"
              checked={savedStyle.autoApply}
              disabled={running}
              onChange={event => onSetAutoApply(event.target.checked)}
              className="rounded border-gray-300 dark:border-gray-600"
            />
            Auto-apply
          </label>
          {showApply && (
            <button
              type="button"
              className={actionButtonClass}
              disabled={running}
              title={running ? waitTitle : 'Put the saved style on this page in place of the current one'}
              onClick={onApply}
            >
              <Play size={12} />
              Apply
            </button>
          )}
          <button
            type="button"
            className={actionButtonClass}
            disabled={running}
            title={running ? waitTitle : 'Delete the saved style; this page keeps its look until a reload or Undo'}
            onClick={onRemove}
          >
            <Trash2 size={12} />
            Remove
          </button>
        </span>
      )}
    </div>
  );
};

/** The title of a bookmark or Favorite, kept current through renames; a placeholder for an untitled one. */
function useBookmarkTitle(bookmarkId: string | null): string
{
  const tree = useSyncExternalStore(bookmarkTreeStore.subscribe, bookmarkTreeStore.getSnapshot);
  return useMemo(() =>
  {
    const title = bookmarkId === null ? null : findBookmarkTitle(tree.bookmarks, bookmarkId);
    return title || 'Untitled bookmark';
  }, [tree, bookmarkId]);
}

function findBookmarkTitle(nodes: readonly chrome.bookmarks.BookmarkTreeNode[], id: string): string | null
{
  for (const node of nodes)
  {
    if (node.id === id)
    {
      return node.title;
    }
    const title = node.children ? findBookmarkTitle(node.children, id) : null;
    if (title !== null)
    {
      return title;
    }
  }
  return null;
}

const TabChip: React.FC<{ url: string | undefined }> = ({ url }) =>
{
  const label = url ? hostAndPath(url) : 'No tab';
  return (
    <span
      title={url ?? ''}
      className="min-w-0 flex-1 truncate rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-[0.85em] text-gray-600 dark:text-gray-300"
    >
      {label}
    </span>
  );
};

const BlockNotice: React.FC<{
  block: InputBlock;
  onOpenSettings: () => void;
  onRequestPageAccess: () => void;
}> = ({ block, onOpenSettings, onRequestPageAccess }) =>
{
  switch (block.kind)
  {
    case 'no-tab':
      return <p className="text-gray-500 dark:text-gray-400">No active tab in this window.</p>;
    case 'page':
      return <p className="text-gray-500 dark:text-gray-400">{block.reason}</p>;
    case 'settings':
      return (
        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
          <span className="flex-1">Set the AI Base URL, API key and model first.</span>
          <button type="button" onClick={onOpenSettings} className={actionButtonClass}>
            <Settings size={12} />
            Open Settings
          </button>
        </div>
      );
    case 'page-access':
      return (
        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
          <span className="flex-1">The agent needs access to http and https pages to read and change them.</span>
          <button type="button" onClick={onRequestPageAccess} className={actionButtonClass}>
            <KeyRound size={12} />
            Grant page access
          </button>
        </div>
      );
  }
};

function inputBlock(
  tabId: number | undefined,
  tabUrl: string | undefined,
  settings: AiRenameSettings,
  hasPageAccess: boolean | null,
): InputBlock | null
{
  if (tabId === undefined)
  {
    return { kind: 'no-tab' };
  }
  const reason = unscriptablePageReason(tabUrl);
  if (reason)
  {
    return { kind: 'page', reason };
  }
  if (!settings.baseUrl.trim() || !settings.apiKey.trim() || !settings.model.trim())
  {
    return { kind: 'settings' };
  }
  // Unknown while the check runs; a run without access would end with the page's error anyway.
  if (hasPageAccess === false)
  {
    return { kind: 'page-access' };
  }
  return null;
}

// PDF viewers and other extensions' pages can't be told by URL alone; there the run shows the error.
function unscriptablePageReason(url: string | undefined): string | null
{
  let parsed: URL;
  try
  {
    parsed = new URL(url ?? '');
  }
  catch
  {
    return 'This tab has no page the agent can change yet.';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
  {
    return 'The page agent works only on http and https pages.';
  }
  if (parsed.hostname === 'chromewebstore.google.com' ||
    (parsed.hostname === 'chrome.google.com' && parsed.pathname.startsWith('/webstore')))
  {
    return 'Chrome doesn’t let extensions change the Chrome Web Store.';
  }
  return null;
}

function hostAndPath(url: string): string
{
  try
  {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? `${parsed.host}${parsed.pathname}`
      : url;
  }
  catch
  {
    return url;
  }
}

/**
 * Whether the optional host permissions are granted (null until the first check), and a request
 * for them. Follows grants and removals made elsewhere, such as in Settings.
 */
function useOriginsGranted(origins: readonly string[]): [boolean | null, () => void]
{
  const [granted, setGranted] = useState<boolean | null>(null);

  useEffect(() =>
  {
    let mounted = true;
    const check = () =>
    {
      chrome.permissions.contains({ origins: [...origins] })
        .then(result =>
        {
          if (mounted)
          {
            setGranted(result);
          }
        })
        .catch(() =>
        {
          if (mounted)
          {
            setGranted(false);
          }
        });
    };
    // The installed @types/chrome leaves removeListener off these events; Chrome has it.
    const events = [chrome.permissions.onAdded, chrome.permissions.onRemoved] as unknown as chrome.events.Event<() => void>[];
    check();
    events.forEach(event => event.addListener(check));
    return () =>
    {
      mounted = false;
      events.forEach(event => event.removeListener(check));
    };
  }, [origins]);

  // Called straight from the click: Chrome asks only during a user gesture.
  const request = useCallback(() =>
  {
    chrome.permissions.request({ origins: [...origins] })
      .then(setGranted)
      .catch(error => console.error('[PageAgentDrawer] permission request failed:', error));
  }, [origins]);

  return [granted, request];
}

/** The drawer height: dragged live, stored when the drag ends, clamped to the panel. */
function useDrawerHeight(): { height: number; startResize: (event: React.PointerEvent<HTMLDivElement>) => void }
{
  const [storedHeight, setStoredHeight] = useChromeLocalStorage<number | null>(
    PAGE_AGENT_DRAWER_HEIGHT_KEY,
    null,
    { parse: parseStoredHeight, serialize: value => (value === null ? '' : String(Math.round(value))) },
  );
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const panelHeight = usePanelHeight();

  const height = clampHeight(dragHeight ?? storedHeight ?? panelHeight * DEFAULT_HEIGHT_RATIO, panelHeight);

  const startResize = (event: React.PointerEvent<HTMLDivElement>) =>
  {
    if (event.button !== 0)
    {
      return;
    }
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startHeight = height;
    let latest = height;

    // The drawer grows upwards, so dragging up (a smaller clientY) makes it taller.
    const onMove = (moveEvent: PointerEvent) =>
    {
      latest = clampHeight(startHeight + startY - moveEvent.clientY, window.innerHeight);
      setDragHeight(latest);
    };
    // Stored once per drag, not on every move: each write reaches every window's panel.
    const onEnd = () =>
    {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onEnd);
      handle.removeEventListener('pointercancel', onEnd);
      setDragHeight(null);
      setStoredHeight(latest);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onEnd);
    handle.addEventListener('pointercancel', onEnd);
  };

  return { height, startResize };
}

function usePanelHeight(): number
{
  const [height, setHeight] = useState(() => window.innerHeight);
  useEffect(() =>
  {
    const onResize = () => setHeight(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return height;
}

function clampHeight(height: number, panelHeight: number): number
{
  return Math.round(Math.max(MIN_PART_HEIGHT, Math.min(height, panelHeight - MIN_PART_HEIGHT)));
}

function parseStoredHeight(value: string): number | null
{
  const height = Number.parseInt(value, 10);
  return Number.isFinite(height) && height > 0 ? height : null;
}
