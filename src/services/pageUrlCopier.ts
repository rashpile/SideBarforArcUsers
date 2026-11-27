// PageUrlCopier - the background half of the copy-page-url shortcut.
//
// The service worker has no DOM, and a copy inside the page fails when the page has no focus (the
// side panel has it), so an offscreen document does the copy. On pages the extension can script, a
// short toast confirms it.

import {
  createCopyToClipboardRequest,
  type CopyToClipboardResponse,
} from '../utils/offscreenClipboardMessage.ts';
import { getEffectiveTabUrl } from '../utils/parkedTabAssociation.ts';

export const COPY_PAGE_URL_COMMAND = 'copy-page-url';

const OFFSCREEN_PAGE = 'offscreen.html';
const OFFSCREEN_JUSTIFICATION = 'Copy the current page URL to the clipboard when the user presses the shortcut';

// Injected into the page: no closures, no imports, everything it needs is inside it
function showCopiedToast(): void
{
  const HOST_ATTRIBUTE = 'data-arc-sidebar-url-copied-toast';
  const DURATION_MS = 1500;

  // A repeated press replaces the toast instead of stacking another one
  document.querySelectorAll(`[${HOST_ATTRIBUTE}]`).forEach(element => element.remove());

  const host = document.createElement('div');
  host.setAttribute(HOST_ATTRIBUTE, '');
  host.style.cssText = 'all: initial; position: fixed; top: 16px; left: 50%; transform: translateX(-50%);'
    + ' z-index: 2147483647; pointer-events: none;';

  // Closed, so the page's styles and scripts can't reach into it
  const shadow = host.attachShadow({ mode: 'closed' });
  const toast = document.createElement('div');
  toast.textContent = 'URL copied';
  toast.style.cssText = 'font: 500 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;'
    + ' color: #fff; background: rgba(32, 33, 36, 0.92); padding: 8px 14px; border-radius: 8px;'
    + ' box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25); white-space: nowrap;';
  shadow.appendChild(toast);

  (document.body ?? document.documentElement).appendChild(host);
  // Removes only its own host: a newer press's toast stays for its full time
  setTimeout(() => host.remove(), DURATION_MS);
}

export class PageUrlCopier
{
  readonly #debug: boolean;
  // Shared by presses that come in while the document is being created: a second createDocument
  // fails with "Only a single offscreen document may be created"
  #creating: Promise<void> | undefined;

  constructor(debug: boolean)
  {
    this.#debug = debug;
  }

  async copyActiveTabUrl(): Promise<void>
  {
    try
    {
      // windowTypes skips the Tab Switcher and search popup windows
      const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
      if (win.id === undefined) return;
      const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
      if (!tab) return;
      // A tab parked by a tab suspender copies the page it stands for
      const url = getEffectiveTabUrl(tab.url);
      if (!url) return;

      await this.#ensureOffscreenDocument();
      const response: CopyToClipboardResponse | undefined =
        await chrome.runtime.sendMessage(createCopyToClipboardRequest(url));
      if (!response?.ok)
      {
        console.error('[PageUrlCopier] the offscreen document could not copy the URL');
        return;
      }

      if (tab.id !== undefined) await this.#showToast(tab.id);
    }
    catch (error)
    {
      console.error('[PageUrlCopier] failed to copy the page URL:', error);
    }
  }

  // The document stays open once created: a CLIPBOARD document doesn't close on its own, and an
  // idle one only ignores the background's broadcasts
  async #ensureOffscreenDocument(): Promise<void>
  {
    // The context may show up before its page has loaded and registered its listener
    if (this.#creating)
    {
      await this.#creating;
      return;
    }

    // The document outlives a service-worker restart, this object's memory doesn't
    const documentUrl = chrome.runtime.getURL(OFFSCREEN_PAGE);
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [documentUrl],
    });
    if (contexts.length > 0) return;

    // Another press may have started the creation while getContexts was running
    this.#creating ??= chrome.offscreen.createDocument({
      url: OFFSCREEN_PAGE,
      reasons: [chrome.offscreen.Reason.CLIPBOARD],
      justification: OFFSCREEN_JUSTIFICATION,
    }).finally(() =>
    {
      // Cleared on failure too, so the next press tries again
      this.#creating = undefined;
    });
    await this.#creating;
  }

  async #showToast(tabId: number): Promise<void>
  {
    try
    {
      await chrome.scripting.executeScript({ target: { tabId }, func: showCopiedToast });
    }
    catch (error)
    {
      // chrome:// pages, the Web Store and the PDF viewer refuse scripts; the URL is copied anyway
      this.#log('no toast on this page:', error);
    }
  }

  #log(...args: unknown[]): void
  {
    if (this.#debug)
    {
      console.log('[PageUrlCopier]', ...args);
    }
  }
}
