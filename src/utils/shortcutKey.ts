// The key of a Chrome command shortcut, for pages that see a press Chrome let through.
// chrome.commands.getAll() gives the shortcut as display text: "⌥E" or "⇧⌘K" on macOS,
// "Alt+E" or "Ctrl+Shift+Comma" elsewhere.

const MODIFIER_PREFIX = /^(?:[⌘⌥⇧⌃]|(?:Ctrl|Alt|Shift|Command|MacCtrl)\+)/;

// KeyboardEvent.code of the shortcut's key ("⌘E" -> "KeyE"). Only keys a page can match by code
// give one: a letter, a digit, comma or period. Space, arrows, Home and the like give undefined.
export function keyCodeOf(shortcut: string | undefined): string | undefined
{
  let key = shortcut?.trim() ?? '';
  while (MODIFIER_PREFIX.test(key))
  {
    key = key.replace(MODIFIER_PREFIX, '');
  }

  if (/^[A-Za-z]$/.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  // Chrome spells these keys out on some platforms
  if (key === ',' || key === 'Comma') return 'Comma';
  if (key === '.' || key === 'Period') return 'Period';
  return undefined;
}
