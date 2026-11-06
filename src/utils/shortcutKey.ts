// The key of a Chrome command shortcut, for pages that see a press Chrome let through.
// chrome.commands.getAll() gives the shortcut as display text: "⌥E" or "⇧⌘K" on macOS,
// "Alt+E" or "Ctrl+Shift+Comma" elsewhere.

// The fields read from a KeyboardEvent, so tests can pass plain objects
export interface ShortcutKeyEvent
{
  code: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

type ModifierFlag = 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey';

// ⌃ / MacCtrl is the Control key on macOS, where Chrome shows its "Ctrl" (Command) as ⌘
const MODIFIER_PREFIXES: ReadonlyArray<readonly [RegExp, ModifierFlag]> = [
  [/^(?:⌘|Command\+)/, 'metaKey'],
  [/^(?:⌃|Ctrl\+|MacCtrl\+)/, 'ctrlKey'],
  [/^(?:⌥|Alt\+)/, 'altKey'],
  [/^(?:⇧|Shift\+)/, 'shiftKey'],
];

const MODIFIER_FLAGS: readonly ModifierFlag[] = ['metaKey', 'ctrlKey', 'altKey', 'shiftKey'];

// Only keys a page can match by code give one: a letter, a digit, comma or period.
// Space, arrows, Home and the like give undefined.
function codeOfKey(key: string): string | undefined
{
  if (/^[A-Za-z]$/.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  // Chrome spells these keys out on some platforms
  if (key === ',' || key === 'Comma') return 'Comma';
  if (key === '.' || key === 'Period') return 'Period';
  return undefined;
}

export class ShortcutKey
{
  readonly code: string;
  readonly #modifiers: ReadonlySet<ModifierFlag>;

  private constructor(code: string, modifiers: ReadonlySet<ModifierFlag>)
  {
    this.code = code;
    this.#modifiers = modifiers;
  }

  // undefined when there is no shortcut or its key can't be matched by code
  static parse(shortcut: string | undefined): ShortcutKey | undefined
  {
    let key = shortcut?.trim() ?? '';
    const modifiers = new Set<ModifierFlag>();
    let prefix = MODIFIER_PREFIXES.find(([pattern]) => pattern.test(key));
    while (prefix)
    {
      const [pattern, flag] = prefix;
      modifiers.add(flag);
      key = key.replace(pattern, '');
      prefix = MODIFIER_PREFIXES.find(([next]) => next.test(key));
    }

    const code = codeOfKey(key);
    return code === undefined ? undefined : new ShortcutKey(code, modifiers);
  }

  // The same key with exactly the shortcut's modifiers: Ctrl+A is not the press of Alt+Shift+A
  matches(event: ShortcutKeyEvent): boolean
  {
    return event.code === this.code && MODIFIER_FLAGS.every(flag => event[flag] === this.#modifiers.has(flag));
  }
}

// KeyboardEvent.code of the shortcut's key ("⌘E" -> "KeyE")
export function keyCodeOf(shortcut: string | undefined): string | undefined
{
  return ShortcutKey.parse(shortcut)?.code;
}
