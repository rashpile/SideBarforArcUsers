// TabAutoArchiver - closes tabs left unused for the "Archive tabs after" period
// (feature 035). Regular tabs are saved to their Space's `asd_Archive` folder
// first; open bookmark pages and empty pages are closed without a bookmark.
//
// Runs in the background, so it works with the sidebar closed: at worker start
// (unless a run happened recently) and on a chrome.alarms alarm while the
// setting is on. Runs, setting changes and the alarm schedule go through one
// queue, so runs never overlap. Which tabs close is decided by selectTabsToClose
// (utils/autoArchivePolicy.ts); this class gathers its inputs and carries the
// result out against chrome.*.

import type { Space } from '../utils/spaceMessages';
import {
  AUTO_ARCHIVE_AFTER_KEY,
  AUTO_ARCHIVE_ENABLED_AT_KEY,
  autoArchivePeriodMs,
  autoArchiveSwitch,
  MINUTE_MS,
  parseAutoArchivePeriod,
} from '../utils/autoArchive';
import type { AutoArchivePeriod } from '../utils/autoArchive';
import { isTabActivityRecording, parseTabAgeHighlightStyle, TAB_AGE_HIGHLIGHT_KEY } from '../utils/tabAgeHighlight';
import {
  SavedPages,
  selectTabsToClose,
  tabChangedDuringRun,
  tabPageUrl,
  TabAssociationsByWindow,
} from '../utils/autoArchivePolicy';
import { SpaceArchive } from '../utils/archiveFolder';
import { findFolderBySegments } from '../utils/bookmarkFolderLookup';
import { getEffectiveTabUrl } from '../utils/parkedTabAssociation';
import { getTabAssociations } from '../utils/tabAssociations';
import type { TabActivityTracker } from '../stores/tabActivityTracker';

type BookmarkNode = chrome.bookmarks.BookmarkTreeNode;
type OpenTab = chrome.tabs.Tab & { id: number };

/** What the archiver needs from the rest of the background. */
export interface TabAutoArchiverDeps
{
  /** Resolves once the startup restore ended: true when it succeeded (TabAssociationReadiness.wait). */
  startupRestoreSucceeded: () => Promise<boolean>;
  tracker: TabActivityTracker;
  /** The Space a tab belongs to (TabSpaceRegistry). */
  spaceRegistry: { getSpace: (windowId: number, tabId: number) => string | undefined };
  getSpaces: () => readonly Space[];
  /** Favorites (pinned sites); a tab on a Favorite's page is never closed. */
  getPinnedSites: () => readonly { url: string }[];
}

/** The stored setting, as one run reads it. */
interface AutoArchiveSettings
{
  period: AutoArchivePeriod;
  /** Moment the setting went from 'never' to a period; undefined when not stored yet. */
  enabledAt: number | undefined;
}

/** What a run that may close tabs judges them by. */
interface RunSettings
{
  periodMs: number;
  enabledAt: number;
}

// A stored "Archive tabs after" value; a '1m' left from a DEV build reads as Never in release builds
function parseStoredPeriod(value: unknown): AutoArchivePeriod
{
  return parseAutoArchivePeriod(value, import.meta.env.DEV);
}

/** Whether the tab activity tracker records last-use times: while auto-archive or the tab age highlight is on. */
export async function readTabActivityRecording(): Promise<boolean>
{
  const result = await chrome.storage.local.get([AUTO_ARCHIVE_AFTER_KEY, TAB_AGE_HIGHLIGHT_KEY]);
  return isTabActivityRecording(
    parseStoredPeriod(result[AUTO_ARCHIVE_AFTER_KEY]),
    parseTabAgeHighlightStyle(result[TAB_AGE_HIGHLIGHT_KEY])
  );
}

/** The tabs auto-archive works on: those of normal windows (popup and app windows never show in the Tab list). */
export async function queryOpenTabs(): Promise<OpenTab[]>
{
  return (await chrome.tabs.query({ windowType: 'normal' }))
    .filter((tab): tab is OpenTab => tab.id !== undefined);
}

// Each window's tab associations. A failed read fails the whole run, so no tab
// is judged without knowing whether it is a Favorite or bookmark tab.
async function loadAssociationsByWindow(tabs: readonly chrome.tabs.Tab[]): Promise<TabAssociationsByWindow>
{
  const associationsByWindow = new TabAssociationsByWindow();
  const windowIds = [...new Set(tabs.map(tab => tab.windowId))];
  const associations = await Promise.all(windowIds.map(windowId => getTabAssociations(windowId)));

  // Keep each window's associations under its ID
  windowIds.forEach((windowId, position) => associationsByWindow.setWindow(windowId, associations[position]));
  return associationsByWindow;
}

// The Space's bookmark folder ID; undefined for an unknown Space, a Space without
// a resolved folder path, or a folder that can't be found
function spaceFolderId(roots: BookmarkNode[], spaces: readonly Space[], spaceId: string): string | undefined
{
  const space = spaces.find(candidate => candidate.id === spaceId);
  if (!space) return undefined;
  return findFolderBySegments(roots, space.bookmarkFolderSegments ?? [], space.bookmarkFolderInAccount)?.id;
}

export class TabAutoArchiver
{
  static ALARM_NAME = 'auto-archive';
  // The shortest release period is 12 hours, so a few minutes of delay don't
  // matter; DEV builds check every minute for the 1-minute test period.
  static ALARM_PERIOD_MINUTES = import.meta.env.DEV ? 1 : 5;
  // Tab events wake the worker often, so a worker start runs only when no run started within
  // one alarm period. An alarm run is skipped within half a period of another run, e.g. the
  // worker-start run of the worker the alarm woke.
  static START_RUN_THROTTLE_MS = TabAutoArchiver.ALARM_PERIOD_MINUTES * MINUTE_MS;
  static ALARM_RUN_THROTTLE_MS = TabAutoArchiver.START_RUN_THROTTLE_MS / 2;
  /** chrome.storage.session: epoch millis the last run started. */
  static LAST_RUN_KEY = 'autoArchiveLastRunAt';

  #deps: TabAutoArchiverDeps;
  #spaceArchive = new SpaceArchive({
    getChildren: (id) => chrome.bookmarks.getChildren(id),
    create: (bookmark) => chrome.bookmarks.create(bookmark),
    remove: (id) => chrome.bookmarks.remove(id),
  });
  #tail: Promise<void> = Promise.resolve();

  constructor(deps: TabAutoArchiverDeps)
  {
    this.#deps = deps;
  }

  /**
   * Worker start: schedule the alarm to match the setting, then run once -
   * unless a run started less than one alarm period ago. Tab events wake the
   * worker often; the alarm keeps the schedule.
   */
  start(): Promise<void>
  {
    return this.#enqueue('start', async () =>
    {
      await this.#syncAlarm((await this.#readSettings()).period);
      if (await this.#ranWithin(TabAutoArchiver.START_RUN_THROTTLE_MS)) return;
      await this.#archiveOverdueTabs();
    });
  }

  /**
   * Alarm tick: archive and close the tabs that are overdue now. Skipped right
   * after another run, e.g. the worker-start run of the worker this alarm woke.
   */
  run(): Promise<void>
  {
    return this.#enqueue('run', async () =>
    {
      if (await this.#ranWithin(TabAutoArchiver.ALARM_RUN_THROTTLE_MS)) return;
      await this.#archiveOverdueTabs();
    });
  }

  /**
   * chrome.storage.onChanged for `autoArchiveAfter`. Switching on from 'never'
   * starts every tab's clock now; switching to 'never' drops the start time and
   * the alarm, and the last-use records unless the tab age highlight still needs
   * them. A change between two periods keeps the start time.
   */
  handleSettingChange(change: chrome.storage.StorageChange): Promise<void>
  {
    return this.#enqueue('setting change', async () =>
    {
      const switched = autoArchiveSwitch(change, import.meta.env.DEV);

      // Off: forget the start time. On: start the clock (grace for records kept for the highlight)
      if (switched === 'off')
      {
        await chrome.storage.local.remove(AUTO_ARCHIVE_ENABLED_AT_KEY);
      }
      else if (switched === 'on')
      {
        await chrome.storage.local.set({ [AUTO_ARCHIVE_ENABLED_AT_KEY]: Date.now() });
      }

      // The tracker keeps or drops its records to match both settings, and learns the open
      // tabs and the active tab of each window when it records
      if (switched !== 'unchanged') await this.#deps.tracker.load(await queryOpenTabs());
      await this.#syncAlarm(parseStoredPeriod(change.newValue));
    });
  }

  // Every task logs its own failure, so the queue never rejects and one failure doesn't stop the next task
  #enqueue(label: string, task: () => Promise<void>): Promise<void>
  {
    const result = this.#tail.then(task).catch((error) =>
    {
      console.error(`[TabAutoArchiver] ${label} failed:`, error);
    });
    this.#tail = result;
    return result;
  }

  async #readSettings(): Promise<AutoArchiveSettings>
  {
    const result = await chrome.storage.local.get([AUTO_ARCHIVE_AFTER_KEY, AUTO_ARCHIVE_ENABLED_AT_KEY]);
    const enabledAt = result[AUTO_ARCHIVE_ENABLED_AT_KEY];
    return {
      period: parseStoredPeriod(result[AUTO_ARCHIVE_AFTER_KEY]),
      enabledAt: typeof enabledAt === 'number' && Number.isFinite(enabledAt) ? enabledAt : undefined,
    };
  }

  // True when a run started less than `ms` ago in this browser session
  async #ranWithin(ms: number): Promise<boolean>
  {
    const result = await chrome.storage.session.get(TabAutoArchiver.LAST_RUN_KEY);
    const lastRunAt = result[TabAutoArchiver.LAST_RUN_KEY];
    return typeof lastRunAt === 'number' && Date.now() - lastRunAt < ms;
  }

  // The alarm exists only while the setting is on. An alarm that already has the
  // right interval is kept: creating it again would restart its countdown.
  async #syncAlarm(period: AutoArchivePeriod): Promise<void>
  {
    if (period === 'never')
    {
      await chrome.alarms.clear(TabAutoArchiver.ALARM_NAME);
      return;
    }

    const existing: chrome.alarms.Alarm | undefined = await chrome.alarms.get(TabAutoArchiver.ALARM_NAME);
    if (existing?.periodInMinutes === TabAutoArchiver.ALARM_PERIOD_MINUTES) return;
    await chrome.alarms.create(TabAutoArchiver.ALARM_NAME, { periodInMinutes: TabAutoArchiver.ALARM_PERIOD_MINUTES });
  }

  // The period and start time a run judges tabs by; null when the run must close nothing
  async #runSettings(): Promise<RunSettings | null>
  {
    // Bookmark and Favorite tabs are known only after the startup restore; if it failed, judge nothing
    if (!await this.#deps.startupRestoreSucceeded())
    {
      if (import.meta.env.DEV)
      {
        console.log('[TabAutoArchiver] skipped: startup restore of tab associations failed');
      }
      return null;
    }

    const settings = await this.#readSettings();
    const periodMs = autoArchivePeriodMs(settings.period);
    if (periodMs === null) return null;

    // The start time is written when the setting is switched on; if that write was lost, every
    // tab's clock starts now (this run closes nothing)
    if (settings.enabledAt === undefined)
    {
      await chrome.storage.local.set({ [AUTO_ARCHIVE_ENABLED_AT_KEY]: Date.now() });
      return null;
    }
    return { periodMs, enabledAt: settings.enabledAt };
  }

  async #archiveOverdueTabs(): Promise<void>
  {
    const settings = await this.#runSettings();
    if (!settings) return;

    const runStartedAt = Date.now();
    await chrome.storage.session.set({ [TabAutoArchiver.LAST_RUN_KEY]: runStartedAt });
    const tabs = await queryOpenTabs();
    const activity = await this.#deps.tracker.refresh(tabs);
    const [associationsByWindow, tree] = await Promise.all([
      loadAssociationsByWindow(tabs),
      chrome.bookmarks.getTree(),
    ]);
    const roots = tree[0]?.children ?? [];

    const { archive, closeOnly } = selectTabsToClose({
      tabs,
      associationsByWindow,
      savedPages: SavedPages.fromTree(roots, this.#deps.getPinnedSites()),
      activity,
      enabledAt: settings.enabledAt,
      now: Date.now(),
      periodMs: settings.periodMs,
    });

    // One tab at a time: two archives into a Space without a folder must not both create one
    const spaces = this.#deps.getSpaces();
    for (const tab of archive)
    {
      await this.#archiveAndClose(tab, roots, spaces, runStartedAt);
    }

    // Open bookmark pages and empty pages close without an archive bookmark
    for (const tab of closeOnly)
    {
      await this.#closeWithoutArchiving(tab, runStartedAt);
    }
  }

  // Save a regular tab to its Space's archive, then close it. Without a Space or
  // its folder, or when the bookmark can't be created, the tab stays open.
  async #archiveAndClose(tab: OpenTab, roots: BookmarkNode[], spaces: readonly Space[], runStartedAt: number): Promise<void>
  {
    try
    {
      const spaceId = this.#deps.spaceRegistry.getSpace(tab.windowId, tab.id);
      const folderId = spaceId ? spaceFolderId(roots, spaces, spaceId) : undefined;
      if (!folderId)
      {
        if (import.meta.env.DEV)
        {
          console.log(`[TabAutoArchiver] kept tab ${tab.id}: no Space or Space folder (space=${spaceId})`);
        }
        return;
      }

      // A tab parked by a suspender extension is saved under its original URL
      const bookmark = await this.#spaceArchive.archive(folderId, { title: tab.title, url: getEffectiveTabUrl(tabPageUrl(tab)) });

      // The bookmark exists now; the tab closes only if nobody started using it meanwhile
      if (!await this.#stillClosable(tab, runStartedAt)) return;
      await chrome.tabs.remove(tab.id);

      if (import.meta.env.DEV)
      {
        console.log(`[TabAutoArchiver] archived tab ${tab.id} as bookmark ${bookmark.id}:`, bookmark.url);
      }
    }
    catch (error)
    {
      console.error(`[TabAutoArchiver] failed to archive tab ${tab.id}:`, error);
    }
  }

  async #closeWithoutArchiving(tab: OpenTab, runStartedAt: number): Promise<void>
  {
    try
    {
      if (!await this.#stillClosable(tab, runStartedAt)) return;
      await chrome.tabs.remove(tab.id);

      if (import.meta.env.DEV)
      {
        console.log(`[TabAutoArchiver] closed tab ${tab.id} without archiving:`, tabPageUrl(tab));
      }
    }
    catch (error)
    {
      console.error(`[TabAutoArchiver] failed to close tab ${tab.id}:`, error);
    }
  }

  // Re-read the tab right before closing it: the run judged a snapshot, and a tab
  // that is gone or changed meanwhile (tabChangedDuringRun) stays open until the next run
  async #stillClosable(snapshot: OpenTab, runStartedAt: number): Promise<boolean>
  {
    let current: chrome.tabs.Tab;
    try
    {
      current = await chrome.tabs.get(snapshot.id);
    }
    catch
    {
      return false;  // Already closed
    }

    const changed = tabChangedDuringRun(snapshot, current, runStartedAt);
    if (changed && import.meta.env.DEV)
    {
      console.log(`[TabAutoArchiver] kept tab ${snapshot.id}: it changed during the run`);
    }
    return !changed;
  }
}
