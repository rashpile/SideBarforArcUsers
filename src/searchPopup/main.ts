// The search popup page (search.html), shown in an iframe over the page (put there by
// searchPopupFrame.js) or in a popup window (?host=window). Search and picking run in background
// (src/services/searchPopup.ts): this page shows the rows it gets and sends back what the user
// typed and picked, by opaque row id.

import { SearchKeyboard } from './searchKeyboard.ts';
import {
  SEARCH_FRAME_CLOSE_REQUEST,
  SEARCH_POPUP_PING_MS,
  SEARCH_POPUP_PORT_PREFIX,
  SEARCH_SCOPES,
} from '../utils/searchPopupMessages.ts';
import type {
  SearchBackgroundMessage,
  SearchItemKind,
  SearchPageMessage,
  SearchRow,
  SearchScope,
} from '../utils/searchPopupMessages.ts';
import './searchPopup.css';

const SCOPE_LABELS: Record<SearchScope, string> = {
  all: 'All',
  tabs: 'Open tabs',
  bookmarks: 'Bookmarks',
  archive: 'Archive',
  closed: 'Recently closed',
};

const KIND_LABELS: Record<SearchItemKind, string> = {
  tab: 'Tab',
  bookmark: 'Bookmark',
  archive: 'Archive',
  closed: 'Closed',
};

const params = new URLSearchParams(location.search);
const inPopupWindow = params.get('host') === 'window';
const sessionId = params.get('session') ?? '';
const spacesHint = navigator.userAgent.includes('Mac') ? '⌥A' : 'Alt+A';

// Clicks on these keep the focus, and so the typing, in the search field
function keepFocusOnPress(element: HTMLElement): void
{
  element.addEventListener('mousedown', (event) => event.preventDefault());
}

// The first letter of the title until the favicon loads
function buildIcon(row: SearchRow): HTMLElement
{
  const icon = document.createElement('span');
  icon.className = 'icon';
  icon.textContent = row.title.trim().charAt(0).toUpperCase();
  if (row.faviconPageUrl)
  {
    const image = document.createElement('img');
    image.alt = '';
    image.addEventListener('load', () => icon.replaceChildren(image));
    image.src = chrome.runtime.getURL(`_favicon/?pageUrl=${encodeURIComponent(row.faviconPageUrl)}&size=32`);
  }
  return icon;
}

function buildRow(row: SearchRow, onClick: () => void): HTMLElement
{
  const element = document.createElement('div');
  element.className = 'row';
  element.dataset.kind = row.kind;
  element.setAttribute('role', 'option');
  keepFocusOnPress(element);
  element.addEventListener('click', onClick);

  const stripe = document.createElement('span');
  stripe.className = 'stripe';

  const text = document.createElement('span');
  text.className = 'text';
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = row.title;
  const subtitle = document.createElement('div');
  subtitle.className = 'subtitle';
  subtitle.textContent = row.subtitle;
  text.append(title, subtitle);

  const kind = document.createElement('span');
  kind.className = 'kind';
  kind.textContent = KIND_LABELS[row.kind];

  element.append(stripe, buildIcon(row), text, kind);
  return element;
}

interface SearchPopupViewHandlers
{
  onScope(scope: SearchScope): void;
  onToggleSpaces(): void;
  onPick(index: number): void;
}

// The DOM of the page; holds no search state of its own
class SearchPopupView
{
  readonly input = document.querySelector<HTMLInputElement>('.query')!;
  #scopeButtons = new Map<SearchScope, HTMLButtonElement>();
  #spacesToggle = document.querySelector<HTMLButtonElement>('.spaces')!;
  #spacesLabel = document.querySelector<HTMLElement>('.spaces-label')!;
  #list = document.querySelector<HTMLElement>('.list')!;
  #empty = document.querySelector<HTMLElement>('.empty')!;
  #rows: HTMLElement[] = [];
  #handlers: SearchPopupViewHandlers;

  constructor(handlers: SearchPopupViewHandlers)
  {
    this.#handlers = handlers;

    for (const scope of SEARCH_SCOPES)
    {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'scope';
      button.tabIndex = -1;
      button.dataset.scope = scope;
      button.textContent = SCOPE_LABELS[scope];
      keepFocusOnPress(button);
      button.addEventListener('click', () => handlers.onScope(scope));
      this.#scopeButtons.set(scope, button);
    }
    this.#spacesToggle.before(...this.#scopeButtons.values());

    document.querySelector<HTMLElement>('.spaces-hint')!.textContent = spacesHint;
    keepFocusOnPress(this.#spacesToggle);
    this.#spacesToggle.addEventListener('click', () => handlers.onToggleSpaces());
  }

  renderScope(active: SearchScope): void
  {
    for (const [scope, button] of this.#scopeButtons)
    {
      button.classList.toggle('active', scope === active);
    }
  }

  renderSpaces(hasSpaces: boolean, allSpaces: boolean): void
  {
    this.#spacesToggle.hidden = !hasSpaces;
    this.#spacesToggle.classList.toggle('all-spaces', allSpaces);
    this.#spacesLabel.textContent = allSpaces ? 'All Spaces' : 'This Space';
  }

  renderRows(rows: readonly SearchRow[]): void
  {
    this.#rows = rows.map((row, index) => buildRow(row, () => this.#handlers.onPick(index)));
    this.#list.replaceChildren(...this.#rows);
    this.#list.scrollTop = 0;
    this.#empty.hidden = rows.length > 0;
  }

  renderSelection(selected: number): void
  {
    this.#rows.forEach((row, index) =>
    {
      const isSelected = index === selected;
      row.classList.toggle('selected', isSelected);
      row.setAttribute('aria-selected', String(isSelected));
    });
    this.#rows[selected]?.scrollIntoView({ block: 'nearest' });
  }
}

// The page's half of the session: the port to background, the query and the selection
class SearchPopupPage
{
  #port = chrome.runtime.connect({ name: `${SEARCH_POPUP_PORT_PREFIX}${sessionId}` });
  // Replaced on init, which carries the shortcut; until then Esc and the arrows still work
  #keyboard = new SearchKeyboard(undefined);
  #view: SearchPopupView;
  #rows: SearchRow[] = [];
  #selected = 0;
  #scope: SearchScope = 'all';
  #allSpaces = false;
  #hasSpaces = false;
  // A pick or close was sent: background is closing the host, and a second one must not follow
  // (Enter with the modifier held, then its release)
  #finished = false;
  #pingTimer: ReturnType<typeof setInterval>;

  constructor()
  {
    this.#view = new SearchPopupView({
      onScope: (scope) => this.#setScope(scope),
      onToggleSpaces: () => this.#toggleSpaces(),
      onPick: (index) =>
      {
        this.#selected = index;
        this.#pick();
      },
    });
    this.#view.renderScope(this.#scope);
    this.#view.renderSpaces(this.#hasSpaces, this.#allSpaces);

    this.#port.onMessage.addListener((message: SearchBackgroundMessage) => this.#handleMessage(message));
    this.#port.onDisconnect.addListener(() => this.#closeSelf());
    this.#pingTimer = setInterval(() => this.#send({ type: 'ping' }), SEARCH_POPUP_PING_MS);

    const { input } = this.#view;
    input.addEventListener('input', () => this.#query());
    window.addEventListener('keydown', (event) => this.#handleKeydown(event));
    window.addEventListener('keyup', (event) => this.#handleKeyup(event));
    window.addEventListener('focus', () => input.focus());
    // Focus left the popup: another tab, window or app, or a click outside the frame
    window.addEventListener('blur', () => this.#close('blur'));
    input.focus();
  }

  #handleMessage(message: SearchBackgroundMessage): void
  {
    switch (message.type)
    {
      case 'init':
        this.#keyboard = new SearchKeyboard(message.shortcut);
        this.#hasSpaces = message.hasSpaces;
        this.#view.renderSpaces(this.#hasSpaces, this.#allSpaces);
        this.#showRows(message.rows);
        // Shortcut presses background counted while the page loaded
        this.#move(this.#keyboard.shortcutMove(message.steps));
        break;
      case 'results':
        this.#showRows(message.rows);
        break;
      case 'move':
        this.#move(this.#keyboard.shortcutMove(message.steps));
        break;
    }
  }

  #handleKeydown(event: KeyboardEvent): void
  {
    const action = this.#keyboard.keydown(event);
    switch (action.kind)
    {
      case 'move':
        this.#move(action.steps);
        break;
      case 'pick':
        this.#pick();
        break;
      case 'close':
        this.#close('esc');
        break;
      case 'scope':
        this.#setScope(this.#scopeAfter(action.step));
        break;
      case 'toggleSpaces':
        // Without Spaces there is no toggle, and the key types its character
        if (!this.#hasSpaces) return;
        this.#toggleSpaces();
        break;
      case 'none':
        return;
    }
    event.preventDefault();
  }

  #handleKeyup(event: KeyboardEvent): void
  {
    if (this.#keyboard.keyup(event).kind === 'pick') this.#pick();
  }

  #scopeAfter(step: 1 | -1): SearchScope
  {
    const count = SEARCH_SCOPES.length;
    const index = SEARCH_SCOPES.indexOf(this.#scope);
    return SEARCH_SCOPES[(index + step + count) % count];
  }

  #setScope(scope: SearchScope): void
  {
    if (scope === this.#scope) return;
    this.#scope = scope;
    this.#view.renderScope(scope);
    this.#query();
  }

  #toggleSpaces(): void
  {
    this.#allSpaces = !this.#allSpaces;
    this.#view.renderSpaces(this.#hasSpaces, this.#allSpaces);
    this.#query();
  }

  #query(): void
  {
    this.#send({
      type: 'query',
      query: { text: this.#view.input.value, scope: this.#scope, allSpaces: this.#allSpaces },
    });
  }

  #showRows(rows: SearchRow[]): void
  {
    this.#rows = rows;
    this.#selected = 0;
    this.#view.renderRows(rows);
    this.#view.renderSelection(this.#selected);
  }

  // Wraps around the list, as the Tab Switcher does
  #move(steps: number): void
  {
    const count = this.#rows.length;
    if (count === 0 || steps === 0) return;
    this.#selected = (((this.#selected + steps) % count) + count) % count;
    this.#view.renderSelection(this.#selected);
  }

  #pick(): void
  {
    const row = this.#rows[this.#selected];
    if (!row || this.#finished) return;
    this.#finished = true;
    this.#send({ type: 'pick', rowId: row.id });
  }

  #close(reason: 'esc' | 'blur'): void
  {
    if (this.#finished) return;
    this.#finished = true;
    this.#send({ type: 'close', reason });
  }

  #send(message: SearchPageMessage): void
  {
    try
    {
      this.#port.postMessage(message);
    }
    catch
    {
      // The port is gone; onDisconnect closes the page
    }
  }

  // Background dropped the session or its worker stopped: nothing answers this page any more
  #closeSelf(): void
  {
    clearInterval(this.#pingTimer);
    if (inPopupWindow)
    {
      window.close();
      return;
    }
    // The frame script removes the iframe; it checks that the message comes from this frame
    parent.postMessage({ type: SEARCH_FRAME_CLOSE_REQUEST }, '*');
  }
}

new SearchPopupPage();
