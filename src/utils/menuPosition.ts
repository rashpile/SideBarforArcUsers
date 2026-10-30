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
