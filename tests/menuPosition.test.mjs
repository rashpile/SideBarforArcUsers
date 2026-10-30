import assert from 'node:assert/strict';
import test from 'node:test';

import { MENU_VIEWPORT_MARGIN, placeMenuAtPoint, placeSubmenu } from '../src/utils/menuPosition.ts';

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
