// Waits until Chrome has restored its windows at browser start. The service worker can run before
// Chrome has restored any window: stored tab records then match no tab, and the startup restore
// would drop every stored Space.

// Window and tab creations this close together are the browser still restoring its session
export const RESTORE_QUIET_MS = 500;

// Counted from the first window, so a user who opens tabs right away doesn't hold the startup
export const RESTORE_MAX_WAIT_MS = 5000;

export interface RestoredWindowsWaitDeps
{
  countNormalWindows(): Promise<number>;
  // Chrome-shaped: removing a listener needs the same reference that was added
  addWindowCreatedListener(listener: () => void): void;
  removeWindowCreatedListener(listener: () => void): void;
  addTabCreatedListener(listener: () => void): void;
  removeTabCreatedListener(listener: () => void): void;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  quietMs: number;
  maxWaitMs: number;
}

export class RestoredWindowsWait
{
  readonly #deps: RestoredWindowsWaitDeps;

  constructor(deps: RestoredWindowsWaitDeps)
  {
    this.#deps = deps;
  }

  /**
   * Resolves once a normal window exists and no window or tab has been created for `quietMs`,
   * or `maxWaitMs` after the first window. Without a window it waits for one. Never rejects.
   */
  wait(): Promise<void>
  {
    return new Promise((resolve) => new RestoreWaitRun(this.#deps, resolve).start());
  }
}

class RestoreWaitRun
{
  readonly #deps: RestoredWindowsWaitDeps;
  readonly #resolve: () => void;
  #windowSeen = false;
  #finished = false;
  #quietTimer: unknown = null;
  #capTimer: unknown = null;

  constructor(deps: RestoredWindowsWaitDeps, resolve: () => void)
  {
    this.#deps = deps;
    this.#resolve = resolve;
  }

  start(): void
  {
    // Listeners first, so a window restored while the count is pending isn't missed
    this.#deps.addWindowCreatedListener(this.#onWindowCreated);
    this.#deps.addTabCreatedListener(this.#onTabCreated);
    this.#deps.countNormalWindows().then(
      (count) =>
      {
        if (count > 0) this.#restartQuietPeriod();
      },
      // A wait with no end would hold the startup and every event behind it forever
      () => this.#restartQuietPeriod()
    );
  }

  readonly #onWindowCreated = (): void =>
  {
    this.#restartQuietPeriod();
  };

  // Tabs created before any window aren't the restore; they don't start the quiet period
  readonly #onTabCreated = (): void =>
  {
    if (this.#windowSeen) this.#restartQuietPeriod();
  };

  #restartQuietPeriod(): void
  {
    if (this.#finished) return;
    if (this.#quietTimer !== null) this.#deps.clearTimeout(this.#quietTimer);
    this.#quietTimer = this.#deps.setTimeout(() => this.#finish(), this.#deps.quietMs);
    if (!this.#windowSeen)
    {
      this.#windowSeen = true;
      this.#capTimer = this.#deps.setTimeout(() => this.#finish(), this.#deps.maxWaitMs);
    }
  }

  #finish(): void
  {
    if (this.#finished) return;
    this.#finished = true;
    if (this.#quietTimer !== null) this.#deps.clearTimeout(this.#quietTimer);
    if (this.#capTimer !== null) this.#deps.clearTimeout(this.#capTimer);
    this.#deps.removeWindowCreatedListener(this.#onWindowCreated);
    this.#deps.removeTabCreatedListener(this.#onTabCreated);
    this.#resolve();
  }
}
