import assert from 'node:assert/strict';
import test from 'node:test';

import { ActiveTabCapture, CAPTURE_NOT_VISIBLE } from '../src/services/pageAgent/activeTabCapture.ts';

const WINDOW_1 = 1;
const WINDOW_2 = 2;
const TAB_A = 11;
const TAB_B = 22;
const IMAGE = 'data:image/jpeg;base64,AAAA';

/** Tabs by id. As in Chrome, activating a tab deactivates the others in its window. */
class FakeTabs
{
  constructor(tabs)
  {
    this.tabs = new Map(tabs.map(tab => [tab.id, { ...tab }]));
    this.captures = [];
    this.duringCapture = () => {};
  }

  async get(tabId)
  {
    const tab = this.tabs.get(tabId);
    if (!tab)
    {
      throw new Error(`No tab with id: ${tabId}.`);
    }
    return { ...tab };
  }

  async captureVisibleTab(windowId, options)
  {
    this.captures.push({ windowId, options });
    this.duringCapture();
    return IMAGE;
  }

  activate(tabId)
  {
    const target = this.tabs.get(tabId);
    for (const tab of this.tabs.values())
    {
      if (tab.windowId === target.windowId)
      {
        tab.active = tab.id === tabId;
      }
    }
  }

  move(tabId, windowId)
  {
    const tab = this.tabs.get(tabId);
    tab.windowId = windowId;
    tab.active = true;
  }
}

function twoTabs(activeTabId)
{
  return new FakeTabs([
    { id: TAB_A, windowId: WINDOW_1, active: activeTabId === TAB_A },
    { id: TAB_B, windowId: WINDOW_1, active: activeTabId === TAB_B },
  ]);
}

test('a tab that is not active is not captured', async () =>
{
  const tabs = twoTabs(TAB_B);

  const result = await new ActiveTabCapture(tabs).capture(TAB_A);

  assert.deepEqual(result, { unavailable: CAPTURE_NOT_VISIBLE });
  assert.deepEqual(tabs.captures, []);
});

test('the image is discarded when another tab comes to the front during the capture', async () =>
{
  const tabs = twoTabs(TAB_A);
  tabs.duringCapture = () => tabs.activate(TAB_B);

  const result = await new ActiveTabCapture(tabs).capture(TAB_A);

  assert.equal(tabs.captures.length, 1);
  assert.deepEqual(result, { unavailable: CAPTURE_NOT_VISIBLE });
});

test('the image is discarded when the tab moves to another window during the capture', async () =>
{
  const tabs = twoTabs(TAB_A);
  tabs.duringCapture = () => tabs.move(TAB_A, WINDOW_2);

  const result = await new ActiveTabCapture(tabs).capture(TAB_A);

  assert.deepEqual(result, { unavailable: CAPTURE_NOT_VISIBLE });
});

test('a tab active before and after the capture gets its image, taken from its own window', async () =>
{
  const tabs = new FakeTabs([
    { id: TAB_B, windowId: WINDOW_1, active: true },
    { id: TAB_A, windowId: WINDOW_2, active: true },
  ]);

  const result = await new ActiveTabCapture(tabs).capture(TAB_A);

  assert.deepEqual(result, { dataUrl: IMAGE });
  assert.deepEqual(tabs.captures, [{ windowId: WINDOW_2, options: { format: 'jpeg', quality: 80 } }]);
});
