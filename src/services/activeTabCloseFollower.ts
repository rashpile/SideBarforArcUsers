// ActiveTabCloseFollower - when a window's active tab closes, lands on the tab
// of the same Space the user used before it, instead of the tab-strip
// neighbour Chrome activates itself. A Space with no other open tab gets a New
// Tab in that Space.
//
// While a follow runs in a window, background.ts hands every onActivated there
// to absorbActivation and skips its own work: Chrome's pick must not lose its
// unvisited mark, look recently used or switch the Space. The follower runs that
// work (finishActivation) for the tab it lands on.
//
// Chrome may send onActivated for its pick before onRemoved for the closed tab.
// noteActivation therefore remembers which tab each activation replaced and
// whether that tab was already gone then: only in that case was the replaced
// tab still the active one when it closed.
//
// Whether the closed tab was active is read from the window's tab history, kept
// in chrome.storage.session, so it still answers when the close woke a stopped
// worker. The follower's own state is memory only: a follow lasts one round trip.
// Removals that arrive during a follow (a command closing many tabs) join it, so
// a batch close lands once.

/** Tab fields the follower reads from chrome.tabs.query. */
export interface FollowerTab
{
  id?: number;
  active?: boolean;
  lastAccessed?: number;
}

/** Chrome and the background managers, as the follower uses them (fakes in tests). */
export interface ActiveTabCloseFollowerDeps
{
  /** The window's tab history, most recent first. */
  activationOrder(windowId: number): number[];
  forgetActivation(windowId: number, tabId: number): void;
  spaceOf(windowId: number, tabId: number): string | undefined;
  spaceExists(spaceId: string): boolean;
  /** False once the tab is closed. */
  tabExists(tabId: number): Promise<boolean>;
  windowTabs(windowId: number): Promise<FollowerTab[]>;
  activeTabId(windowId: number): Promise<number | undefined>;
  /** False when Chrome refused, for example because the tab closed meanwhile. */
  activateTab(tabId: number): Promise<boolean>;
  /** Makes the Space the window's active one first: onCreated registers a new tab to the active Space. */
  openNewTab(windowId: number, spaceId: string): Promise<number | undefined>;
  /** The onActivated work skipped during the follow, for the tab the follow ends on. */
  finishActivation(windowId: number, tabId: number): Promise<void>;
}

/** A window's latest activation and the tab it replaced. */
class ActivationRecord
{
  readonly activatedTabId: number;
  readonly previousTabId: number;
  /** True when the replaced tab was already closed: the activation was Chrome's pick after it closed. */
  readonly previousGone: Promise<boolean>;
  #settledGone: boolean | undefined;

  constructor(activatedTabId: number, previousTabId: number, previousExists: Promise<boolean>)
  {
    this.activatedTabId = activatedTabId;
    this.previousTabId = previousTabId;
    // A failed check counts as "still existed", which keeps Chrome's pick as it was before the follower
    this.previousGone = previousExists
      .then((exists) => !exists, () => false)
      .then((gone) =>
      {
        this.#settledGone = gone;
        return gone;
      });
  }

  /** undefined until the check has answered. */
  get settledGone(): boolean | undefined
  {
    return this.#settledGone;
  }

  /** True when the closed tab is the one this activation replaced and the activation is still the window's latest. */
  replaced(closedTabId: number, topTabId: number | undefined): boolean
  {
    return this.previousTabId === closedTabId && this.activatedTabId === topTabId;
  }
}

/** One follow in one window, from the removal that started it until the landing. */
class WindowFollow
{
  readonly windowId: number;
  /** Set when Chrome's pick may have come first: the follow then waits for the pick's check. */
  readonly pick: ActivationRecord | undefined;
  done: Promise<void> = Promise.resolve();
  #spaceId: string;
  #closedTabIds = new Set<number>();
  #activeTabJoined = false;
  #joinedActiveSpaceId: string | undefined;
  #skippedActivation = false;

  constructor(windowId: number, closedTabId: number, spaceId: string, pick: ActivationRecord | undefined)
  {
    this.windowId = windowId;
    this.pick = pick;
    this.#spaceId = spaceId;
    this.#closedTabIds.add(closedTabId);
  }

  /** A removal during the follow; wasActive when the closed tab was the history top. */
  join(tabId: number, wasActive: boolean, spaceId: string | undefined): void
  {
    this.#closedTabIds.add(tabId);
    if (wasActive && !this.#activeTabJoined)
    {
      this.#activeTabJoined = true;
      this.#joinedActiveSpaceId = spaceId;
    }
  }

  isClosed(tabId: number): boolean
  {
    return this.#closedTabIds.has(tabId);
  }

  skipActivation(): void
  {
    this.#skippedActivation = true;
  }

  get skippedActivation(): boolean
  {
    return this.#skippedActivation;
  }

  /**
   * The Space to land in once the pick's check has answered (previousGone is false without a pick).
   * undefined when no active tab closed: the tab that started the follow was in the background and
   * no close of the history top joined.
   */
  landingSpace(previousGone: boolean): string | undefined
  {
    if (this.pick === undefined || previousGone) return this.#spaceId;
    return this.#activeTabJoined ? this.#joinedActiveSpaceId : undefined;
  }
}

export class ActiveTabCloseFollower
{
  #deps: ActiveTabCloseFollowerDeps;
  #records = new Map<number, ActivationRecord>();  // windowId -> latest activation
  #follows = new Map<number, WindowFollow>();      // windowId -> running follow

  constructor(deps: ActiveTabCloseFollowerDeps)
  {
    this.#deps = deps;
  }

  /** Call in onActivated before the history push. */
  noteActivation(windowId: number, tabId: number): void
  {
    const previousTabId = this.#deps.activationOrder(windowId)[0];
    // Clearing on every other activation (Back/Forward included) keeps a stale record from matching later
    if (previousTabId === undefined || previousTabId === tabId)
    {
      this.#records.delete(windowId);
      return;
    }
    this.#records.set(windowId, new ActivationRecord(tabId, previousTabId, this.#deps.tabExists(previousTabId)));
  }

  /** Call first in onActivated: true when a follow runs in the window and takes over the activation. */
  absorbActivation(windowId: number): boolean
  {
    const follow = this.#follows.get(windowId);
    if (!follow) return false;
    follow.skipActivation();
    return true;
  }

  isFollowing(windowId: number): boolean
  {
    return this.#follows.has(windowId);
  }

  /**
   * Call first in onRemoved, before the history or the registry forget the tab: the decision is
   * taken synchronously. The promise settles when the follow ends, at once when there is none.
   */
  tabRemoved(
    windowId: number,
    tabId: number,
    closedTabSpaceId: string | undefined,
    isWindowClosing: boolean,
    restored: boolean,
  ): Promise<void>
  {
    // After a failed restore the history and the registry may name other tabs than the ids say
    if (isWindowClosing || !restored) return Promise.resolve();

    const topTabId = this.#deps.activationOrder(windowId)[0];
    const wasActive = topTabId === tabId;
    const spaceId = closedTabSpaceId !== undefined && this.#deps.spaceExists(closedTabSpaceId)
      ? closedTabSpaceId
      : undefined;

    const running = this.#follows.get(windowId);
    if (running)
    {
      running.join(tabId, wasActive, spaceId);
      return running.done;
    }

    if (spaceId === undefined) return Promise.resolve();
    if (wasActive) return this.#start(windowId, tabId, spaceId, undefined);

    const record = this.#records.get(windowId);
    // Settled "still existed": the user had already left the tab, it closed in the background
    if (!record || !record.replaced(tabId, topTabId) || record.settledGone === false) return Promise.resolve();
    return this.#start(windowId, tabId, spaceId, record);
  }

  /** The window closed: a running follow stops at its next step. */
  removeWindow(windowId: number): void
  {
    this.#records.delete(windowId);
    this.#follows.delete(windowId);
  }

  #start(windowId: number, closedTabId: number, spaceId: string, pick: ActivationRecord | undefined): Promise<void>
  {
    this.#records.delete(windowId);
    const follow = new WindowFollow(windowId, closedTabId, spaceId, pick);
    this.#follows.set(windowId, follow);
    follow.done = this.#follow(follow);
    return follow.done;
  }

  async #follow(follow: WindowFollow): Promise<void>
  {
    let landingTabId: number | undefined;
    try
    {
      landingTabId = await this.#land(follow);
    }
    catch (error)
    {
      console.error('[ActiveTabCloseFollower] failed to land after the active tab closed:', error);
    }

    if (!this.#end(follow)) return;
    try
    {
      if (landingTabId !== undefined)
      {
        // Chrome sends no onActivated when the landing tab already was active, and one sent during the follow was skipped
        await this.#deps.finishActivation(follow.windowId, landingTabId);
      }
      else if (follow.skippedActivation)
      {
        // Without a landing the activation skipped during the follow still needs its work
        const activeTabId = await this.#deps.activeTabId(follow.windowId);
        if (activeTabId !== undefined) await this.#deps.finishActivation(follow.windowId, activeTabId);
      }
    }
    catch (error)
    {
      console.error('[ActiveTabCloseFollower] failed to finish the activation:', error);
    }
  }

  /** The tab the follow activated or opened; undefined when it lands nowhere. */
  async #land(follow: WindowFollow): Promise<number | undefined>
  {
    const { windowId, pick } = follow;
    const previousGone = pick ? await pick.previousGone : false;
    const spaceId = follow.landingSpace(previousGone);
    if (spaceId === undefined || !this.#isCurrent(follow)) return undefined;
    // Chrome's pick must not stay the most recent entry of the history
    if (pick && previousGone) this.#deps.forgetActivation(windowId, pick.activatedTabId);

    // Answered after Chrome finished the whole chrome.tabs.remove call, so a batch's tabs are gone
    const tabs = await this.#deps.windowTabs(windowId);
    if (!this.#isCurrent(follow)) return undefined;

    for (const tabId of this.#candidates(follow, spaceId, tabs))
    {
      if (await this.#deps.activateTab(tabId)) return tabId;
    }

    // A New Tab registered to a deleted Space would be hidden from the sidebar
    if (!this.#deps.spaceExists(spaceId)) return undefined;
    return await this.#deps.openNewTab(windowId, spaceId);
  }

  /**
   * The Space's open tabs: the window's history order first, then the rest by lastAccessed, newest
   * first, with the window's active tab last.
   */
  #candidates(follow: WindowFollow, spaceId: string, tabs: FollowerTab[]): number[]
  {
    const spaceTabs = new Map<number, FollowerTab>();
    for (const tab of tabs)
    {
      if (tab.id === undefined || follow.isClosed(tab.id)) continue;
      if (this.#deps.spaceOf(follow.windowId, tab.id) === spaceId) spaceTabs.set(tab.id, tab);
    }

    const byHistory = this.#deps.activationOrder(follow.windowId).filter((tabId) => spaceTabs.has(tabId));
    // The active tab is Chrome's pick: activating it after the close set its lastAccessed to now,
    // which says nothing about when the user last used it
    const byLastAccess = [...spaceTabs.entries()]
      .sort(([, a], [, b]) => Number(a.active === true) - Number(b.active === true)
        || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))
      .map(([tabId]) => tabId);
    return [...new Set([...byHistory, ...byLastAccess])];
  }

  /** False once removeWindow dropped the follow. */
  #isCurrent(follow: WindowFollow): boolean
  {
    return this.#follows.get(follow.windowId) === follow;
  }

  /** Ends the follow; false when removeWindow already did, and nothing is left to finish. */
  #end(follow: WindowFollow): boolean
  {
    if (!this.#isCurrent(follow)) return false;
    this.#follows.delete(follow.windowId);
    return true;
  }
}
