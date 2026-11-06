// What a key means in the search popup page. Like the Tab Switcher, holding the shortcut's modifier
// and pressing the shortcut again moves the selection, and letting go of the modifier opens the
// selected row. Unlike the switcher, the popup takes typed text, so a release picks only after such
// a press: opening the popup and letting go keeps it open for typing.
// Esc closes the popup, and so do Cmd+. and Ctrl+.: on macOS Cmd+Esc often never reaches the page
// (the system or another app takes it), so with Cmd held Cmd+. is the close key that works.

import { ShortcutKey } from '../utils/shortcutKey.ts';

// The fields read from a KeyboardEvent, so tests can pass plain objects
export interface SearchKeyEvent
{
  key: string;
  code: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing?: boolean;
}

export type SearchKeyAction =
  | { kind: 'move'; steps: number }
  | { kind: 'pick' }
  | { kind: 'close' }
  | { kind: 'scope'; step: 1 | -1 }
  | { kind: 'toggleSpaces' }
  | { kind: 'searchWeb' }
  | { kind: 'none' };

const NONE: SearchKeyAction = { kind: 'none' };

// Shift alone doesn't count: Chrome shortcuts need one of these, so it is the one let go of to pick
function holdsShortcutModifier(event: SearchKeyEvent): boolean
{
  return event.metaKey || event.ctrlKey || event.altKey;
}

export class SearchKeyboard
{
  #shortcut: ShortcutKey | undefined;
  // A shortcut press moved the selection and its modifier is still held: the release picks
  #armed = false;

  // The shortcut as chrome.commands gives it, e.g. "⌥E" or "Alt+E"
  constructor(shortcut: string | undefined)
  {
    this.#shortcut = ShortcutKey.parse(shortcut);
  }

  // Shortcut presses background forwarded (or counted while the page loaded); returns the steps to move
  shortcutMove(steps: number): number
  {
    if (steps !== 0) this.#armed = true;
    return steps;
  }

  // The text is the search field's, not the event's: Shift+Enter with a blank field does nothing
  keydown(event: SearchKeyEvent, text: string): SearchKeyAction
  {
    // A key pressed with no modifier held shows it is already up. A release the page missed
    // (the modifier let go before the frame had focus) must not turn the next typed letter into a pick.
    if (!holdsShortcutModifier(event)) this.#armed = false;
    if (event.isComposing) return NONE;

    switch (event.key)
    {
      case 'ArrowDown': return { kind: 'move', steps: 1 };
      case 'ArrowUp': return { kind: 'move', steps: -1 };
      case 'Enter':
        // Enter before letting go of a shortcut like Ctrl+Shift+K picks the row the user moved to
        if (event.shiftKey && !holdsShortcutModifier(event)) return text.trim() ? { kind: 'searchWeb' } : NONE;
        return { kind: 'pick' };
      case 'Escape': return this.#close();
      case 'Tab': return { kind: 'scope', step: event.shiftKey ? -1 : 1 };
    }

    // By code: on macOS Option+A types "å"
    if (event.altKey && !event.ctrlKey && !event.metaKey && event.code === 'KeyA') return { kind: 'toggleSpaces' };

    // Chrome let a shortcut press through to the page instead of sending it as a command. Only the
    // shortcut's own modifiers count: Ctrl+A or Cmd+V with the same key edit the search text.
    if (this.#shortcut?.matches(event) && holdsShortcutModifier(event))
    {
      this.#armed = true;
      return { kind: 'move', steps: 1 };
    }

    // By code: with Cmd held, other keyboard layouts can report another character. A shortcut on
    // Period keeps its key for moving. src/switcherOverlay.ts repeats this rule.
    if (event.code === 'Period' && (event.metaKey || event.ctrlKey) && this.#shortcut?.code !== 'Period')
    {
      return this.#close();
    }

    return NONE;
  }

  // The modifier may still be held: its release after a close must not pick
  #close(): SearchKeyAction
  {
    this.#armed = false;
    return { kind: 'close' };
  }

  keyup(event: SearchKeyEvent): SearchKeyAction
  {
    if (!this.#armed || holdsShortcutModifier(event)) return NONE;
    this.#armed = false;
    return { kind: 'pick' };
  }
}
