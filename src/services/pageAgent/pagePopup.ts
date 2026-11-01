// The popup the page agent shows answers in, built inside the page by an injected function.
//
// Chrome serializes an injected function's source and runs it in the page, so runPagePopupCommand
// must stay self-contained: no imports, no module-level constants or helpers, only its arguments
// and nested functions. Types are fine: they are erased.
//
// The popup keeps no storage: its state is a reference on the extension's isolated-world window,
// so a reload or a cross-document navigation drops it with the page. A page kept in the back/forward
// cache keeps that reference, so pagehide closes the popup too.

import type { MarkdownBlock, MarkdownInline } from '../../utils/markdown.ts';

export interface PagePopupEntry
{
  question: string;
  blocks: MarkdownBlock[];
}

export type PagePopupCommand =
  | { kind: 'open'; title: string; entry: PagePopupEntry }
  | { kind: 'append'; entry: PagePopupEntry };

export interface PagePopupResult
{
  /** False when an append found no open popup; the page is unchanged then. */
  shown: boolean;
}

interface PagePopupState
{
  host: HTMLElement;
  body: HTMLElement;
  /** The document URL without its hash; replace navigations move it along. */
  url: string;
  close(): void;
}

// The Navigation API isn't in TypeScript's DOM types yet.
interface PopupNavigationEvent extends Event
{
  readonly navigationType: 'push' | 'replace' | 'reload' | 'traverse' | null;
}

/**
 * Injected. `open` replaces any popup on the page with a new one holding the entry; `append` adds
 * the entry to the open popup, or returns `{ shown: false }` when the user closed it or the page
 * dropped it.
 */
export function runPagePopupCommand(command: PagePopupCommand): PagePopupResult
{
  const stateKey = '__sidebarPageAgentPopup';
  const hostTag = 'sidebar-page-agent-popup';
  // A constructed stylesheet is CSSOM, which a page's CSP style-src doesn't block, and the closed
  // shadow root keeps the page's selectors out. The host's inline !important styles beat the
  // page's own !important rules, and all: initial stops inherited page styles at the host.
  const styles = `
    .panel {
      --bg: #ffffff; --fg: #1f2328; --muted: #656d76; --border: #d0d7de; --soft: #f3f4f6; --link: #0969da;
      box-sizing: border-box; display: flex; flex-direction: column;
      width: min(420px, calc(100vw - 24px)); max-height: 70vh; overflow: hidden;
      background: var(--bg); color: var(--fg); color-scheme: light dark;
      border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 8px 28px rgba(0, 0, 0, 0.2);
      font: 13px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; text-align: left;
    }
    @media (prefers-color-scheme: dark) {
      .panel { --bg: #202124; --fg: #e8eaed; --muted: #9aa0a6; --border: #3c4043; --soft: #2d2f33; --link: #8ab4f8; }
    }
    .header { display: flex; align-items: center; gap: 8px; padding: 8px 8px 8px 14px; border-bottom: 1px solid var(--border); }
    .title { flex: 1; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .close {
      flex: none; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 6px;
      background: transparent; color: var(--muted); font: inherit; font-size: 14px; line-height: 24px; cursor: pointer;
    }
    .close:hover { background: var(--soft); color: var(--fg); }
    .body { position: relative; flex: 1 1 auto; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 0 14px 12px; }
    .entry { padding-top: 10px; }
    .entry + .entry { margin-top: 12px; border-top: 1px solid var(--border); }
    .question { margin-bottom: 4px; color: var(--muted); font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
    .answer { overflow-wrap: anywhere; }
    .answer > :first-child { margin-top: 0; }
    .answer > :last-child { margin-bottom: 0; }
    p, ul, ol, pre, blockquote { margin: 0.5em 0; }
    h1, h2, h3, h4, h5, h6 { margin: 0.8em 0 0.4em; font-weight: 600; line-height: 1.3; }
    h1 { font-size: 1.35em; } h2 { font-size: 1.2em; } h3 { font-size: 1.1em; } h4, h5, h6 { font-size: 1em; }
    ul, ol { padding-left: 1.4em; }
    ul { list-style: disc; } ol { list-style: decimal; }
    li > p { margin: 0; }
    li > * + * { margin-top: 0.3em; }
    li + li { margin-top: 0.15em; }
    blockquote { margin-left: 0; margin-right: 0; padding-left: 10px; border-left: 3px solid var(--border); color: var(--muted); }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.92em; background: var(--soft); border-radius: 4px; padding: 0.1em 0.3em; }
    pre { overflow-x: auto; padding: 8px 10px; background: var(--soft); border-radius: 6px; }
    pre code { padding: 0; background: none; white-space: pre; }
    a { color: var(--link); text-decoration: underline; }
    strong { font-weight: 600; }
    hr { margin: 0.8em 0; border: 0; border-top: 1px solid var(--border); }
  `;
  const holder = window as unknown as Record<string, PagePopupState | undefined>;
  const navigation = (window as unknown as { navigation?: EventTarget }).navigation;

  function withoutHash(url: string): string
  {
    const index = url.indexOf('#');
    return index === -1 ? url : url.slice(0, index);
  }

  // Checked again here: the popup must never hold a javascript: or data: link, whatever it is sent.
  function safeHref(href: string): string | null
  {
    try
    {
      const url = new URL(href);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
    }
    catch
    {
      return null;
    }
  }

  function element<Tag extends keyof HTMLElementTagNameMap>(
    tag: Tag,
    className?: string,
    text?: string,
  ): HTMLElementTagNameMap[Tag]
  {
    const node = document.createElement(tag);
    if (className !== undefined)
    {
      node.className = className;
    }
    if (text !== undefined)
    {
      node.textContent = text;
    }
    return node;
  }

  function appendInlines(parent: Node, inlines: MarkdownInline[]): void
  {
    for (const inline of inlines)
    {
      switch (inline.type)
      {
        case 'text':
          parent.appendChild(document.createTextNode(inline.text));
          break;
        case 'strong':
        case 'em':
        {
          const node = element(inline.type);
          appendInlines(node, inline.children);
          parent.appendChild(node);
          break;
        }
        case 'code':
          parent.appendChild(element('code', undefined, inline.text));
          break;
        case 'link':
        {
          const href = safeHref(inline.href);
          if (href === null)
          {
            appendInlines(parent, inline.children);
            break;
          }
          const link = element('a');
          link.href = href;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          appendInlines(link, inline.children);
          parent.appendChild(link);
          break;
        }
        case 'break':
          parent.appendChild(element('br'));
          break;
      }
    }
  }

  function appendBlocks(parent: Node, blocks: MarkdownBlock[]): void
  {
    for (const block of blocks)
    {
      switch (block.type)
      {
        case 'heading':
        {
          const level = Math.min(6, Math.max(1, Math.round(block.level)));
          const heading = document.createElement(`h${level}`);
          appendInlines(heading, block.children);
          parent.appendChild(heading);
          break;
        }
        case 'paragraph':
        {
          const paragraph = element('p');
          appendInlines(paragraph, block.children);
          parent.appendChild(paragraph);
          break;
        }
        case 'codeBlock':
        {
          const pre = element('pre');
          pre.appendChild(element('code', undefined, block.text));
          parent.appendChild(pre);
          break;
        }
        case 'list':
        {
          let list: HTMLElement;
          if (block.ordered)
          {
            const ordered = element('ol');
            ordered.start = block.start;
            list = ordered;
          }
          else
          {
            list = element('ul');
          }
          for (const item of block.items)
          {
            const listItem = element('li');
            appendBlocks(listItem, item);
            list.appendChild(listItem);
          }
          parent.appendChild(list);
          break;
        }
        case 'blockquote':
        {
          const quote = element('blockquote');
          appendBlocks(quote, block.children);
          parent.appendChild(quote);
          break;
        }
        case 'rule':
          parent.appendChild(element('hr'));
          break;
      }
    }
  }

  function entryElement(entry: PagePopupEntry): HTMLElement
  {
    const section = element('section', 'entry');
    section.appendChild(element('div', 'question', entry.question));
    const answer = element('div', 'answer');
    appendBlocks(answer, entry.blocks);
    section.appendChild(answer);
    return section;
  }

  function open(title: string, entry: PagePopupEntry): void
  {
    holder[stateKey]?.close();
    // A host left by an earlier isolated world (the extension was reloaded) has no state here.
    for (const stray of Array.from(document.querySelectorAll(hostTag)))
    {
      stray.remove();
    }

    const host = document.createElement(hostTag);
    const hostStyles: Array<[string, string]> = [
      ['all', 'initial'],
      ['position', 'fixed'],
      ['top', '12px'],
      ['right', '12px'],
      ['z-index', '2147483647'],
    ];
    for (const [name, value] of hostStyles)
    {
      host.style.setProperty(name, value, 'important');
    }
    const shadow = host.attachShadow({ mode: 'closed' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(styles);
    shadow.adoptedStyleSheets = [sheet];

    const panel = element('div', 'panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', title);
    const header = element('div', 'header');
    header.appendChild(element('div', 'title', title));
    const closeButton = element('button', 'close', '✕');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Close');
    closeButton.title = 'Close';
    header.appendChild(closeButton);
    const body = element('div', 'body');
    body.appendChild(entryElement(entry));
    panel.append(header, body);
    shadow.appendChild(panel);

    const onEntryChange = (event: Event): void =>
    {
      const url = withoutHash(location.href);
      if (url === state.url)
      {
        return;
      }
      const type = (event as PopupNavigationEvent).navigationType;
      // Search and infinite-scroll pages rewrite ?q= / ?page= with replace while the user reads.
      if (type === 'push' || type === 'traverse' || type === 'reload')
      {
        state.close();
        return;
      }
      state.url = url;
    };
    // A document left for the back/forward cache keeps its DOM and this world's state, and Back brings
    // it back at the same URL, so the URL check above would keep the popup: pagehide marks the leaving.
    const onPageHide = (): void => state.close();
    const state: PagePopupState = {
      host,
      body,
      url: withoutHash(location.href),
      close: () =>
      {
        navigation?.removeEventListener('currententrychange', onEntryChange);
        window.removeEventListener('pagehide', onPageHide);
        host.remove();
        if (holder[stateKey] === state)
        {
          holder[stateKey] = undefined;
        }
      },
    };
    closeButton.addEventListener('click', () => state.close());
    navigation?.addEventListener('currententrychange', onEntryChange);
    window.addEventListener('pagehide', onPageHide);
    holder[stateKey] = state;
    document.documentElement.appendChild(host);
  }

  function append(entry: PagePopupEntry): boolean
  {
    const state = holder[stateKey];
    if (!state || !state.host.isConnected)
    {
      // The page removed the host: drop the navigation listener with it.
      state?.close();
      return false;
    }
    const section = entryElement(entry);
    state.body.appendChild(section);
    state.body.scrollTo({ top: section.offsetTop, behavior: 'smooth' });
    return true;
  }

  if (command.kind === 'open')
  {
    open(command.title, command.entry);
    return { shown: true };
  }
  return { shown: append(command.entry) };
}
