// Hover timing of a context-menu submenu. Pure, so the open/close decisions
// can be tested without a DOM or React.

// In a narrow side panel the submenu opens below its trigger and covers the
// next rows of the parent menu. Opening on mere contact would drop it under a
// pointer that only crosses the trigger on its way down, and the click meant
// for the row below would run a submenu item instead.
export const SUBMENU_OPEN_DELAY_MS = 200;

// Long enough for the pointer to cross from the trigger row to the panel,
// short enough that hovering another row of the parent menu closes it promptly.
export const SUBMENU_CLOSE_DELAY_MS = 150;

export interface SubmenuTimers
{
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

// One pending transition at a time: a later pointer move replaces the
// earlier one, so a pending open never fires after the pointer left.
export class SubmenuHoverTimer
{
  private readonly setOpen: (open: boolean) => void;
  private readonly timers: SubmenuTimers;
  private pending: unknown = null;

  constructor(setOpen: (open: boolean) => void, timers: SubmenuTimers)
  {
    this.setOpen = setOpen;
    this.timers = timers;
  }

  openNow(): void
  {
    this.cancelPending();
    this.setOpen(true);
  }

  pointerEnteredTrigger(): void
  {
    this.schedule(true, SUBMENU_OPEN_DELAY_MS);
  }

  pointerLeft(): void
  {
    this.schedule(false, SUBMENU_CLOSE_DELAY_MS);
  }

  pointerEnteredPanel(): void
  {
    this.cancelPending();
  }

  cancelPending(): void
  {
    if (this.pending !== null)
    {
      this.timers.clearTimeout(this.pending);
      this.pending = null;
    }
  }

  private schedule(open: boolean, delayMs: number): void
  {
    this.cancelPending();
    this.pending = this.timers.setTimeout(() =>
    {
      this.pending = null;
      this.setOpen(open);
    }, delayMs);
  }
}
