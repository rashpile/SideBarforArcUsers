// Functions the page agent injects with chrome.scripting.executeScript, and the code that turns
// their results into the text the model gets.
//
// Chrome serializes an injected function's source and runs it in the page, so collectPageOutline,
// inspectPageElements and readPageMarker must stay self-contained: no imports, no module-level
// constants or helpers, only their arguments and nested functions. Types are fine: they are erased.

export interface OutlineLimits
{
  /** Most outline nodes. */
  maxNodes: number;
  /** Most nesting levels of outline nodes. */
  maxDepth: number;
  /** Most elements walked, so the script stays quick on huge pages. */
  maxElements: number;
  /** Share of the viewport area an element has to cover to count as large. */
  minAreaRatio: number;
  /** Characters of an element's own text kept per node. */
  textLength: number;
}

export interface RawOutlineNode
{
  /** Index of the parent node in `nodes`, -1 for a top-level node. A parent comes before its children. */
  parent: number;
  tag: string;
  id?: string;
  classes?: string[];
  role?: string;
  selector: string;
  /** [x, y, width, height], rounded, relative to the viewport. */
  rect: number[];
  text?: string;
}

export interface RawPageOutline
{
  url: string;
  title: string;
  viewport: { width: number; height: number };
  scroll: { x: number; y: number };
  documentSize: { width: number; height: number };
  /** Breadth-first: the first nodes are the top of the page structure. */
  nodes: RawOutlineNode[];
  /** The walk stopped at the node, depth or element limit. */
  limited: boolean;
}

export interface RawInspectMatch
{
  tag: string;
  id?: string;
  classes?: string[];
  rect: { x: number; y: number; width: number; height: number; right: number; bottom: number };
  computed: Record<string, string>;
}

export interface RawInspectEntry
{
  selector: string;
  error?: string;
  count?: number;
  matches?: RawInspectMatch[];
}

export interface RawInspectResult
{
  viewport: { width: number; height: number };
  horizontalOverflow: boolean;
  scrollWidth: number;
  results: RawInspectEntry[];
}

interface QueuedElement
{
  element: Element;
  /** Index of the nearest outline ancestor, -1 for none. */
  parent: number;
  /** Depth of that ancestor, 0 for none. */
  depth: number;
  parentRect: DOMRect | null;
}

interface OutlineTreeNode
{
  tag: string;
  id?: string;
  classes?: string[];
  role?: string;
  selector: string;
  rect: number[];
  text?: string;
  children?: OutlineTreeNode[];
}

/**
 * Injected. The visible landmarks and large elements of the page, breadth-first, so a cut keeps
 * the top of the structure. Elements in between are skipped and their outline descendants hang
 * on the nearest outline ancestor.
 */
export function collectPageOutline(limits: OutlineLimits): RawPageOutline
{
  const notRendered = ['script', 'style', 'noscript', 'template', 'link', 'meta'];
  // Iframes and videos are boxes for the model; SVG and form controls have no page layout inside.
  const leaves = ['iframe', 'video', 'audio', 'canvas', 'svg', 'img', 'picture', 'object', 'embed', 'select'];
  const landmarks = ['header', 'nav', 'aside', 'main', 'footer', 'iframe', 'video'];
  const visibleOptions = { checkVisibilityCSS: true, visibilityProperty: true, checkOpacity: true, opacityProperty: true };

  const root = document.documentElement;
  // clientWidth leaves out the scrollbar: it is the width content can fill.
  const viewport = { width: root.clientWidth, height: root.clientHeight };
  const minArea = viewport.width * viewport.height * limits.minAreaRatio;
  const nodes: RawOutlineNode[] = [];
  let limited = false;

  function isUnique(selector: string): boolean
  {
    try
    {
      return document.querySelectorAll(selector).length === 1;
    }
    catch
    {
      return false;
    }
  }

  function segment(element: Element): string
  {
    const classes = Array.from(element.classList).filter(name => name.length <= 40).slice(0, 2);
    return element.localName + classes.map(name => `.${CSS.escape(name)}`).join('');
  }

  function idSelector(element: Element): string
  {
    return element.id && element.id.length <= 64 ? `#${CSS.escape(element.id)}` : '';
  }

  function suggestSelector(element: Element): string
  {
    const byId = idSelector(element);
    if (byId && isUnique(byId))
    {
      return byId;
    }
    let selector = segment(element);
    let ancestor = element.parentElement;
    for (let level = 0; level < 3 && ancestor && ancestor !== document.body && ancestor !== root; level++)
    {
      if (isUnique(selector))
      {
        return selector;
      }
      const ancestorId = idSelector(ancestor);
      if (ancestorId && isUnique(ancestorId))
      {
        return `${ancestorId} > ${selector}`;
      }
      selector = `${segment(ancestor)} > ${selector}`;
      ancestor = ancestor.parentElement;
    }
    return selector;
  }

  function ownText(element: Element): string
  {
    let text = '';
    for (const child of Array.from(element.childNodes))
    {
      if (child.nodeType === Node.TEXT_NODE)
      {
        text += child.textContent ?? '';
      }
    }
    return text.replace(/\s+/g, ' ').trim().slice(0, limits.textLength);
  }

  // Shadow roots are not walked: a stylesheet from insertCSS doesn't reach into them anyway.
  const queue: QueuedElement[] = Array.from(document.body?.children ?? [])
    .map(element => ({ element, parent: -1, depth: 0, parentRect: null }));
  for (let index = 0; index < queue.length; index++)
  {
    if (index >= limits.maxElements)
    {
      limited = true;
      break;
    }
    const { element, parent, depth, parentRect } = queue[index];
    const tag = element.localName;
    if (notRendered.includes(tag))
    {
      continue;
    }
    // False for display: none and content-visibility: hidden, whose subtrees aren't rendered, and
    // for display: contents, whose children are.
    if (!element.checkVisibility() && getComputedStyle(element).display !== 'contents')
    {
      continue;
    }

    let nodeIndex = parent;
    let nodeDepth = depth;
    let nodeRect = parentRect;
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && element.checkVisibility(visibleOptions))
    {
      const role = element.getAttribute('role')?.trim() ?? '';
      const hasRole = role !== '' && role !== 'presentation' && role !== 'none';
      // A wrapper with the same box as its outline parent adds depth and nothing else.
      const sameBox = parentRect !== null &&
        Math.abs(rect.x - parentRect.x) < 1 && Math.abs(rect.y - parentRect.y) < 1 &&
        Math.abs(rect.width - parentRect.width) < 1 && Math.abs(rect.height - parentRect.height) < 1;
      const large = rect.width * rect.height >= minArea && !sameBox;
      if (landmarks.includes(tag) || hasRole || large)
      {
        if (nodes.length >= limits.maxNodes)
        {
          limited = true;
          break;
        }
        const classes = Array.from(element.classList).filter(name => name.length <= 60).slice(0, 3);
        const text = ownText(element);
        nodes.push({
          parent,
          tag,
          ...(element.id !== '' && { id: element.id.slice(0, 80) }),
          ...(classes.length > 0 && { classes }),
          ...(hasRole && { role }),
          selector: suggestSelector(element),
          rect: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)],
          ...(text !== '' && { text }),
        });
        nodeIndex = nodes.length - 1;
        nodeDepth = depth + 1;
        nodeRect = rect;
      }
    }

    if (leaves.includes(tag))
    {
      continue;
    }
    if (nodeDepth >= limits.maxDepth)
    {
      limited = limited || element.childElementCount > 0;
      continue;
    }
    for (const child of Array.from(element.children))
    {
      queue.push({ element: child, parent: nodeIndex, depth: nodeDepth, parentRect: nodeRect });
    }
  }

  return {
    url: location.href,
    title: document.title,
    viewport,
    scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
    documentSize: { width: root.scrollWidth, height: root.scrollHeight },
    nodes,
    limited,
  };
}

/**
 * Injected. Per selector the match count and, for the first `maxMatches` matches, the box and the
 * computed styles the conditions are usually about. An invalid selector gets an error instead.
 */
export function inspectPageElements(selectors: string[], maxMatches: number): RawInspectResult
{
  const properties = [
    'display', 'visibility', 'position', 'width', 'max-width', 'height',
    'font-size', 'color', 'background-color', 'overflow',
  ];
  // One decimal: tolerances like ±2px and aspect ratios ±1% need more than whole pixels.
  const round = (value: number): number => Math.round(value * 10) / 10;
  const root = document.documentElement;

  const results = selectors.map((selector): RawInspectEntry =>
  {
    let elements: Element[];
    try
    {
      elements = Array.from(document.querySelectorAll(selector));
    }
    catch
    {
      return { selector, error: 'invalid selector' };
    }

    const matches = elements.slice(0, maxMatches).map((element): RawInspectMatch =>
    {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const computed: Record<string, string> = {};
      for (const property of properties)
      {
        computed[property] = style.getPropertyValue(property);
      }
      const classes = Array.from(element.classList).filter(name => name.length <= 60).slice(0, 3);
      return {
        tag: element.localName,
        ...(element.id !== '' && { id: element.id.slice(0, 80) }),
        ...(classes.length > 0 && { classes }),
        rect: {
          x: round(rect.x),
          y: round(rect.y),
          width: round(rect.width),
          height: round(rect.height),
          right: round(rect.right),
          bottom: round(rect.bottom),
        },
        computed,
      };
    });
    return { selector, count: elements.length, matches };
  });

  return {
    viewport: { width: root.clientWidth, height: root.clientHeight },
    horizontalOverflow: root.scrollWidth > root.clientWidth,
    scrollWidth: root.scrollWidth,
    results,
  };
}

/**
 * Injected. The applied id the agent's stylesheet sets on :root, or '' when the page has none of
 * its CSS (a reload or navigation dropped it).
 */
export function readPageMarker(property: string): string
{
  const value = getComputedStyle(document.documentElement).getPropertyValue(property).trim();
  return value.replace(/^["']|["']$/g, '');
}

const RECT_FORMAT = '[x, y, width, height] in CSS px, relative to the viewport';
const LIMITED_NOTE = 'the page has more elements than the outline shows; use inspect for the rest';

/**
 * The outline as JSON text for the model. When it is longer than `maxChars`, only the first nodes
 * in breadth-first order are kept, so the cut drops the deepest details first.
 */
export function formatPageOutline(raw: RawPageOutline, maxChars: number): string
{
  const serialize = (count: number): string =>
  {
    const notes: string[] = [];
    if (raw.limited)
    {
      notes.push(LIMITED_NOTE);
    }
    if (count < raw.nodes.length)
    {
      notes.push(`cut to ${count} of ${raw.nodes.length} elements to stay under ${maxChars} characters`);
    }
    return JSON.stringify({
      url: raw.url.slice(0, 500),
      title: raw.title.slice(0, 200),
      viewport: raw.viewport,
      scroll: raw.scroll,
      documentSize: raw.documentSize,
      rectFormat: RECT_FORMAT,
      ...(notes.length > 0 && { note: notes.join('; ') }),
      outline: outlineTree(raw.nodes, count),
    });
  };

  const full = serialize(raw.nodes.length);
  if (full.length <= maxChars)
  {
    return full;
  }
  let fits = 0;
  let tooLong = raw.nodes.length;
  while (tooLong - fits > 1)
  {
    const middle = Math.floor((fits + tooLong) / 2);
    if (serialize(middle).length <= maxChars)
    {
      fits = middle;
    }
    else
    {
      tooLong = middle;
    }
  }
  return serialize(fits);
}

export function formatInspectResult(raw: RawInspectResult, maxChars: number): string
{
  const text = JSON.stringify(raw);
  if (text.length <= maxChars)
  {
    return text;
  }
  return `${text.slice(0, maxChars)}\n[cut at ${maxChars} characters; inspect fewer selectors at a time]`;
}

// Breadth-first order puts every parent before its children, so the first `count` nodes form a
// tree without gaps.
function outlineTree(nodes: readonly RawOutlineNode[], count: number): OutlineTreeNode[]
{
  const built: OutlineTreeNode[] = [];
  const roots: OutlineTreeNode[] = [];
  for (let index = 0; index < count; index++)
  {
    const { parent, ...fields } = nodes[index];
    const node: OutlineTreeNode = { ...fields };
    built.push(node);
    const parentNode = parent >= 0 ? built[parent] : undefined;
    if (!parentNode)
    {
      roots.push(node);
    }
    else if (parentNode.children)
    {
      parentNode.children.push(node);
    }
    else
    {
      parentNode.children = [node];
    }
  }
  return roots;
}
