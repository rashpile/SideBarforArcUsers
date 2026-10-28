// Keyboard switcher list (spike) - see src/services/keyboardSwitcher.ts for the flow.
//
// One script for both places the list appears:
// - injected into the active tab's page, drawn in a shadow root over it
// - loaded by switcher.html, the popup window for pages that can't be scripted
// It runs as a classic script, so it must not import anything (the message
// names repeat src/utils/switcherMessages.ts). It is injected each time a list
// opens over a page; a new copy first switches off the one before it, which
// may belong to an extension version that has since been reloaded.

(() =>
{
  const scope = globalThis as typeof globalThis & { __sidebarSwitcherDispose?: () => void };
  scope.__sidebarSwitcherDispose?.();

  const Action = {
    SHOW: 'switcher-show',
    ICONS: 'switcher-icons',
    MOVE: 'switcher-move',
    READY: 'switcher-ready',
    COMMIT: 'switcher-commit',
    CANCEL: 'switcher-cancel',
  };

  // Matches the window sizing in src/services/keyboardSwitcher.ts
  const VISIBLE_CARDS = 8;
  const CARD_HEIGHT = 56;
  // The selection walks down to this card, then the list scrolls under it
  const SCROLL_ANCHOR = 3;

  const inSwitcherWindow = location.protocol === 'chrome-extension:';

  // src/utils/switcherMessages.ts SwitcherCard / SwitcherListData
  interface Card
  {
    id: string;
    title: string;
    subtitle: string;
    faviconPageUrl?: string;
    iconUrl?: string;
    iconText?: string;
    invertIconInDark?: boolean;
    badge?: string;
  }

  interface ListData
  {
    cards: Card[];
    steps: number;
    repeatKeyCode?: string;
  }

  const STYLES = `
    .backdrop {
      position: fixed; inset: 0; z-index: 2147483647;
      display: flex; align-items: center; justify-content: center;
      background: rgba(0, 0, 0, 0.25);
      font: 13px/1.3 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    }
    .backdrop.in-window { background: transparent; align-items: stretch; }
    .panel {
      width: 460px; padding: 8px; box-sizing: border-box; outline: none;
      border-radius: 14px; color: #1d1d1f;
      background: rgba(246, 246, 248, 0.94); backdrop-filter: blur(20px);
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
    }
    .in-window .panel { width: 100%; border-radius: 0; box-shadow: none; background: #f6f6f8; }
    .viewport { overflow: hidden; }
    .list { transition: transform 120ms ease; }
    .card {
      height: ${CARD_HEIGHT - 4}px; margin: 2px 0; padding: 0 12px; box-sizing: border-box;
      display: flex; align-items: center; gap: 12px; border-radius: 10px; cursor: default;
    }
    .card.selected { background: #0a84ff; color: #fff; }
    .icon {
      width: 20px; height: 20px; flex: none;
      display: flex; align-items: center; justify-content: center;
      font-size: 16px; font-weight: 600; line-height: 1;
    }
    .icon img { width: 20px; height: 20px; }
    .card.selected .icon img.glyph { filter: invert(1); }
    .text { flex: 1; min-width: 0; }
    .title, .subtitle { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .title { font-weight: 600; }
    .subtitle { font-size: 11px; opacity: 0.65; }
    .badge { flex: none; font-size: 10px; letter-spacing: 0.04em; text-transform: uppercase; opacity: 0.6; }
    .debug {
      height: 16px; padding: 6px 4px 0; overflow: hidden; white-space: nowrap;
      font: 11px ui-monospace, Menlo, monospace; opacity: 0.55;
    }
    @media (prefers-color-scheme: dark) {
      .panel { color: #f5f5f7; background: rgba(40, 40, 44, 0.94); }
      .in-window .panel { background: #28282c; }
      .icon img.glyph { filter: invert(1); }
    }
  `;

  // COMMIT and CANCEL get no reply, which rejects the promise
  function sendToBackground(message: Record<string, unknown>): void
  {
    chrome.runtime.sendMessage(message).catch(() => { /* no reply expected */ });
  }

  // Swaps the first letter in `icon` for the image once it loads, so an image
  // the page's Content-Security-Policy blocks leaves the letter in place
  function showImage(icon: HTMLElement, src: string, invertInDark?: boolean): void
  {
    const image = document.createElement('img');
    image.alt = '';
    if (invertInDark) image.className = 'glyph';
    image.addEventListener('load', () => icon.replaceChildren(image));
    image.src = src;
  }

  // The DOM of the list: cards in a fixed-height viewport, scrolled so the
  // selection stays at SCROLL_ANCHOR once there are more cards than fit
  class SwitcherView
  {
    #element = document.createElement('div');
    #panel: HTMLElement;
    #list: HTMLElement;
    #debug: HTMLElement;
    #cards: HTMLElement[];
    #icons = new Map<string, HTMLElement>();  // card id -> its icon box
    // Keyboard focus before the overlay took it, given back on close
    #previousFocus = document.activeElement as HTMLElement | null;

    constructor(cards: Card[], onPick: (index: number) => void, onDismiss: () => void)
    {
      const root = this.#element.attachShadow({ mode: 'closed' });
      root.innerHTML = `<style>${STYLES}</style>
        <div class="backdrop${inSwitcherWindow ? ' in-window' : ''}">
          <div class="panel" tabindex="-1">
            <div class="viewport"><div class="list"></div></div>
            <div class="debug"></div>
          </div>
        </div>`;

      const backdrop = root.querySelector<HTMLElement>('.backdrop')!;
      this.#panel = root.querySelector<HTMLElement>('.panel')!;
      this.#list = root.querySelector<HTMLElement>('.list')!;
      this.#debug = root.querySelector<HTMLElement>('.debug')!;
      root.querySelector<HTMLElement>('.viewport')!.style.height =
        `${Math.min(cards.length, VISIBLE_CARDS) * CARD_HEIGHT}px`;

      this.#cards = cards.map((card, index) => this.#buildCard(card, () => onPick(index)));
      this.#list.append(...this.#cards);

      if (!inSwitcherWindow)
      {
        backdrop.addEventListener('mousedown', (event) =>
        {
          if (event.target === backdrop) onDismiss();
        });
      }

      (inSwitcherWindow ? document.body : document.documentElement).appendChild(this.#element);
      // Take keyboard focus from the page, including a focused iframe whose key
      // events would never reach this document
      if (!inSwitcherWindow) this.#panel.focus({ preventScroll: true });
    }

    render(selected: number): void
    {
      this.#cards.forEach((card, index) => card.classList.toggle('selected', index === selected));
      const maxOffset = Math.max(0, this.#cards.length - VISIBLE_CARDS);
      const offset = Math.min(Math.max(selected - SCROLL_ANCHOR, 0), maxOffset);
      this.#list.style.transform = `translateY(${-offset * CARD_HEIGHT}px)`;
    }

    log(text: string): void
    {
      this.#debug.textContent = text;
    }

    setIcons(icons: Record<string, string>): void
    {
      for (const [cardId, src] of Object.entries(icons))
      {
        const icon = this.#icons.get(cardId);
        if (icon) showImage(icon, src);
      }
    }

    destroy(): void
    {
      this.#element.remove();
      if (!inSwitcherWindow) this.#previousFocus?.focus?.({ preventScroll: true });
    }

    #buildCard(card: Card, onClick: () => void): HTMLElement
    {
      const row = document.createElement('div');
      row.className = 'card';
      row.addEventListener('click', onClick);

      const text = document.createElement('div');
      text.className = 'text';
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = card.title;
      const subtitle = document.createElement('div');
      subtitle.className = 'subtitle';
      subtitle.textContent = card.subtitle;
      text.append(title, subtitle);

      row.append(this.#buildIcon(card), text);
      if (card.badge)
      {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = card.badge;
        row.append(badge);
      }
      return row;
    }

    // An emoji, or the title's first letter until an image replaces it. Over a
    // page a tab's favicon arrives later through setIcons; the switcher window,
    // an extension page, loads _favicon directly.
    #buildIcon(card: Card): HTMLElement
    {
      const icon = document.createElement('div');
      icon.className = 'icon';
      this.#icons.set(card.id, icon);

      if (card.iconText)
      {
        icon.textContent = card.iconText;
        return icon;
      }

      icon.textContent = card.title.trim().charAt(0).toUpperCase();
      const favicon = inSwitcherWindow && card.faviconPageUrl
        ? chrome.runtime.getURL(`_favicon/?pageUrl=${encodeURIComponent(card.faviconPageUrl)}&size=32`)
        : undefined;
      const src = card.iconUrl ?? favicon;
      if (src) showImage(icon, src, card.invertIconInDark);
      return icon;
    }
  }

  // Selection state and the open / commit / cancel lifecycle
  class SwitcherList
  {
    #cards: Card[] = [];
    #selected = 0;
    #repeatKeyCode: string | undefined;
    #view: SwitcherView | undefined;
    // This copy of the script was loaded for a list that hasn't arrived yet.
    // Cleared once it shows, so a key released later on the page is ignored.
    #awaitingShow = true;
    // The modifier was released after this script loaded but before the list arrived
    #commitWhenShown = false;

    get isOpen(): boolean
    {
      return this.#view !== undefined;
    }

    show(data: ListData): void
    {
      this.#awaitingShow = false;
      this.#view?.destroy();
      this.#cards = data.cards;
      this.#selected = 0;
      this.#repeatKeyCode = data.repeatKeyCode;
      this.#view = new SwitcherView(
        data.cards,
        (index) =>
        {
          this.#selected = index;
          this.commit('click');
        },
        () => this.cancel('click outside'),
      );
      this.move(data.steps, 'open');

      if (this.#commitWhenShown) this.commit('modifier released before the list loaded');
    }

    move(steps: number, source: string): void
    {
      if (!this.#view || this.#cards.length === 0) return;
      const count = this.#cards.length;
      this.#selected = (((this.#selected + steps) % count) + count) % count;
      this.#view.render(this.#selected);
      this.log(`${source} ${steps > 0 ? '+' : ''}${steps} → ${this.#selected + 1}/${count}`);
    }

    // +1 / -1 for keys that move the selection, 0 for anything else
    stepForKey(event: KeyboardEvent): number
    {
      if (event.code === 'ArrowDown') return 1;
      if (event.code === 'ArrowUp') return -1;
      if (event.code === 'Tab' || event.code === this.#repeatKeyCode) return event.shiftKey ? -1 : 1;
      return 0;
    }

    // A release that came before this script loaded reached no listener at all.
    // Any later input without a modifier shows it is already up, so that input
    // picks the selection instead.
    commitIfModifierUp(event: KeyboardEvent | PointerEvent, source: string): boolean
    {
      if (!this.#view || event.metaKey || event.ctrlKey || event.altKey) return false;
      this.commit(`${source} without modifier`);
      return true;
    }

    setIcons(icons: Record<string, string>): void
    {
      this.#view?.setIcons(icons);
    }

    commit(reason: string): void
    {
      if (!this.#view)
      {
        if (this.#awaitingShow) this.#commitWhenShown = true;
        return;
      }
      const card = this.#cards[this.#selected];
      this.#close();
      if (card) sendToBackground({ action: Action.COMMIT, id: card.id, reason });
    }

    cancel(reason: string): void
    {
      if (!this.#view) return;
      this.#close();
      sendToBackground({ action: Action.CANCEL, reason });
    }

    // Removes the list without telling the background - a newer copy of this script took over
    dispose(): void
    {
      this.#close();
    }

    log(text: string): void
    {
      this.#view?.log(text);
    }

    #close(): void
    {
      this.#view?.destroy();
      this.#view = undefined;
    }
  }

  function describeKey(event: KeyboardEvent): string
  {
    const modifiers = [
      event.metaKey && 'Cmd',
      event.ctrlKey && 'Ctrl',
      event.altKey && 'Alt',
      event.shiftKey && 'Shift',
    ].filter(Boolean);
    return [...modifiers, event.code].join('+');
  }

  const list = new SwitcherList();
  const listeners = new AbortController();
  const { signal } = listeners;

  window.addEventListener('keydown', (event) =>
  {
    if (!list.isOpen) return;

    const step = list.stepForKey(event);
    if (event.key === 'Escape') list.cancel('Esc');
    else if (event.key === 'Enter') list.commit('Enter');
    else if (list.commitIfModifierUp(event, `keydown ${describeKey(event)}`)) { /* picked */ }
    else if (step !== 0) list.move(step, `keydown ${describeKey(event)}`);
    else
    {
      list.log(`keydown ${describeKey(event)}`);
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  }, { capture: true, signal });

  // Letting go of the modifier picks the selected card. Any key coming up with
  // no modifier held means it is up, including the shortcut's own key when the
  // modifier was released first.
  window.addEventListener('keyup', (event) =>
  {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    list.commit(`keyup ${describeKey(event)}`);
  }, { capture: true, signal });

  // Chrome also sends zero-movement moves when the overlay appears under a
  // still pointer; only a real move tells the modifier's state
  window.addEventListener('pointermove', (event) =>
  {
    if (event.movementX === 0 && event.movementY === 0) return;
    list.commitIfModifierUp(event, 'pointer moved');
  }, { capture: true, signal });

  window.addEventListener('blur', () => list.cancel('focus left'), { signal });
  document.addEventListener('visibilitychange', () =>
  {
    if (document.hidden) list.cancel('page hidden');
  }, { signal });

  const handleMessage = (
    message: { action?: string; steps?: number; icons?: Record<string, string> } & Partial<ListData>,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void
  ) =>
  {
    if (message?.action === Action.SHOW)
    {
      // Without focus the page never sees the modifier released
      if (!document.hasFocus())
      {
        sendResponse({ shown: false });
        return;
      }
      list.show(message as ListData);
      sendResponse({ shown: true });
    }
    else if (message?.action === Action.MOVE && list.isOpen)
    {
      list.move(message.steps ?? 0, 'command');
      sendResponse({ ok: true });
    }
    else if (message?.action === Action.ICONS && list.isOpen)
    {
      list.setIcons(message.icons ?? {});
      sendResponse({ ok: true });
    }
  };
  chrome.runtime.onMessage.addListener(handleMessage);

  scope.__sidebarSwitcherDispose = () =>
  {
    listeners.abort();
    list.dispose();
    // Throws when this copy's extension context was reloaded away
    try { chrome.runtime.onMessage.removeListener(handleMessage); }
    catch { /* context gone */ }
  };

  if (inSwitcherWindow)
  {
    chrome.runtime.sendMessage({ action: Action.READY }).then((response?: ListData) =>
    {
      if (response?.cards) list.show(response);
      else window.close();
    });
  }
})();

export {};
