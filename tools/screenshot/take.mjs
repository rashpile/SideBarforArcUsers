// Takes the README screenshot (asset/sidebar.png) from dist/ with the fake profile in
// fake-data.mjs. Run with `make screenshot`; it needs the network for favicons and page titles.
//
// Headless Chromium has no Side Panel, so the sidebar page opens in its own popup window. The
// sidebar takes "its" window from chrome.windows.getCurrent and chrome.tabs.query({currentWindow}),
// which would point at the popup; an init script points both at the window holding the fake tabs.

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { SPACES, FAVORITES } from './fake-data.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = path.join(ROOT, 'dist');
const WORK = path.join(ROOT, 'tmp/screenshot');
const PROFILE = path.join(WORK, 'profile');
const OUTPUT = path.join(ROOT, 'asset/sidebar.png');
const SIDEBAR = { width: 340, height: 800 };

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH ?? path.join(WORK, 'node_modules/playwright'));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Chrome only has a favicon for a page it has loaded, so every URL is visited once first
async function warmFavicons(context, urls)
{
  const page = await context.newPage();
  for (const url of urls)
  {
    await page.goto(url, { waitUntil: 'load', timeout: 20000 }).catch(() => {});
    await sleep(500);
  }
  await page.close();
}

async function seed(page, version)
{
  await page.evaluate(async ({ spaces, favorites, version }) =>
  {
    const [tree] = await chrome.bookmarks.getTree();
    const bar = tree.children.find((node) => node.folderType === 'bookmarks-bar') ?? tree.children[0];

    async function create(parentId, items)
    {
      for (const item of items)
      {
        const node = await chrome.bookmarks.create({ parentId, title: item.title, url: item.url });
        if (item.children) await create(node.id, item.children);
      }
    }

    const storedSpaces = [];
    for (const space of spaces)
    {
      const folder = await chrome.bookmarks.create({ parentId: bar.id, title: space.name });
      await create(folder.id, space.folder);
      if (space.archive)
      {
        const archive = await chrome.bookmarks.create({ parentId: folder.id, title: 'asd_Archive' });
        await create(archive.id, space.archive);
      }
      storedSpaces.push({
        id: space.id,
        name: space.name,
        icon: space.icon,
        color: space.color,
        bookmarkFolderPath: `${bar.title}/${space.name}`,
        bookmarkFolderSegments: [bar.title, space.name],
      });
    }

    // Spaces and Favorites go through their background managers, as the sidebar's own edits do
    const call = (manager, method, payload) =>
      chrome.runtime.sendMessage({ action: `${manager}_msg_${method}`, ...payload });
    await call('SpaceManager', 'updateSpaces', { spaces: storedSpaces });
    await call('PinnedSitesManager', 'replaceAll', {
      sites: favorites.map((site, i) => ({ id: `pin-${i}`, url: site.url, title: site.title })),
    });
    const [win] = await chrome.windows.getAll({ windowTypes: ['normal'] });
    await call('SpaceWindowStateManager', 'setActiveSpace', { windowId: win.id, spaceId: storedSpaces[0].id });

    // Skips the Welcome dialog of a new install
    await chrome.storage.local.set({ 'sidebar-last-seen-version': version });
    localStorage.setItem('sidebar-use-space-color', 'true');
  }, { spaces: SPACES, favorites: FAVORITES, version });
}

function pointSidebarAtWindow({ windowId })
{
  if (location.protocol !== 'chrome-extension:' || location.pathname !== '/index.html') return;
  const getWindow = () => chrome.windows.get(windowId);
  chrome.windows.getCurrent = (...args) =>
  {
    const callback = args.find((arg) => typeof arg === 'function');
    if (!callback) return getWindow();
    getWindow().then(callback);
  };
  const query = chrome.tabs.query.bind(chrome.tabs);
  chrome.tabs.query = (info, callback) =>
  {
    const scoped = info?.currentWindow ? { ...info, currentWindow: undefined, windowId } : info;
    return callback ? query(scoped, callback) : query(scoped);
  };
}

async function openSidebar(context, helper, windowId)
{
  await context.addInitScript(pointSidebarAtWindow, { windowId });
  const opened = context.waitForEvent('page', (page) => page.url().endsWith('/index.html'));
  await helper.evaluate(({ width, height }) =>
    chrome.windows.create({ url: chrome.runtime.getURL('index.html'), type: 'popup', width, height }), SIDEBAR);
  const sidebar = await opened;
  await sidebar.setViewportSize(SIDEBAR);
  await sidebar.waitForLoadState('load');
  await sleep(2500);
  return sidebar;
}

async function stage(sidebar, space)
{
  for (const title of space.open)
  {
    await sidebar.getByText(title, { exact: true }).first().click();
    await sleep(2500);
  }
  for (const title of space.expand ?? [])
  {
    await sidebar.getByText(title, { exact: true }).first().click();
    await sleep(500);
  }
  // A click leaves the row selected; a click on the empty space under the Tab list clears it
  await sidebar.mouse.click(SIDEBAR.width / 2, SIDEBAR.height - 65);
  await sidebar.mouse.move(0, SIDEBAR.height - 1);
  await sleep(1000);
}

async function compose(context, light, dark)
{
  const image = (file) => `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
  const page = await context.newPage();
  await page.setViewportSize({ width: 2 * SIDEBAR.width + 3 * 48, height: SIDEBAR.height + 2 * 48 });
  await page.setContent(`<!doctype html>
    <style>
      body { margin: 0; display: flex; gap: 48px; padding: 48px;
        background: linear-gradient(135deg, #e8e4ff 0%, #f4e9f7 50%, #e3eefc 100%); }
      img { width: ${SIDEBAR.width}px; height: ${SIDEBAR.height}px; border-radius: 14px;
        box-shadow: 0 18px 50px rgba(40, 30, 90, 0.22), 0 0 0 1px rgba(40, 30, 90, 0.08); }
    </style>
    <img src="${image(light)}"><img src="${image(dark)}">`);
  await page.screenshot({ path: OUTPUT });
  await page.close();
}

async function main()
{
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const context = await chromium.launchPersistentContext(PROFILE, {
    channel: 'chromium',
    headless: true,
    deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const version = JSON.parse(fs.readFileSync(path.join(DIST, 'manifest.json'), 'utf8')).version;

  await warmFavicons(context, [
    ...FAVORITES.map((site) => site.url),
    ...SPACES.flatMap((space) => [
      ...space.folder.flatMap((item) => item.children ? item.children.map((c) => c.url) : [item.url]),
      ...(space.tabs ?? []),
    ]),
  ]);

  const helper = await context.newPage();
  await helper.goto(`chrome-extension://${id}/switcher.html`);
  await seed(helper, version);

  // The sidebar shows the first normal window, which gets the first Space's tabs
  const space = SPACES[0];
  const windowId = await helper.evaluate(async () => (await chrome.windows.getAll({ windowTypes: ['normal'] }))[0].id);
  for (const url of space.tabs)
  {
    await helper.evaluate((args) => chrome.tabs.create({ ...args, active: false }), { url, windowId });
  }
  await sleep(4000);

  const sidebar = await openSidebar(context, helper, windowId);
  await stage(sidebar, space);

  fs.mkdirSync(WORK, { recursive: true });
  const light = path.join(WORK, 'light.png');
  const dark = path.join(WORK, 'dark.png');
  await sidebar.emulateMedia({ colorScheme: 'light' });
  await sidebar.screenshot({ path: light });
  await sidebar.emulateMedia({ colorScheme: 'dark' });
  await sleep(300);
  await sidebar.screenshot({ path: dark });

  await compose(context, light, dark);
  await context.close();
  console.log(`Wrote ${path.relative(ROOT, OUTPUT)}`);
}

await main();
