// The code editor's text per tab, kept by the panel rather than the drawer: the user can close the
// drawer or switch to another tab to copy code and come back to the same draft.

import { httpOriginOf } from '../../stores/savedPageStyles.ts';

/** The chat's applied set a new draft starts from; `appliedUrl` is the page it was applied on. */
export interface AppliedCode
{
  readonly appliedCss: string;
  readonly appliedScript: string;
  readonly appliedUrl: string;
}

/** The tab's bookmark style a new draft starts from when the chat has no applied code. */
export interface SavedCode
{
  readonly css: string;
  readonly script: string;
  /** The http(s) origin the style was saved on. */
  readonly origin: string;
}

/**
 * The code editor's state for one tab. Immutable, so a React hook can tell a changed draft by
 * identity. `origin` is the http(s) site the draft was opened for: Apply puts it only there.
 */
export class CodeDraft
{
  readonly css: string;
  readonly script: string;
  readonly origin: string;
  /** True from the click on Apply until applyCode settles. */
  readonly applying: boolean;
  /** Why the last Apply failed, until the next one. */
  readonly error: string | null;

  constructor(css: string, script: string, origin: string, applying = false, error: string | null = null)
  {
    this.css = css;
    this.script = script;
    this.origin = origin;
    this.applying = applying;
    this.error = error;
  }

  withCode(css: string, script: string): CodeDraft
  {
    return new CodeDraft(css, script, this.origin, this.applying, this.error);
  }

  /** The error was about the old site, so it goes with it. */
  withOrigin(origin: string): CodeDraft
  {
    return new CodeDraft(this.css, this.script, origin, this.applying, null);
  }

  /** A new Apply starts without the last one's error. */
  withApplying(applying: boolean): CodeDraft
  {
    return new CodeDraft(this.css, this.script, this.origin, applying, applying ? null : this.error);
  }

  /** An error ends the Apply it came from. */
  withError(error: string | null): CodeDraft
  {
    return new CodeDraft(this.css, this.script, this.origin, false, error);
  }
}

/** The open code editor drafts of this panel by tab id; they last until closed or the panel unloads. */
export class CodeDrafts
{
  readonly #drafts = new Map<number, CodeDraft>();
  readonly #listeners = new Set<() => void>();

  draftFor(tabId: number): CodeDraft | undefined
  {
    return this.#drafts.get(tabId);
  }

  /**
   * Starts a draft for the tab with the chat's applied code, or with the bookmark's saved style when
   * the chat has none; a draft the tab already has is kept, so its edits aren't lost. Nothing opens
   * when there is no http(s) site to bind the draft to.
   */
  open(tabId: number, applied: AppliedCode, saved: SavedCode | null, tabUrl: string | undefined): void
  {
    if (this.#drafts.has(tabId))
    {
      return;
    }
    const draft = newDraft(applied, saved, tabUrl);
    if (draft !== null)
    {
      this.#set(tabId, draft);
    }
  }

  update(tabId: number, css: string, script: string): void
  {
    this.#change(tabId, draft => draft.withCode(css, script));
  }

  /** Binds the draft to the site the tab is on now, after the user chose to use it there. */
  rebind(tabId: number, origin: string): void
  {
    this.#change(tabId, draft => draft.withOrigin(origin));
  }

  setApplying(tabId: number, applying: boolean): void
  {
    this.#change(tabId, draft => draft.withApplying(applying));
  }

  setError(tabId: number, error: string | null): void
  {
    this.#change(tabId, draft => draft.withError(error));
  }

  close(tabId: number): void
  {
    if (this.#drafts.delete(tabId))
    {
      this.#notify();
    }
  }

  subscribe = (listener: () => void): (() => void) =>
  {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  // A tab closed while its Apply ran has no draft left when the Apply settles.
  #change(tabId: number, change: (draft: CodeDraft) => CodeDraft): void
  {
    const draft = this.#drafts.get(tabId);
    if (draft)
    {
      this.#set(tabId, change(draft));
    }
  }

  #set(tabId: number, draft: CodeDraft): void
  {
    this.#drafts.set(tabId, draft);
    this.#notify();
  }

  #notify(): void
  {
    for (const listener of [...this.#listeners])
    {
      listener();
    }
  }
}

/**
 * The chat's applied code wins, as what the chat put on the page last. Without it the bookmark's saved
 * style is the code the user has for this page, also while the chat hasn't adopted it (the strip then
 * shows its Apply). Code belongs to the site it was applied or saved on, not to the one the tab shows
 * now: bound there, a tab that has moved to another site gets Use on <site> before the code can run on
 * it, as Re-apply and the strip's Apply refuse there. Without code the draft is for the tab's site.
 */
function newDraft(applied: AppliedCode, saved: SavedCode | null, tabUrl: string | undefined): CodeDraft | null
{
  const tabOrigin = httpOriginOf(tabUrl ?? '');
  if (hasCode(applied.appliedCss, applied.appliedScript))
  {
    const origin = httpOriginOf(applied.appliedUrl) ?? tabOrigin;
    return origin === null ? null : new CodeDraft(applied.appliedCss, applied.appliedScript, origin);
  }
  if (saved !== null && hasCode(saved.css, saved.script))
  {
    return new CodeDraft(saved.css, saved.script, saved.origin);
  }
  return tabOrigin === null ? null : new CodeDraft('', '', tabOrigin);
}

function hasCode(css: string, script: string): boolean
{
  return css.trim() !== '' || script.trim() !== '';
}
