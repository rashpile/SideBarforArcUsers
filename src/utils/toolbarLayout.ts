// "Toolbar" setting: the toolbar buttons in a row across the top of the panel,
// in a column at its left edge, or in a three times wider column with a label
// on each button ('vertical-big'). App.tsx lays the panel out by it.

export type ToolbarLayout = 'horizontal' | 'vertical' | 'vertical-big';

// chrome.storage.local key, raw string (the Settings dialog stores it with
// serialize: v => v). Written by the Settings dialog, read by App.tsx.
export const TOOLBAR_LAYOUT_KEY = 'toolbarLayout';

export const DEFAULT_TOOLBAR_LAYOUT: ToolbarLayout = 'horizontal';

/** Parse a stored value, falling back to the default for absent/unknown values. */
export function parseToolbarLayout(value: unknown): ToolbarLayout
{
  if (value === 'vertical' || value === 'vertical-big')
  {
    return value;
  }
  return 'horizontal';
}

/** True for both column layouts: the panel puts the strip left of the content and menus open to the right. */
export function isVerticalToolbar(layout: ToolbarLayout): boolean
{
  return layout === 'vertical' || layout === 'vertical-big';
}
