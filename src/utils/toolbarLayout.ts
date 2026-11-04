// "Toolbar" setting: the toolbar buttons in a row across the top of the panel
// or in a column at its left edge. App.tsx lays the panel out by it.

export type ToolbarLayout = 'horizontal' | 'vertical';

// chrome.storage.local key, raw string (the Settings dialog stores it with
// serialize: v => v). Written by the Settings dialog, read by App.tsx.
export const TOOLBAR_LAYOUT_KEY = 'toolbarLayout';

export const DEFAULT_TOOLBAR_LAYOUT: ToolbarLayout = 'horizontal';

/** Parse a stored value, falling back to the default for absent/unknown values. */
export function parseToolbarLayout(value: unknown): ToolbarLayout
{
  return value === 'vertical' ? 'vertical' : 'horizontal';
}
