// TaskSpaceArchiver - archives Task Spaces left unused for the "Archive Task Spaces after"
// period: saves the tabs whose page would otherwise be lost to the Space's `asd_Archive`,
// moves the Space to the archived list and closes its tabs. The bookmark folder stays.
//
// Runs in the background, so it works with the sidebar closed: at worker start (unless a run
// started recently), on its own chrome.alarms alarm while the setting is on, and at once when
// the setting changes to a period. Every task goes through the queue shared with
// TabAutoArchiver. Which Task Spaces archive is decided by selectTaskSpacesToArchive
// (utils/taskSpaceArchive.ts), what happens to each tab by closingTabAction
// (utils/autoArchivePolicy.ts). Chrome APIs are injected, so the run can be tested under Node.

import type { Space } from '../utils/spaceMessages.ts';
import type { SerialQueue } from '../utils/serialQueue.ts';
import type { TaskSpaceLastUse } from '../stores/taskSpaceLastUse.ts';
import type { ArchivedPage } from '../utils/archiveFolder.ts';
import type { AutoArchiveTabLike } from '../utils/autoArchivePolicy.ts';
import type { TaskSpaceArchivePeriod } from '../utils/taskSpaceArchive.ts';
import {
  closingTabAction,
  isAlwaysKept,
  SavedPages,
  SplitViewsOnScreen,
  TabAssociationsByWindow,
  tabChangedDuringRun,
  tabPageUrl,
} from '../utils/autoArchivePolicy.ts';
import { isSystemFolder } from '../utils/archiveFolder.ts';
import { findFolderBySegments, isInAccountStorage } from '../utils/bookmarkFolderLookup.ts';
import { findSpaceForFolderSegments } from '../utils/spaceFolderMatch.ts';
import { allFavoriteUrls } from '../utils/spaceFavorites.ts';
import { getEffectiveTabUrl } from '../utils/parkedTabAssociation.ts';
import { BOOKMARK_ITEM_KEY_PREFIX } from '../utils/tabAssociations.ts';
import {
  parseTaskSpaceArchivePeriod,
  selectTaskSpacesToArchive,
  taskSpaceArchivePeriodMs,
} from '../utils/taskSpaceArchive.ts';
import { MINUTE_MS } from '../utils/time.ts';

type BookmarkNode = chrome.bookmarks.BookmarkTreeNode;

/** A tab of a normal window, as the archiver judges it. */
export interface ArchiverTab extends AutoArchiveTabLike
{
  id: number;
  title?: string;
}

/** The chrome.alarms calls the archiver makes. */
export interface ArchiverAlarms
{
  get: (name: string) => Promise<{ periodInMinutes?: number } | undefined>;
  create: (name: string, info: { periodInMinutes: number }) => Promise<void>;
  clear: (name: string) => Promise<unknown>;
}

/** chrome.storage.session, for the time of the last run. */
export interface ArchiverSession
{
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (values: Record<string, unknown>) => Promise<void>;
}

/** What the archiver needs from the rest of the background. */
export interface TaskSpaceArchiverDeps
{
  /** Shared with TabAutoArchiver, so the two never save into one Space's archive at once. */
  queue: SerialQueue;
  /** Resolves once the startup restore ended: true when it succeeded (TabAssociationReadiness.wait). */
  startupRestoreSucceeded: () => Promise<boolean>;
  /** False when the stored tab marks failed to load: marked tabs are unknown, so a run archives nothing. */
  tabMarksLoaded: () => boolean;
  /** True for a tab marked for attention; a Space with a marked tab stays. */
  isTabMarked: (tabId: number) => boolean;
  /** The stored "Archive Task Spaces after" setting. */
  readPeriod: () => Promise<TaskSpaceArchivePeriod>;
  /** The live Spaces (SpaceManager). */
  getSpaces: () => readonly Space[];
  readLastUse: () => Promise<Pick<TaskSpaceLastUse, 'lastUsedAt'>>;
  /** The active Space of every open window. */
  activeSpaceIds: () => Promise<Iterable<string>>;
  /** The tabs of normal windows. */
  queryTabs: () => Promise<ArchiverTab[]>;
  /** The tab as it is now; undefined when it is closed. */
  getTab: (tabId: number) => Promise<AutoArchiveTabLike | undefined>;
  /** The Space a tab belongs to (TabSpaceRegistry). */
  spaceOf: (windowId: number, tabId: number) => string | undefined;
  /** A window's tab associations: tab ID -> `bookmark-…` / `pinned-…`. */
  associationsOf: (windowId: number) => Promise<Readonly<Record<number, string>>>;
  /** chrome.bookmarks.getTree. */
  getTree: () => Promise<BookmarkNode[]>;
  /** Save a page at the top of the Space folder's `asd_Archive` (SpaceArchive.archive). */
  archivePage: (folderId: string, page: ArchivedPage) => Promise<unknown>;
  /** Move the live Task Spaces to the archived list (SpaceManager.archiveTaskSpaces). */
  archiveSpaces: (ids: string[], now: number) => Promise<void>;
  /** Called right before the archiver closes tabs, so the closes aren't recorded as Recently Closed. */
  beforeClose: (tabIds: number[]) => void;
  removeTabs: (tabIds: number[]) => Promise<void>;
  alarms: ArchiverAlarms;
  session: ArchiverSession;
  now: () => number;
  /** DEV build: debug logs, the 1-minute test period and a 1-minute alarm. */
  debug: boolean;
}

/** What one run judges every selected Task Space by. */
interface RunSnapshot
{
  startedAt: number;
  spaces: readonly Space[];
  roots: BookmarkNode[];
  tabs: readonly ArchiverTab[];
  associations: TabAssociationsByWindow;
  savedPages: SavedPages;
  splitViewsOnScreen: SplitViewsOnScreen;
}

// Bookmarks whose tabs belong to the Space: those in its folder's subtree, without the system
// folders (their tabs belong to the Archive section and the Favorites grid) and without the
// subfolders another Space owns first, as BookmarkSpaceResolver decides (a shared or nested
// folder, see "One folder, one Space" in CLAUDE.md)
function ownedBookmarkIds(folder: BookmarkNode, space: Space, spaces: readonly Space[]): Set<string>
{
  const ids = new Set<string>();
  const walk = (node: BookmarkNode, segments: string[]): void =>
  {
    if (findSpaceForFolderSegments(segments, spaces, isInAccountStorage(node))?.id !== space.id) return;

    // Bookmarks count; folders other than the system folders are walked into
    for (const child of node.children ?? [])
    {
      if (child.url) ids.add(child.id);
      else if (!isSystemFolder(child)) walk(child, [...segments, child.title]);
    }
  };

  walk(folder, space.bookmarkFolderSegments ?? []);
  return ids;
}

export class TaskSpaceArchiver
{
  static readonly ALARM_NAME = 'task-space-archive';
  /** chrome.storage.session: epoch millis the last run started. */
  static readonly LAST_RUN_KEY = 'taskSpaceArchiveLastRunAt';

  #deps: TaskSpaceArchiverDeps;
  // The shortest release period is a day, so half an hour of delay doesn't matter; DEV builds
  // check every minute for the 1-minute test period
  #alarmPeriodMinutes: number;

  constructor(deps: TaskSpaceArchiverDeps)
  {
    this.#deps = deps;
    this.#alarmPeriodMinutes = deps.debug ? 1 : 30;
  }

  /**
   * Worker start: schedule the alarm to match the setting, then run once - unless a run
   * started less than one alarm period ago. Tab events wake the worker often; the alarm keeps
   * the schedule.
   */
  start(): Promise<void>
  {
    return this.#enqueue('start', async () =>
    {
      await this.#syncAlarm(await this.#deps.readPeriod());
      if (await this.#ranWithin(this.#alarmPeriodMinutes * MINUTE_MS)) return;
      await this.#archiveUnusedTaskSpaces();
    });
  }

  /** Alarm tick. Skipped within half a period of another run, e.g. the worker-start run of the worker this alarm woke. */
  run(): Promise<void>
  {
    return this.#enqueue('run', async () =>
    {
      if (await this.#ranWithin(this.#alarmPeriodMinutes * MINUTE_MS / 2)) return;
      await this.#archiveUnusedTaskSpaces();
    });
  }

  /**
   * chrome.storage.onChanged for `taskSpaceArchiveAfter`: the alarm follows the setting, and a
   * change to a period archives the Task Spaces already overdue at once.
   */
  handleSettingChange(change: { newValue?: unknown }): Promise<void>
  {
    return this.#enqueue('setting change', async () =>
    {
      const period = parseTaskSpaceArchivePeriod(change.newValue, this.#deps.debug);
      await this.#syncAlarm(period);
      if (period !== 'never') await this.#archiveUnusedTaskSpaces();
    });
  }

  #enqueue(label: string, task: () => Promise<void>): Promise<void>
  {
    return this.#deps.queue.run(`[TaskSpaceArchiver] ${label}`, task);
  }

  #log(message: string): void
  {
    if (this.#deps.debug)
    {
      console.log(`[TaskSpaceArchiver] ${message}`);
    }
  }

  // True when a run started less than `ms` ago in this browser session
  async #ranWithin(ms: number): Promise<boolean>
  {
    const result = await this.#deps.session.get(TaskSpaceArchiver.LAST_RUN_KEY);
    const lastRunAt = result[TaskSpaceArchiver.LAST_RUN_KEY];
    return typeof lastRunAt === 'number' && this.#deps.now() - lastRunAt < ms;
  }

  // The alarm exists only while the setting is on. An alarm that already has the right
  // interval is kept: creating it again would restart its countdown.
  async #syncAlarm(period: TaskSpaceArchivePeriod): Promise<void>
  {
    const { alarms } = this.#deps;
    if (period === 'never')
    {
      await alarms.clear(TaskSpaceArchiver.ALARM_NAME);
      return;
    }

    const existing = await alarms.get(TaskSpaceArchiver.ALARM_NAME);
    if (existing?.periodInMinutes === this.#alarmPeriodMinutes) return;
    await alarms.create(TaskSpaceArchiver.ALARM_NAME, { periodInMinutes: this.#alarmPeriodMinutes });
  }

  async #archiveUnusedTaskSpaces(): Promise<void>
  {
    // Bookmark and Favorite tabs are known only after the startup restore; if it failed, a
    // Space's tabs and which of them hold a saved page are unknown
    if (!await this.#deps.startupRestoreSucceeded())
    {
      this.#log('skipped: startup restore of tab associations failed');
      return;
    }

    // With the marks unknown, any tab of the Space could be one the user marked
    if (!this.#deps.tabMarksLoaded())
    {
      this.#log('skipped: tab attention marks failed to load');
      return;
    }

    const periodMs = taskSpaceArchivePeriodMs(await this.#deps.readPeriod());
    if (periodMs === null) return;

    const startedAt = this.#deps.now();
    await this.#deps.session.set({ [TaskSpaceArchiver.LAST_RUN_KEY]: startedAt });

    const spaces = this.#deps.getSpaces();
    const selected = new Set(selectTaskSpacesToArchive({
      spaces,
      lastUse: await this.#deps.readLastUse(),
      activeSpaceIds: await this.#deps.activeSpaceIds(),
      now: startedAt,
      periodMs,
    }));
    if (selected.size === 0) return;

    const run = await this.#snapshot(spaces, startedAt);

    // One Space at a time: two saves into a Space without an archive folder must not both create one
    for (const space of spaces)
    {
      if (!selected.has(space.id)) continue;
      try
      {
        await this.#archiveSpace(space, run);
      }
      catch (error)
      {
        console.error(`[TaskSpaceArchiver] failed to archive Task Space ${space.id}:`, error);
      }
    }
  }

  async #snapshot(spaces: readonly Space[], startedAt: number): Promise<RunSnapshot>
  {
    const tabs = await this.#deps.queryTabs();
    const [associations, tree] = await Promise.all([this.#loadAssociations(tabs), this.#deps.getTree()]);
    const roots = tree[0]?.children ?? [];

    // Every Space's Favorites: a tab on the page of any Favorite closes without a copy in the archive
    const favorites = allFavoriteUrls(roots, spaces).map(url => ({ url }));
    return {
      startedAt,
      spaces,
      roots,
      tabs,
      associations,
      savedPages: SavedPages.fromTree(roots, favorites),
      splitViewsOnScreen: SplitViewsOnScreen.of(tabs),
    };
  }

  // Each window's tab associations. A failed read fails the whole run, so no tab is judged
  // without knowing whether it is a Favorite or bookmark tab.
  async #loadAssociations(tabs: readonly ArchiverTab[]): Promise<TabAssociationsByWindow>
  {
    const byWindow = new TabAssociationsByWindow();
    const windowIds = [...new Set(tabs.map(tab => tab.windowId))];
    const associations = await Promise.all(windowIds.map(windowId => this.#deps.associationsOf(windowId)));

    // Keep each window's associations under its ID
    windowIds.forEach((windowId, position) => byWindow.setWindow(windowId, associations[position]));
    return byWindow;
  }

  // Save the tabs whose page would be lost, then move the Space to the archived list and close
  // its tabs. Anything that stands in the way keeps the Space, with all its tabs, until a later run.
  async #archiveSpace(space: Space, run: RunSnapshot): Promise<void>
  {
    const folder = findFolderBySegments(run.roots, space.bookmarkFolderSegments ?? [], space.bookmarkFolderInAccount);
    if (!folder)
    {
      this.#log(`kept Space ${space.id}: its bookmark folder is missing`);
      return;
    }

    const tabs = this.#tabsOf(space, folder, run);
    const keptTab = tabs.find(tab => this.#deps.isTabMarked(tab.id) || isAlwaysKept(tab, run.splitViewsOnScreen));
    if (keptTab)
    {
      this.#log(`kept Space ${space.id}: tab ${keptTab.id} is marked, active, audible, pinned or on screen`);
      return;
    }

    // A failed save throws and closes nothing; pages saved before it are harmless, the archive dedupes by URL
    for (const tab of tabs)
    {
      const pageUrl = tabPageUrl(tab);
      const action = closingTabAction(run.associations.itemKey(tab.windowId, tab.id), pageUrl, run.savedPages);
      if (action === 'close-only') continue;

      // A tab parked by a suspender extension is saved under its original URL
      await this.#deps.archivePage(folder.id, { title: tab.title, url: getEffectiveTabUrl(pageUrl) });
    }

    const openTabIds = await this.#tabsStillClosable(space.id, tabs, run.startedAt);
    if (!openTabIds) return;

    // The Space leaves the live list first, so nothing switches to it while its tabs close
    await this.#deps.archiveSpaces([space.id], this.#deps.now());
    this.#log(`archived Space ${space.id}, closing tabs ${openTabIds.join(', ')}`);
    if (openTabIds.length === 0) return;
    this.#deps.beforeClose(openTabIds);
    await this.#deps.removeTabs(openTabIds);
  }

  // The Space's tabs in every window: those the registry assigns to it, and the tabs of the
  // bookmarks it owns, which belong to the Space whatever the registry says
  #tabsOf(space: Space, folder: BookmarkNode, run: RunSnapshot): ArchiverTab[]
  {
    const bookmarkIds = ownedBookmarkIds(folder, space, run.spaces);
    return run.tabs.filter((tab) =>
    {
      if (this.#deps.spaceOf(tab.windowId, tab.id) === space.id) return true;
      const itemKey = run.associations.itemKey(tab.windowId, tab.id);
      return itemKey?.startsWith(BOOKMARK_ITEM_KEY_PREFIX) === true
        && bookmarkIds.has(itemKey.slice(BOOKMARK_ITEM_KEY_PREFIX.length));
    });
  }

  // Re-check right before acting: the saves took bookmark writes, and the user may have switched
  // to the Space or used one of its tabs meanwhile. The IDs of the tabs still open, or null
  // when the Space must stay this run.
  async #tabsStillClosable(spaceId: string, snapshots: readonly ArchiverTab[], runStartedAt: number): Promise<number[] | null>
  {
    if (new Set(await this.#deps.activeSpaceIds()).has(spaceId))
    {
      this.#log(`kept Space ${spaceId}: it became active during the run`);
      return null;
    }

    const openTabIds: number[] = [];
    for (const snapshot of snapshots)
    {
      if (this.#deps.isTabMarked(snapshot.id))
      {
        this.#log(`kept Space ${spaceId}: tab ${snapshot.id} was marked during the run`);
        return null;
      }

      // A tab closed meanwhile has nothing left to close
      const current = await this.#deps.getTab(snapshot.id);
      if (!current) continue;

      if (tabChangedDuringRun(snapshot, current, runStartedAt))
      {
        this.#log(`kept Space ${spaceId}: tab ${snapshot.id} changed during the run`);
        return null;
      }
      openTabIds.push(snapshot.id);
    }
    return openTabIds;
  }
}
