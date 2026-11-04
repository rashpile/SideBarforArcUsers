// Where a context menu or its submenu goes inside the viewport. Pure, so the
// placement rules can be tested without a DOM.

export const MENU_VIEWPORT_MARGIN = 8;

export interface MenuPoint
{
  x: number;
  y: number;
}

export interface MenuSize
{
  width: number;
  height: number;
}

export interface MenuAnchorRect
{
  left: number;
  right: number;
  top: number;
  bottom: number;
}

// Root menu at the cursor, pulled back inside the viewport when it overflows
// the right or bottom edge.
export function placeMenuAtPoint(point: MenuPoint, size: MenuSize, viewport: MenuSize): MenuPoint
{
  let x = point.x;
  let y = point.y;

  if (x + size.width > viewport.width)
  {
    x = viewport.width - size.width - MENU_VIEWPORT_MARGIN;
  }

  if (y + size.height > viewport.height)
  {
    y = viewport.height - size.height - MENU_VIEWPORT_MARGIN;
  }

  return { x, y };
}

// Menu opened from a button: below the button, or above it when the bottom
// edge is too close. Never on top of it: a second click on the button spot
// would otherwise land on a menu item and run it.
export function placeMenuAtAnchor(anchorRect: MenuAnchorRect, size: MenuSize, viewport: MenuSize): MenuPoint
{
  const margin = MENU_VIEWPORT_MARGIN;
  let x = anchorRect.right;
  if (x + size.width > viewport.width - margin)
  {
    x = Math.max(margin, viewport.width - size.width - margin);
  }

  const y = anchorRect.bottom + size.height <= viewport.height - margin
    ? anchorRect.bottom
    : Math.max(margin, anchorRect.top - size.height);
  return { x, y };
}

// Submenu beside its trigger row: right side first, then left. In a narrow
// side panel neither side fits; then the panel goes below or above the row and
// never covers it, because the hover-opened panel would otherwise put one of its
// items right under the pointer and a click meant for the trigger would run it.
export function placeSubmenu(anchorRect: MenuAnchorRect, size: MenuSize, viewport: MenuSize): MenuPoint
{
  const margin = MENU_VIEWPORT_MARGIN;
  const fitsRight = anchorRect.right + size.width <= viewport.width - margin;
  const fitsLeft = anchorRect.left - size.width >= margin;

  if (fitsRight || fitsLeft)
  {
    const x = fitsRight ? anchorRect.right : anchorRect.left - size.width;
    let y = anchorRect.top;
    if (y + size.height > viewport.height - margin)
    {
      y = Math.max(margin, viewport.height - size.height - margin);
    }
    return { x, y };
  }

  const x = Math.max(margin, viewport.width - size.width - margin);
  const y = anchorRect.bottom + size.height <= viewport.height - margin
    ? anchorRect.bottom
    : Math.max(margin, anchorRect.top - size.height);
  return { x, y };
}

export interface ScrollingMenuPlacement extends MenuPoint
{
  maxHeight: number;
}

// Scrolling list opened beside a button in the vertical toolbar strip; size is
// the whole list, which may be taller than the room it gets. Beside the button
// it may run down to the bottom edge. In a narrow panel it goes below or above
// the button, cut to the room on that side, because a list allowed to run past
// the button would cover it and a second click on the button would switch to
// the item under the pointer.
export function placeScrollingMenuBesideAnchor(
  anchorRect: MenuAnchorRect,
  size: MenuSize,
  viewport: MenuSize
): ScrollingMenuPlacement
{
  const margin = MENU_VIEWPORT_MARGIN;
  const fitsBeside = anchorRect.right + size.width <= viewport.width - margin
    || anchorRect.left - size.width >= margin;

  if (fitsBeside)
  {
    const height = Math.min(size.height, viewport.height - 2 * margin);
    const { x, y } = placeSubmenu(anchorRect, { width: size.width, height }, viewport);
    return { x, y, maxHeight: viewport.height - margin - y };
  }

  // Capped at the larger room, placeSubmenu keeps the list below when it fits
  // there whole and otherwise puts it on the larger side without clamping it
  // onto the button.
  const spaceBelow = viewport.height - margin - anchorRect.bottom;
  const spaceAbove = anchorRect.top - margin;
  const height = Math.min(size.height, Math.max(spaceBelow, spaceAbove));
  const { x, y } = placeSubmenu(anchorRect, { width: size.width, height }, viewport);
  return { x, y, maxHeight: height };
}
