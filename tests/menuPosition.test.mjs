import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MENU_VIEWPORT_MARGIN,
  placeMenuAtAnchor,
  placeMenuAtPoint,
  placeScrollingMenuBesideAnchor,
  placeSubmenu
} from '../src/utils/menuPosition.ts';

const SUBMENU = { width: 220, height: 64 };

function rowAt(left, right, top, height = 28)
{
  return { left, right, top, bottom: top + height };
}

function overlaps(anchor, point, size)
{
  return point.x < anchor.right
    && point.x + size.width > anchor.left
    && point.y < anchor.bottom
    && point.y + size.height > anchor.top;
}

test('submenu opens to the right of the trigger when it fits', () =>
{
  const anchor = rowAt(100, 300, 50);
  const result = placeSubmenu(anchor, SUBMENU, { width: 1200, height: 800 });

  assert.deepEqual(result, { x: 300, y: 50 });
});

test('submenu flips to the left when the right side overflows', () =>
{
  const anchor = rowAt(500, 700, 50);
  const result = placeSubmenu(anchor, SUBMENU, { width: 800, height: 800 });

  assert.deepEqual(result, { x: 500 - SUBMENU.width, y: 50 });
});

test('submenu beside the trigger moves up when it overflows the bottom', () =>
{
  const viewport = { width: 1200, height: 400 };
  const anchor = rowAt(100, 300, 370);
  const result = placeSubmenu(anchor, SUBMENU, viewport);

  assert.equal(result.x, 300);
  assert.equal(result.y, viewport.height - SUBMENU.height - MENU_VIEWPORT_MARGIN);
});

test('in a narrow panel the submenu goes below the trigger and does not cover it', () =>
{
  const viewport = { width: 300, height: 800 };
  const anchor = rowAt(20, 280, 100);
  const result = placeSubmenu(anchor, SUBMENU, viewport);

  assert.equal(result.y, anchor.bottom);
  assert.equal(result.x, viewport.width - SUBMENU.width - MENU_VIEWPORT_MARGIN);
  assert.equal(overlaps(anchor, result, SUBMENU), false);
});

test('in a narrow panel with no room below the submenu goes above the trigger and does not cover it', () =>
{
  const viewport = { width: 300, height: 400 };
  const anchor = rowAt(20, 280, 350);
  const result = placeSubmenu(anchor, SUBMENU, viewport);

  assert.equal(result.y, anchor.top - SUBMENU.height);
  assert.equal(overlaps(anchor, result, SUBMENU), false);
});

test('in a panel narrower than the submenu it stays at the left margin', () =>
{
  const viewport = { width: 180, height: 800 };
  const anchor = rowAt(10, 170, 100);
  const result = placeSubmenu(anchor, SUBMENU, viewport);

  assert.equal(result.x, MENU_VIEWPORT_MARGIN);
  assert.equal(overlaps(anchor, result, SUBMENU), false);
});

test('root menu keeps the cursor position when it fits and clamps at the right and bottom edges', () =>
{
  const viewport = { width: 400, height: 300 };
  const size = { width: 200, height: 150 };

  assert.deepEqual(placeMenuAtPoint({ x: 50, y: 40 }, size, viewport), { x: 50, y: 40 });
  assert.deepEqual(
    placeMenuAtPoint({ x: 350, y: 250 }, size, viewport),
    { x: 400 - 200 - MENU_VIEWPORT_MARGIN, y: 300 - 150 - MENU_VIEWPORT_MARGIN }
  );
});

const BUTTON_MENU = { width: 160, height: 70 };

function buttonAt(left, top, size = 22)
{
  return { left, right: left + size, top, bottom: top + size };
}

test('button menu opens below the button at its right edge when it fits', () =>
{
  const anchor = buttonAt(100, 50);
  const result = placeMenuAtAnchor(anchor, BUTTON_MENU, { width: 800, height: 800 });

  assert.deepEqual(result, { x: anchor.right, y: anchor.bottom });
});

test('button menu near the bottom edge goes above the button and does not cover it', () =>
{
  const viewport = { width: 300, height: 600 };
  // Right-aligned button just above a thin bar: the menu fits neither below nor at the right
  const anchor = buttonAt(270, 560);
  const result = placeMenuAtAnchor(anchor, BUTTON_MENU, viewport);

  assert.equal(result.y, anchor.top - BUTTON_MENU.height);
  assert.equal(result.x, viewport.width - BUTTON_MENU.width - MENU_VIEWPORT_MARGIN);
  assert.equal(overlaps(anchor, result, BUTTON_MENU), false);
});

test('right-aligned button menu with room below is clamped horizontally and does not cover the button', () =>
{
  const viewport = { width: 300, height: 600 };
  const anchor = buttonAt(270, 100);
  const result = placeMenuAtAnchor(anchor, BUTTON_MENU, viewport);

  assert.equal(result.y, anchor.bottom);
  assert.equal(result.x, viewport.width - BUTTON_MENU.width - MENU_VIEWPORT_MARGIN);
  assert.equal(overlaps(anchor, result, BUTTON_MENU), false);
});

// Prev/Next history list beside a button of the vertical toolbar strip
const HISTORY_LIST = { width: 288, height: 600 };
const NARROW_PANEL_WIDTH = 300;

function stripButtonAt(top)
{
  return { left: 4, right: 32, top, bottom: top + 28 };
}

function shownSize(placement)
{
  return { width: HISTORY_LIST.width, height: placement.maxHeight };
}

test('strip list opens beside the button and may run down to the bottom edge', () =>
{
  const viewport = { width: 800, height: 900 };
  const anchor = stripButtonAt(100);
  const result = placeScrollingMenuBesideAnchor(anchor, HISTORY_LIST, viewport);

  assert.deepEqual(result, { x: anchor.right, y: anchor.top, maxHeight: viewport.height - MENU_VIEWPORT_MARGIN - anchor.top });
});

test('strip list taller than the window beside the button fills the window height', () =>
{
  const viewport = { width: 800, height: 400 };
  const anchor = stripButtonAt(300);
  const result = placeScrollingMenuBesideAnchor(anchor, HISTORY_LIST, viewport);

  assert.deepEqual(result, { x: anchor.right, y: MENU_VIEWPORT_MARGIN, maxHeight: viewport.height - 2 * MENU_VIEWPORT_MARGIN });
});

test('in a narrow panel a strip list that fits below the button opens below it whole', () =>
{
  const viewport = { width: NARROW_PANEL_WIDTH, height: 1400 };
  // More room above than below, but the whole list still fits below
  const anchor = stripButtonAt(700);
  const result = placeScrollingMenuBesideAnchor(anchor, HISTORY_LIST, viewport);

  assert.equal(result.y, anchor.bottom);
  assert.equal(result.maxHeight, HISTORY_LIST.height);
  assert.equal(overlaps(anchor, result, shownSize(result)), false);
});

test('in a narrow panel a long strip list near the top is cut to the room below the button', () =>
{
  const viewport = { width: NARROW_PANEL_WIDTH, height: 500 };
  const anchor = stripButtonAt(40);
  const result = placeScrollingMenuBesideAnchor(anchor, HISTORY_LIST, viewport);

  assert.equal(result.y, anchor.bottom);
  assert.equal(result.maxHeight, viewport.height - MENU_VIEWPORT_MARGIN - anchor.bottom);
  assert.equal(overlaps(anchor, result, shownSize(result)), false);
});

test('in a narrow panel a long strip list near the bottom goes above the button and does not cover it', () =>
{
  const viewport = { width: NARROW_PANEL_WIDTH, height: 500 };
  const anchor = stripButtonAt(440);
  const result = placeScrollingMenuBesideAnchor(anchor, HISTORY_LIST, viewport);

  assert.equal(result.y, MENU_VIEWPORT_MARGIN);
  assert.equal(result.maxHeight, anchor.top - MENU_VIEWPORT_MARGIN);
  assert.equal(overlaps(anchor, result, shownSize(result)), false);
});

test('in a narrow panel a short strip list near the bottom sits right above the button', () =>
{
  const viewport = { width: NARROW_PANEL_WIDTH, height: 500 };
  const anchor = stripButtonAt(440);
  const shortList = { width: HISTORY_LIST.width, height: 120 };
  const result = placeScrollingMenuBesideAnchor(anchor, shortList, viewport);

  assert.deepEqual(result, { x: MENU_VIEWPORT_MARGIN, y: anchor.top - shortList.height, maxHeight: shortList.height });
  assert.equal(overlaps(anchor, result, shortList), false);
});
