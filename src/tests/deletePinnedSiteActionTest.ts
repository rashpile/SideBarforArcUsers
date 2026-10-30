// Unit tests for DeletePinnedSiteAction
// Run via the "Unit Test Do/Undo Delete Pinned Sites" menu item (dev mode only)
//
// Each case builds a throwaway Space folder with an asd_Favorites folder in the
// first writable bookmark root, and removes it afterwards.

import { DeletePinnedSiteAction } from '../actions/deletePinnedSiteAction';
import { PinnedSite } from '../managers/shared/pinnedSitesApi';
import type { FavoriteIconEntry } from '../managers/shared/favoriteIconsApi';
import { favoriteIconsManagerProxy } from '../managers/proxies/favoriteIconsManagerProxy';
import { ensureFavoritesFolder } from '../utils/favoritesFolder';
import { TestResult } from './testUtils';

// --- Types ---

// No id: undo recreates the bookmark, so it comes back under a new one
interface PinShape
{
  url: string;
  title: string;
  customIconName?: string;
  iconColor?: string;
  emoji?: string;
}

interface TestPin
{
  n: number;
  customIconName?: string;
  iconColor?: string;
  emoji?: string;
  selected?: boolean;
  withTab?: boolean;       // Create a real tab associated with this pin
}

interface TestCase
{
  name: string;
  pins: TestPin[];
}

// --- Helpers ---

const TEST_URL_PREFIX = 'https://example.com/pin-test-';
const TEST_SPACE_FOLDER_TITLE = 'asd_test_unpin_space';
const SETTLE_MS = 300;

function testUrl(n: number): string
{
  return `${TEST_URL_PREFIX}${n}`;
}

function settle(): Promise<void>
{
  return new Promise(resolve => setTimeout(resolve, SETTLE_MS));
}

function testPinToShape(pin: TestPin): PinShape
{
  return {
    url: testUrl(pin.n),
    title: `Pin ${pin.n}`,
    customIconName: pin.customIconName,
    iconColor: pin.iconColor,
    emoji: pin.emoji,
  };
}

function iconsOf(pin: TestPin): FavoriteIconEntry
{
  return { customIconName: pin.customIconName, iconColor: pin.iconColor, emoji: pin.emoji };
}

// A writable root (not managed bookmarks), found without assuming root ids
async function writableRootId(): Promise<string>
{
  const [tree] = await chrome.bookmarks.getTree();
  const root = (tree.children ?? []).find(node => !node.url && !node.unmodifiable);
  if (!root) throw new Error('no writable bookmark root');
  return root.id;
}

// The Favorites as the grid sees them: the folder's pages in order, merged with their icons
async function readPins(folderId: string): Promise<PinnedSite[]>
{
  const icons = await favoriteIconsManagerProxy.getIcons();
  const children = await chrome.bookmarks.getChildren(folderId);
  return children
    .filter(child => !!child.url)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map(child => ({ ...icons[child.id], id: child.id, url: child.url!, title: child.title }));
}

function pinsToShapes(pins: PinnedSite[]): PinShape[]
{
  return pins.map(pin => ({
    url: pin.url,
    title: pin.title,
    customIconName: pin.customIconName,
    iconColor: pin.iconColor,
    emoji: pin.emoji,
  }));
}

function shapesEqual(expected: PinShape[], actual: PinShape[]): { equal: boolean; diff?: string }
{
  if (expected.length !== actual.length)
  {
    return { equal: false, diff: `length: expected ${expected.length}, got ${actual.length}` };
  }
  const fields: (keyof PinShape)[] = ['url', 'title', 'customIconName', 'iconColor', 'emoji'];
  for (let i = 0; i < expected.length; i++)
  {
    for (const field of fields)
    {
      if (expected[i][field] !== actual[i][field])
      {
        return {
          equal: false,
          diff: `[${i}] ${field}: expected "${expected[i][field]}", got "${actual[i][field]}"`,
        };
      }
    }
  }
  return { equal: true };
}

function formatShapes(shapes: PinShape[]): string
{
  if (shapes.length === 0) return '    (empty)';
  return shapes.map((s, i) =>
  {
    const parts = [s.url.replace(TEST_URL_PREFIX, '#'), `"${s.title}"`];
    if (s.customIconName) parts.push(`icon=${s.customIconName}/${s.iconColor ?? ''}`);
    if (s.emoji) parts.push(`emoji=${s.emoji}`);
    return `    [${i}] ${parts.join(' ')}`;
  }).join('\n');
}

// --- Test Cases ---

const TEST_CASES: TestCase[] = [
  {
    name: 'Case 1: Single pin delete',
    pins: [{ n: 1, selected: true }],
  },
  {
    name: 'Case 2: Multiple pins delete (all)',
    pins: [{ n: 1, selected: true }, { n: 2, selected: true }, { n: 3, selected: true }],
  },
  {
    name: 'Case 3: Delete first pin',
    pins: [{ n: 1, selected: true }, { n: 2 }, { n: 3 }],
  },
  {
    name: 'Case 4: Delete middle pin',
    pins: [{ n: 1 }, { n: 2, selected: true }, { n: 3 }],
  },
  {
    name: 'Case 5: Delete last pin',
    pins: [{ n: 1 }, { n: 2 }, { n: 3, selected: true }],
  },
  {
    name: 'Case 6: Pin with associated tab',
    pins: [{ n: 1, selected: true, withTab: true }],
  },
  {
    name: 'Case 7: Undo brings back custom icon and emoji',
    pins: [
      { n: 1, selected: true, customIconName: 'Star', iconColor: '#ef4444' },
      { n: 2 },
      { n: 3, selected: true, emoji: '😀' },
    ],
  },
  {
    name: 'Case 8: Delete first and last',
    pins: [{ n: 1, selected: true }, { n: 2 }, { n: 3 }, { n: 4, selected: true }],
  },
];

// --- Test Runner ---

async function runCase(
  testCase: TestCase,
  rootId: string,
  windowId: number,
  testTabIds: number[]
): Promise<string | null>
{
  const spaceFolder = await chrome.bookmarks.create({ parentId: rootId, title: TEST_SPACE_FOLDER_TITLE });
  const favorites = await ensureFavoritesFolder(
    {
      getChildren: (id) => chrome.bookmarks.getChildren(id),
      create: (bookmark) => chrome.bookmarks.create(bookmark),
    },
    spaceFolder.id
  );

  const pinIdOf = new Map<number, string>();
  for (const pin of testCase.pins)
  {
    const node = await chrome.bookmarks.create({ parentId: favorites.id, title: `Pin ${pin.n}`, url: testUrl(pin.n) });
    pinIdOf.set(pin.n, node.id);
    const icons = iconsOf(pin);
    if (icons.customIconName || icons.emoji)
    {
      await favoriteIconsManagerProxy.restoreIcons(node.id, icons);
    }
  }

  const tabOfPin = new Map<string, number>();
  for (const pin of testCase.pins)
  {
    if (!pin.withTab) continue;
    const tab = await chrome.tabs.create({ url: testUrl(pin.n), active: false, windowId });
    if (tab.id === undefined) continue;
    testTabIds.push(tab.id);
    tabOfPin.set(pinIdOf.get(pin.n)!, tab.id);
  }
  await settle();

  const originalShapes = testCase.pins.map(testPinToShape);
  const setupPins = await readPins(favorites.id);
  console.log(`  Setup:\n${formatShapes(pinsToShapes(setupPins))}`);
  const setupCheck = shapesEqual(originalShapes, pinsToShapes(setupPins));
  if (!setupCheck.equal) return `Setup: ${setupCheck.diff}`;

  const selectedIds = testCase.pins.filter(p => p.selected).map(p => pinIdOf.get(p.n)!);
  const restoredAssociations: Array<{ tabId: number; itemKey: string }> = [];

  const action = new DeletePinnedSiteAction(
    selectedIds,
    () => setupPins,
    (pinnedId) => tabOfPin.get(pinnedId),
    undefined,
    async (tabId, itemKey) => { restoredAssociations.push({ tabId, itemKey }); }
  );

  // --- do() ---
  await action.do();
  await settle();

  const afterDoPins = await readPins(favorites.id);
  console.log(`  After do():\n${formatShapes(pinsToShapes(afterDoPins))}`);
  console.log(`  Description: "${action.description}"`);
  const expectedAfterDo = testCase.pins.filter(p => !p.selected).map(testPinToShape);
  const doCheck = shapesEqual(expectedAfterDo, pinsToShapes(afterDoPins));
  if (!doCheck.equal) return `After do(): ${doCheck.diff}`;

  for (const id of selectedIds)
  {
    const removed = await chrome.bookmarks.get(id).then(() => false, () => true);
    if (!removed) return `Bookmark ${id} still exists after do()`;
  }

  // Unpin keeps the tab open so it can reappear in Tabs
  for (const tabId of tabOfPin.values())
  {
    const open = await chrome.tabs.get(tabId).then(() => true, () => false);
    if (!open) return `Tab ${tabId} should remain open after Unpin`;
  }

  // --- undo() ---
  await action.undo();
  await settle();

  const afterUndoPins = await readPins(favorites.id);
  console.log(`  After undo():\n${formatShapes(pinsToShapes(afterUndoPins))}`);
  const undoCheck = shapesEqual(originalShapes, pinsToShapes(afterUndoPins));
  if (!undoCheck.equal) return `After undo(): ${undoCheck.diff}`;

  // The tab follows its Favorite to the recreated bookmark's id
  for (const [oldId, tabId] of tabOfPin)
  {
    const pin = testCase.pins.find(p => pinIdOf.get(p.n) === oldId)!;
    const restored = afterUndoPins.find(p => p.url === testUrl(pin.n));
    const expectedKey = `pinned-${restored?.id}`;
    const association = restoredAssociations.find(a => a.tabId === tabId);
    if (!association || association.itemKey !== expectedKey)
    {
      return `Tab ${tabId}: expected association ${expectedKey}, got ${association?.itemKey ?? 'none'}`;
    }
  }

  return null;
}

export async function runDeletePinnedSiteTests(
  onShowToast: (message: string) => void
): Promise<void>
{
  console.log('=== DeletePinnedSiteAction Tests ===');

  const windowId = await new Promise<number>((resolve) =>
  {
    chrome.windows.getCurrent((win) => resolve(win.id!));
  });

  const results: TestResult[] = [];
  let rootId: string;
  try
  {
    rootId = await writableRootId();
  }
  catch (err)
  {
    onShowToast(`Tests could not start: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  for (const testCase of TEST_CASES)
  {
    console.log(`\n--- ${testCase.name} ---`);
    const testTabIds: number[] = [];

    try
    {
      const error = await runCase(testCase, rootId, windowId, testTabIds);
      if (error)
      {
        console.error(`  FAIL ${error}`);
        results.push({ name: testCase.name, passed: false, error });
      }
      else
      {
        console.log('  PASS');
        results.push({ name: testCase.name, passed: true });
      }
    }
    catch (err)
    {
      const error = `Exception: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`  FAIL ${error}`);
      results.push({ name: testCase.name, passed: false, error });
    }
    finally
    {
      for (const tabId of testTabIds)
      {
        try { await chrome.tabs.remove(tabId); }
        catch { /* ignore */ }
      }
      // background drops the icon entries of the removed bookmarks
      const leftovers = (await chrome.bookmarks.getChildren(rootId))
        .filter(node => !node.url && node.title === TEST_SPACE_FOLDER_TITLE);
      for (const folder of leftovers)
      {
        try { await chrome.bookmarks.removeTree(folder.id); }
        catch { /* ignore */ }
      }
      await settle();
    }
  }

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log('\n--- Results ---');
  for (const r of results)
  {
    if (r.passed)
    {
      console.log(`✓ ${r.name}`);
    }
    else
    {
      console.error(`✗ ${r.name}: ${r.error}`);
    }
  }
  console.log(`${passed}/${results.length} passed`);

  if (failed === 0)
  {
    onShowToast(`All ${passed} tests passed`);
  }
  else
  {
    onShowToast(`${failed}/${results.length} tests failed — see console`);
  }
}
