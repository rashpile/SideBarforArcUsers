// The page agent's access to a real tab: page scripts through chrome.scripting.executeScript, the
// stylesheet through insertCSS / removeCSS, screenshots through ActiveTabCapture, the answer popup
// through runPagePopupCommand. Every call names its tab; nothing here looks up the active tab.
// Scripts and CSS go to the top frame only.

import { parseMarkdown } from '../../utils/markdown.ts';
import { PAGE_AGENT_CSS_ORIGIN, PAGE_AGENT_MARKER_PROPERTY } from '../../utils/pageAgentCss.ts';
import { readReadablePage } from '../../utils/readablePage.ts';
import type { ReadablePage } from '../../utils/readablePage.ts';
import { ActiveTabCapture, screenshotsUnavailable } from './activeTabCapture.ts';
import type { PageAgentAnswer, PageAgentCapture, PageAgentPageAdapter } from './pageAgentRun.ts';
import { runPagePopupCommand } from './pagePopup.ts';
import type { PagePopupCommand, PagePopupEntry, PagePopupResult } from './pagePopup.ts';
import {
  collectPageOutline,
  formatInspectResult,
  formatPageOutline,
  inspectPageElements,
  readPageMarker,
} from './pageScripts.ts';
import type { OutlineLimits } from './pageScripts.ts';

const OUTLINE_LIMITS: OutlineLimits = {
  maxNodes: 250,
  maxDepth: 12,
  maxElements: 20000,
  minAreaRatio: 0.02,
  textLength: 40,
};
const OUTLINE_MAX_CHARS = 12000;
const INSPECT_MAX_MATCHES = 3;
const INSPECT_MAX_CHARS = 12000;
const SCREENSHOT_MAX_WIDTH = 1280;
const SCREENSHOT_JPEG_QUALITY = 0.8;
const PAGE_TEXT_MAX_CHARS = 30000;

export class ChromePageAdapter implements PageAgentPageAdapter
{
  readonly #capture: ActiveTabCapture;

  constructor()
  {
    this.#capture = new ActiveTabCapture(chrome.tabs);
  }

  async outline(tabId: number): Promise<string>
  {
    const raw = await runInTab(tabId, collectPageOutline, [OUTLINE_LIMITS]);
    return formatPageOutline(raw, OUTLINE_MAX_CHARS);
  }

  async inspect(tabId: number, selectors: string[]): Promise<string>
  {
    const raw = await runInTab(tabId, inspectPageElements, [selectors, INSPECT_MAX_MATCHES]);
    return formatInspectResult(raw, INSPECT_MAX_CHARS);
  }

  /** The page's readable text as JSON for the model: `{ url, title, text, note? }`. */
  async readText(tabId: number): Promise<string>
  {
    const page = await runInTab(tabId, readReadablePage, [PAGE_TEXT_MAX_CHARS, 'main-first']);
    return formatPageText(page, PAGE_TEXT_MAX_CHARS);
  }

  /** Replaces any popup on the page with one holding this answer. */
  async showPopup(tabId: number, title: string, answer: PageAgentAnswer): Promise<void>
  {
    const result = await runPopupCommand(tabId, { kind: 'open', title, entry: popupEntry(answer) });
    if (!result.shown)
    {
      throw new Error('The page did not show the popup');
    }
  }

  /** Adds the answer to the popup open on the page; false when there is none. */
  async appendToPopup(tabId: number, answer: PageAgentAnswer): Promise<boolean>
  {
    const result = await runPopupCommand(tabId, { kind: 'append', entry: popupEntry(answer) });
    return result.shown;
  }

  async insertCss(tabId: number, text: string): Promise<void>
  {
    await chrome.scripting.insertCSS({ target: { tabId }, css: text, origin: PAGE_AGENT_CSS_ORIGIN });
  }

  // Chrome finds the stylesheet by its exact text and origin, and does nothing when it's gone.
  async removeCss(tabId: number, text: string): Promise<void>
  {
    await chrome.scripting.removeCSS({ target: { tabId }, css: text, origin: PAGE_AGENT_CSS_ORIGIN });
  }

  /** The applied id of the agent's stylesheet on the page, or '' when the page has none. */
  async readMarker(tabId: number): Promise<string>
  {
    return await runInTab(tabId, readPageMarker, [PAGE_AGENT_MARKER_PROPERTY]);
  }

  async pageUrl(tabId: number): Promise<string>
  {
    const tab = await chrome.tabs.get(tabId);
    return tab.url ?? '';
  }

  async capture(tabId: number): Promise<PageAgentCapture>
  {
    const capture = await this.#capture.capture(tabId);
    if ('unavailable' in capture)
    {
      return capture;
    }
    try
    {
      return { dataUrl: await downscaleImage(capture.dataUrl, SCREENSHOT_MAX_WIDTH) };
    }
    catch (error)
    {
      return { unavailable: screenshotsUnavailable(error) };
    }
  }
}

function formatPageText(page: ReadablePage, maxChars: number): string
{
  const cut = page.textLength > page.text.length;
  return JSON.stringify({
    url: page.url,
    title: page.title,
    text: page.text,
    ...(cut && { note: `cut at ${maxChars} of ${page.textLength} characters; the rest of the page is not shown` }),
  });
}

function popupEntry(answer: PageAgentAnswer): PagePopupEntry
{
  return { question: answer.question, blocks: parseMarkdown(answer.markdown) };
}

// injectImmediately: the append at the end of a turn shouldn't wait for a navigating tab's
// document_idle while the drawer still shows Stop.
async function runPopupCommand(tabId: number, command: PagePopupCommand): Promise<PagePopupResult>
{
  return await runInTab(tabId, runPagePopupCommand, [command], true);
}

// The default isolated world: page scripts can't replace the built-ins the injected function uses.
async function runInTab<Args extends unknown[], Result>(
  tabId: number,
  func: (...args: Args) => Result,
  args: Args,
  injectImmediately = false,
): Promise<Result>
{
  const results = await chrome.scripting.executeScript({ target: { tabId }, func, args, injectImmediately });
  const result = results[0]?.result;
  if (result === undefined || result === null)
  {
    throw new Error('The page script returned nothing; the page may still be loading or not allow scripts');
  }
  return result as Result;
}

// captureVisibleTab returns device pixels, twice the CSS width on a Retina screen. 1280 px wide is
// enough to judge a layout and keeps the request small.
async function downscaleImage(dataUrl: string, maxWidth: number): Promise<string>
{
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  try
  {
    if (bitmap.width <= maxWidth)
    {
      return dataUrl;
    }
    const height = Math.max(1, Math.round(bitmap.height * maxWidth / bitmap.width));
    const canvas = new OffscreenCanvas(maxWidth, height);
    const context = canvas.getContext('2d');
    if (!context)
    {
      throw new Error('no 2D canvas to scale the image');
    }
    context.drawImage(bitmap, 0, 0, maxWidth, height);
    const scaled = await canvas.convertToBlob({ type: 'image/jpeg', quality: SCREENSHOT_JPEG_QUALITY });
    return await blobToDataUrl(scaled);
  }
  finally
  {
    bitmap.close();
  }
}

function blobToDataUrl(blob: Blob): Promise<string>
{
  return new Promise((resolve, reject) =>
  {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('could not read the scaled image'));
    reader.readAsDataURL(blob);
  });
}
