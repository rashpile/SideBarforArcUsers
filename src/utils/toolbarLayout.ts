// "Toolbar" setting: the toolbar buttons in a row across the top of the panel
// or in a column at its left edge. The column has a collapsed strip ('vertical')
// and an expanded one, three times wider with a label on each button
// ('vertical-big'), switched from the strip's own toggle; Settings offers only
// Horizontal and Vertical. App.tsx lays the panel out by it.

export type ToolbarLayout = 'horizontal' | 'vertical' | 'vertical-big';

// chrome.storage.local key, raw string (stored with serialize: v => v).
// Written by App.tsx, from the Settings dialog and from the strip's toggle;
// read by App.tsx.
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

/** The Settings select's value for a stored layout: it offers Horizontal and Vertical, so both strips show as Vertical. */
export function toolbarLayoutChoice(layout: ToolbarLayout): ToolbarLayout
{
  return isVerticalToolbar(layout) ? 'vertical' : layout;
}

/**
 * The layout to store when Settings is saved with `choice` selected. Vertical
 * chosen while a vertical strip is shown keeps it, so Save doesn't collapse an
 * expanded strip; any other choice is stored as chosen.
 */
export function toolbarLayoutForChoice(current: ToolbarLayout, choice: ToolbarLayout): ToolbarLayout
{
  if (choice === 'vertical' && isVerticalToolbar(current))
  {
    return current;
  }
  return choice;
}

/** The other vertical strip, for the strip's expand/collapse toggle; Horizontal stays as it is. */
export function toggleVerticalToolbar(layout: ToolbarLayout): ToolbarLayout
{
  if (layout === 'vertical')
  {
    return 'vertical-big';
  }
  if (layout === 'vertical-big')
  {
    return 'vertical';
  }
  return layout;
}
