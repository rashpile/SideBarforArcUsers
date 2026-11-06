// Search popup frame - puts search.html in an iframe over the page; see src/services/searchPopup.ts
// for the flow. The popup page runs in the extension's own frame, so the page can't read the query
// and its keyboard shortcuts don't fire while the user types.
//
// It runs as a classic script, so it must not import anything. It is injected each time the popup
// opens over a page; a new copy first switches off the one before it, which may belong to an
// extension version that has since been reloaded.

(() =>
{
  const scope = globalThis as typeof globalThis & { __sidebarSearchFrameDispose?: () => void };
  scope.__sidebarSearchFrameDispose?.();

  // Repeats SearchFrameAction and SEARCH_FRAME_CLOSE_REQUEST in src/utils/searchPopupMessages.ts -
  // change both together
  const Action = {
    SHOW: 'search-frame-show',
    REMOVE: 'search-frame-remove',
    CLOSED: 'search-frame-closed',
  };
  const CLOSE_REQUEST = 'search-frame-close-request';

  // Read once while this copy's extension context is alive; a reload invalidates chrome.runtime
  const popupPageUrl = chrome.runtime.getURL('search.html');
  const extensionOrigin = new URL(popupPageUrl).origin;

  // `all: initial` on the host stops the page's inherited styles. color-scheme matters most: when the
  // iframe's differs from the popup page's, Chrome paints an opaque canvas behind the frame.
  // The height leaves 32px under the frame at any viewport height (12vh above + 88vh - 32px).
  const STYLES = `
    :host { all: initial; }
    .backdrop {
      position: fixed; inset: 0; z-index: 2147483647;
      display: flex; justify-content: center; align-items: flex-start;
      background: rgba(0, 0, 0, 0.25);
    }
    .frame {
      display: block; margin-top: 12vh;
      width: min(640px, 100vw - 32px); height: min(560px, 88vh - 32px);
      border: 0; border-radius: 14px; background: transparent;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
    }
  `;

  // The frame's DOM over the page, and the focus to give back when it goes
  class SearchFrame
  {
    #host: HTMLElement | undefined;
    #iframe: HTMLIFrameElement | undefined;
    #previousFocus: HTMLElement | null = null;
    #onDismiss: () => void;

    constructor(onDismiss: () => void)
    {
      this.#onDismiss = onDismiss;
    }

    get isShown(): boolean
    {
      return this.#host !== undefined;
    }

    isFrameWindow(source: MessageEventSource | null): boolean
    {
      return source !== null && source === this.#iframe?.contentWindow;
    }

    show(url: string): void
    {
      // A frame still up belongs to an older session and holds the focus now; the element to give
      // focus back to is still the one from before that frame
      if (!this.#host) this.#previousFocus = document.activeElement as HTMLElement | null;
      this.#host?.remove();

      const host = document.createElement('div');
      const root = host.attachShadow({ mode: 'closed' });
      root.innerHTML = `<style>${STYLES}</style><div class="backdrop"></div>`;
      const backdrop = root.querySelector<HTMLElement>('.backdrop')!;

      const iframe = document.createElement('iframe');
      iframe.className = 'frame';
      iframe.title = 'Search';
      iframe.setAttribute('allow', '');
      iframe.src = url;
      iframe.addEventListener('load', () => iframe.contentWindow?.focus());
      backdrop.append(iframe);

      // A press inside the iframe never reaches this document, so any mousedown here is outside it.
      // preventDefault keeps Chrome from moving focus after the focus is given back.
      backdrop.addEventListener('mousedown', (event) =>
      {
        if (event.target !== backdrop) return;
        event.preventDefault();
        this.#onDismiss();
      });

      document.documentElement.appendChild(host);
      this.#host = host;
      this.#iframe = iframe;
      // Take the focus from the page at once, so keys typed while search.html loads don't reach the
      // page's text field or shortcuts. The load handler then focuses the loaded page.
      iframe.focus({ preventScroll: true });
    }

    remove(): void
    {
      if (!this.#host) return;
      this.#host.remove();
      this.#host = undefined;
      this.#iframe = undefined;
      this.#previousFocus?.focus?.({ preventScroll: true });
      this.#previousFocus = null;
    }
  }

  function notifyClosed(): void
  {
    try
    {
      chrome.runtime.sendMessage({ action: Action.CLOSED }).catch(() => { /* no reply expected */ });
    }
    catch
    {
      // This copy's extension was reloaded; nothing is listening for it any more
    }
  }

  // The user closed the popup from the page side: background still has the session open
  function closeFromPage(): void
  {
    if (!frame.isShown) return;
    frame.remove();
    notifyClosed();
  }

  const frame = new SearchFrame(closeFromPage);
  const listeners = new AbortController();
  const { signal } = listeners;

  // The page window's blur is not a reason to close: focus moving into the iframe blurs it
  document.addEventListener('visibilitychange', () =>
  {
    if (document.hidden) closeFromPage();
  }, { signal });

  // The popup page asks to be removed when its port to background dropped. The page itself can
  // post messages to this window too, so only a real message from the frame's own window counts.
  window.addEventListener('message', (event) =>
  {
    if (!event.isTrusted || event.origin !== extensionOrigin || !frame.isFrameWindow(event.source)) return;
    if ((event.data as { type?: unknown } | null)?.type !== CLOSE_REQUEST) return;
    closeFromPage();
  }, { signal });

  const handleMessage = (
    message: { action?: string; url?: unknown },
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void
  ) =>
  {
    if (message?.action === Action.SHOW)
    {
      // Without focus (the omnibox, DevTools) the frame can't take the keys, and only the popup page
      // is ever framed; background opens the popup window instead
      const url = message.url;
      if (!document.hasFocus() || typeof url !== 'string' || !url.startsWith(popupPageUrl))
      {
        sendResponse({ shown: false });
        return;
      }
      frame.show(url);
      sendResponse({ shown: true });
    }
    else if (message?.action === Action.REMOVE)
    {
      frame.remove();
      sendResponse({ removed: true });
    }
  };
  chrome.runtime.onMessage.addListener(handleMessage);

  // Removes the frame without telling background - a newer copy of this script took over and is
  // about to show the new session's frame
  scope.__sidebarSearchFrameDispose = () =>
  {
    listeners.abort();
    frame.remove();
    // Throws when this copy's extension context was reloaded away
    try
    {
      chrome.runtime.onMessage.removeListener(handleMessage);
    }
    catch
    {
      // context gone
    }
  };
})();
