// A small markdown parser for page agent answers. It produces plain-JSON nodes that both the side
// panel (React) and the popup injected into the page (createElement / textContent) render, so
// nothing in an answer is ever parsed as HTML: raw HTML has no node type and stays text, links keep
// only http(s) targets, and images stay text so an answer can't make either renderer load a URL.

export type MarkdownInline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: MarkdownInline[] }
  | { type: 'em'; children: MarkdownInline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: MarkdownInline[] }
  | { type: 'break' };

export type MarkdownHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type MarkdownBlock =
  | { type: 'heading'; level: MarkdownHeadingLevel; children: MarkdownInline[] }
  | { type: 'paragraph'; children: MarkdownInline[] }
  | { type: 'codeBlock'; language: string; text: string }
  | { type: 'list'; ordered: boolean; start: number; items: MarkdownBlock[][] }
  | { type: 'blockquote'; children: MarkdownBlock[] }
  | { type: 'rule' };

// Lists and blockquotes nest at most this deep, and so do strong / em / link nodes inside a block.
// Deeper markers stay text, so an answer saved in the chat can't make a renderer recurse without
// bound.
const MAX_NESTING = 8;

const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;
const HEADING_CLOSING_SEQUENCE = /(?:^|[ \t]+)#+[ \t]*$/;
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const BLOCKQUOTE = /^ {0,3}> ?(.*)$/;
const LIST_ITEM = /^([ \t]*)([-*+]|(\d{1,9})([.)]))(?:([ \t]+)(.*))?$/;
const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

const ASCII_PUNCTUATION = /^[!-/:-@[-`{-~]$/;
const ESCAPED_PUNCTUATION = /\\([!-/:-@[-`{-~])/g;
const UNICODE_PUNCTUATION = /^[\p{P}\p{S}]$/u;
const WHITESPACE = /^\s$/u;
const PLAIN_TEXT = /[^\\\n`*_[\]!]+/y;

const TAB_STOP = 4;

export function parseMarkdown(text: string): MarkdownBlock[]
{
  return new BlockParser(text.replace(/\r\n?/g, '\n').split('\n'), 0).parse();
}

export function safeLinkHref(url: string): string | null
{
  try
  {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  }
  catch
  {
    return null;
  }
}

function isBlank(line: string): boolean
{
  return line.trim() === '';
}

function advanceColumn(column: number, character: string): number
{
  return character === '\t' ? column + TAB_STOP - (column % TAB_STOP) : column + 1;
}

function indentOf(line: string): number
{
  let column = 0;
  for (const character of line)
  {
    if (character !== ' ' && character !== '\t')
    {
      break;
    }
    column = advanceColumn(column, character);
  }
  return column;
}

// Removes up to `columns` columns of leading whitespace. Tabs are only expanded here, where an
// indent is cut, so code inside a fence keeps its tabs.
function stripIndent(line: string, columns: number): string
{
  let column = 0;
  let index = 0;
  while (index < line.length && column < columns && (line[index] === ' ' || line[index] === '\t'))
  {
    const next = advanceColumn(column, line[index]);
    if (next > columns)
    {
      return ' '.repeat(next - columns) + line.slice(index + 1);
    }
    column = next;
    index++;
  }
  return line.slice(index);
}

function startsBlock(line: string): boolean
{
  return HEADING.test(line) || THEMATIC_BREAK.test(line) || Fence.open(line) !== null
    || BLOCKQUOTE.test(line) || ListMarker.parse(line) !== null;
}

class Fence
{
  readonly marker: string;
  readonly length: number;
  readonly indent: number;
  readonly language: string;

  constructor(marker: string, length: number, indent: number, language: string)
  {
    this.marker = marker;
    this.length = length;
    this.indent = indent;
    this.language = language;
  }

  static open(line: string): Fence | null
  {
    const match = FENCE_OPEN.exec(line);
    if (!match)
    {
      return null;
    }
    const info = match[3].trim();
    if (match[2][0] === '`' && info.includes('`'))
    {
      return null;
    }
    return new Fence(match[2][0], match[2].length, match[1].length, info.split(/\s+/)[0]);
  }

  closes(line: string): boolean
  {
    const match = FENCE_CLOSE.exec(line);
    return match !== null && match[1][0] === this.marker && match[1].length >= this.length;
  }

  contentOf(line: string): string
  {
    return stripIndent(line, this.indent);
  }
}

class ListMarker
{
  readonly indent: number;
  readonly contentIndent: number;
  readonly content: string;
  readonly ordered: boolean;
  readonly start: number;
  // '-', '*' or '+' for bullets, '.' or ')' for ordered items: another one starts a new list
  readonly delimiter: string;

  constructor(indent: number, contentIndent: number, content: string, ordered: boolean, start: number, delimiter: string)
  {
    this.indent = indent;
    this.contentIndent = contentIndent;
    this.content = content;
    this.ordered = ordered;
    this.start = start;
    this.delimiter = delimiter;
  }

  static parse(line: string): ListMarker | null
  {
    const match = LIST_ITEM.exec(line);
    if (!match)
    {
      return null;
    }
    const indent = indentOf(match[1]);
    const markerEnd = indent + match[2].length;
    const rest = match[6] ?? '';
    let gap = markerEnd;
    for (const character of match[5] ?? '')
    {
      gap = advanceColumn(gap, character);
    }
    gap -= markerEnd;
    const ordered = match[3] !== undefined;
    const start = ordered ? Number.parseInt(match[3], 10) : 1;
    const delimiter = ordered ? match[4] : match[2];
    // As in CommonMark, content more than 4 columns after the marker keeps the extra columns, and
    // an empty first line puts the content one column after the marker.
    if (rest === '' || gap > TAB_STOP)
    {
      const content = rest === '' ? '' : ' '.repeat(gap - 1) + rest;
      return new ListMarker(indent, markerEnd + 1, content, ordered, start, delimiter);
    }
    return new ListMarker(indent, markerEnd + gap, rest, ordered, start, delimiter);
  }

  sameListAs(other: ListMarker): boolean
  {
    return this.ordered === other.ordered && this.delimiter === other.delimiter;
  }

  // Lines indented at least two columns past the marker nest under the item even when they fall
  // short of its content column, as in "1. Step" followed by "  - detail".
  nests(line: string): boolean
  {
    return indentOf(line) >= this.indent + 2 && ListMarker.parse(line) !== null;
  }
}

// Whether an unmarked line may continue a paragraph inside a list item or blockquote ("lazy
// continuation"): only right after paragraph text, never inside a code fence.
class LazyContinuation
{
  #fence: Fence | null = null;
  #afterParagraphText = false;

  add(content: string): void
  {
    if (this.#fence)
    {
      if (this.#fence.closes(content))
      {
        this.#fence = null;
      }
      this.#afterParagraphText = false;
      return;
    }
    this.#fence = Fence.open(content);
    this.#afterParagraphText = this.#fence === null && !isBlank(content) && !HEADING.test(content)
      && !THEMATIC_BREAK.test(content);
  }

  allows(line: string): boolean
  {
    return this.#afterParagraphText && !isBlank(line) && !startsBlock(line);
  }
}

class BlockParser
{
  readonly #lines: string[];
  readonly #depth: number;
  #index = 0;

  constructor(lines: string[], depth: number)
  {
    this.#lines = lines;
    this.#depth = depth;
  }

  parse(): MarkdownBlock[]
  {
    const blocks: MarkdownBlock[] = [];
    while (this.#index < this.#lines.length)
    {
      if (isBlank(this.#lines[this.#index]))
      {
        this.#index++;
        continue;
      }
      blocks.push(this.#block(this.#lines[this.#index]));
    }
    return blocks;
  }

  #canNest(): boolean
  {
    return this.#depth < MAX_NESTING;
  }

  #block(line: string): MarkdownBlock
  {
    const fence = Fence.open(line);
    if (fence)
    {
      return this.#codeBlock(fence);
    }
    const heading = HEADING.exec(line);
    if (heading)
    {
      this.#index++;
      const content = (heading[2] ?? '').replace(HEADING_CLOSING_SEQUENCE, '').trim();
      return { type: 'heading', level: heading[1].length as MarkdownHeadingLevel, children: parseInline(content) };
    }
    if (THEMATIC_BREAK.test(line))
    {
      this.#index++;
      return { type: 'rule' };
    }
    if (this.#canNest() && BLOCKQUOTE.test(line))
    {
      return this.#blockquote();
    }
    const marker = this.#canNest() ? ListMarker.parse(line) : null;
    if (marker)
    {
      return this.#list(marker);
    }
    return this.#paragraph();
  }

  #codeBlock(fence: Fence): MarkdownBlock
  {
    const content: string[] = [];
    this.#index++;
    while (this.#index < this.#lines.length)
    {
      const line = this.#lines[this.#index++];
      if (fence.closes(line))
      {
        break;
      }
      content.push(fence.contentOf(line));
    }
    return { type: 'codeBlock', language: fence.language, text: content.join('\n') };
  }

  #blockquote(): MarkdownBlock
  {
    const content: string[] = [];
    const lazy = new LazyContinuation();
    while (this.#index < this.#lines.length)
    {
      const line = this.#lines[this.#index];
      const quoted = BLOCKQUOTE.exec(line);
      const inner = quoted ? quoted[1] : line;
      if (!quoted && !lazy.allows(line))
      {
        break;
      }
      content.push(inner);
      lazy.add(inner);
      this.#index++;
    }
    return { type: 'blockquote', children: new BlockParser(content, this.#depth + 1).parse() };
  }

  #list(first: ListMarker): MarkdownBlock
  {
    const items: MarkdownBlock[][] = [];
    let marker: ListMarker | null = first;
    while (marker && marker.sameListAs(first))
    {
      items.push(this.#listItem(marker));
      marker = this.#index < this.#lines.length ? ListMarker.parse(this.#lines[this.#index]) : null;
    }
    return { type: 'list', ordered: first.ordered, start: first.start, items };
  }

  // Leaves the index on the first line after the item. Blank lines before it are consumed: they
  // only separate items or end the list.
  #listItem(marker: ListMarker): MarkdownBlock[]
  {
    const content = [marker.content];
    const lazy = new LazyContinuation();
    lazy.add(marker.content);
    let blankLines = 0;
    this.#index++;
    while (this.#index < this.#lines.length)
    {
      const line = this.#lines[this.#index];
      if (isBlank(line))
      {
        blankLines++;
        this.#index++;
        continue;
      }
      let inner: string;
      if (indentOf(line) >= marker.contentIndent || marker.nests(line))
      {
        inner = stripIndent(line, marker.contentIndent);
      }
      else if (blankLines === 0 && lazy.allows(line))
      {
        inner = line;
      }
      else
      {
        break;
      }
      for (; blankLines > 0; blankLines--)
      {
        content.push('');
        lazy.add('');
      }
      content.push(inner);
      lazy.add(inner);
      this.#index++;
    }
    return new BlockParser(content, this.#depth + 1).parse();
  }

  #paragraph(): MarkdownBlock
  {
    const lines = [this.#lines[this.#index++].trim()];
    while (this.#index < this.#lines.length)
    {
      const line = this.#lines[this.#index];
      if (isBlank(line) || this.#interruptsParagraph(line))
      {
        break;
      }
      lines.push(line.trim());
      this.#index++;
    }
    return { type: 'paragraph', children: parseInline(lines.join('\n')) };
  }

  // As in CommonMark, an ordered list interrupts a paragraph only when it starts at 1, and an empty
  // item never does, so "In 2024. we..." or a stray "-" stays text.
  #interruptsParagraph(line: string): boolean
  {
    if (HEADING.test(line) || THEMATIC_BREAK.test(line) || Fence.open(line))
    {
      return true;
    }
    if (!this.#canNest())
    {
      return false;
    }
    if (BLOCKQUOTE.test(line))
    {
      return true;
    }
    const marker = ListMarker.parse(line);
    return marker !== null && !isBlank(marker.content) && (!marker.ordered || marker.start === 1);
  }
}

function parseInline(text: string): MarkdownInline[]
{
  return new InlineParser(text).parse();
}

// One entry of the flat inline list the parser builds before it pairs emphasis delimiters. The
// height (nesting of strong / em / link below it) keeps every node within MAX_NESTING.
class InlineSlot
{
  node: MarkdownInline;
  readonly height: number;

  constructor(node: MarkdownInline, height: number)
  {
    this.node = node;
    this.height = height;
  }

  static text(text: string): InlineSlot
  {
    return new InlineSlot({ type: 'text', text }, 0);
  }
}

function maxHeight(slots: InlineSlot[]): number
{
  return slots.reduce((height, slot) => Math.max(height, slot.height), 0);
}

function toInlineNodes(slots: InlineSlot[]): MarkdownInline[]
{
  const nodes: MarkdownInline[] = [];
  for (const { node } of slots)
  {
    const last = nodes[nodes.length - 1];
    if (node.type === 'text')
    {
      if (node.text === '')
      {
        continue;
      }
      if (last !== undefined && last.type === 'text')
      {
        nodes[nodes.length - 1] = { type: 'text', text: last.text + node.text };
        continue;
      }
    }
    nodes.push(node);
  }
  return nodes;
}

// A run of `*` or `_` that may open or close emphasis, following CommonMark's flanking rules.
class Delimiter
{
  readonly slot: InlineSlot;
  readonly character: string;
  readonly runLength: number;
  readonly canOpen: boolean;
  readonly canClose: boolean;
  #remaining: number;

  constructor(slot: InlineSlot, character: string, runLength: number, canOpen: boolean, canClose: boolean)
  {
    this.slot = slot;
    this.character = character;
    this.runLength = runLength;
    this.canOpen = canOpen;
    this.canClose = canClose;
    this.#remaining = runLength;
  }

  get remaining(): number
  {
    return this.#remaining;
  }

  use(count: number): void
  {
    this.#remaining -= count;
    this.slot.node = { type: 'text', text: this.character.repeat(this.#remaining) };
  }

  // CommonMark's rule of 3: when either run can both open and close, the run lengths must not add
  // up to a multiple of 3 unless both are multiples of 3 (so "*a**b*" is one em, not a strong).
  opens(closer: Delimiter): boolean
  {
    if (this.character !== closer.character || !this.canOpen || this.#remaining === 0)
    {
      return false;
    }
    const total = this.runLength + closer.runLength;
    const bothMultiples = this.runLength % 3 === 0 && closer.runLength % 3 === 0;
    return !((this.canClose || closer.canOpen) && total % 3 === 0 && !bothMultiples);
  }
}

class Bracket
{
  readonly slot: InlineSlot;
  readonly image: boolean;
  readonly sourceStart: number;
  // Delimiters at or above this index were pushed after the bracket opened
  readonly delimiterBottom: number;
  active = true;

  constructor(slot: InlineSlot, image: boolean, sourceStart: number, delimiterBottom: number)
  {
    this.slot = slot;
    this.image = image;
    this.sourceStart = sourceStart;
    this.delimiterBottom = delimiterBottom;
  }
}

// Index of the first unescaped `close` at or after `from`, or -1 when a character of `stop` or the
// end of the text comes first.
function findUnescaped(text: string, from: number, close: string, stop: string): number
{
  for (let index = from; index < text.length; index++)
  {
    const character = text[index];
    if (character === '\\')
    {
      index++;
      continue;
    }
    if (character === close)
    {
      return index;
    }
    if (stop.includes(character))
    {
      return -1;
    }
  }
  return -1;
}

function skipLinkSpace(text: string, from: number): number
{
  let index = from;
  while (index < text.length && (text[index] === ' ' || text[index] === '\t' || text[index] === '\n'))
  {
    index++;
  }
  return index;
}

// The `(destination "title")` part of an inline link; the title is parsed only to find the end.
class LinkTarget
{
  readonly destination: string;
  // Index just after the closing parenthesis
  readonly end: number;

  constructor(destination: string, end: number)
  {
    this.destination = destination;
    this.end = end;
  }

  static parse(text: string, start: number): LinkTarget | null
  {
    if (text[start] !== '(')
    {
      return null;
    }
    let index = skipLinkSpace(text, start + 1);
    let destination: string;
    if (text[index] === '<')
    {
      const close = findUnescaped(text, index + 1, '>', '<\n');
      if (close === -1)
      {
        return null;
      }
      destination = text.slice(index + 1, close);
      index = close + 1;
    }
    else
    {
      const begin = index;
      let depth = 0;
      while (index < text.length)
      {
        const character = text[index];
        if (character === '\\' && ASCII_PUNCTUATION.test(text[index + 1] ?? ''))
        {
          index += 2;
          continue;
        }
        if (character === ')' && depth === 0)
        {
          break;
        }
        // Spaces and control characters end a destination that isn't in <>
        if (character <= ' ')
        {
          break;
        }
        if (character === '(')
        {
          depth++;
        }
        else if (character === ')')
        {
          depth--;
        }
        index++;
      }
      if (depth !== 0)
      {
        return null;
      }
      destination = text.slice(begin, index);
    }
    const afterDestination = index;
    index = skipLinkSpace(text, index);
    const titleOpen = text[index];
    if (index > afterDestination && (titleOpen === '"' || titleOpen === '\'' || titleOpen === '('))
    {
      const close = titleOpen === '(' ? findUnescaped(text, index + 1, ')', '(') : findUnescaped(text, index + 1, titleOpen, '');
      if (close === -1)
      {
        return null;
      }
      index = skipLinkSpace(text, close + 1);
    }
    if (text[index] !== ')')
    {
      return null;
    }
    return new LinkTarget(destination.replace(ESCAPED_PUNCTUATION, '$1'), index + 1);
  }
}

function characterBefore(text: string, index: number): string
{
  if (index === 0)
  {
    return '';
  }
  const code = text.charCodeAt(index - 1);
  const lowSurrogate = code >= 0xdc00 && code <= 0xdfff;
  return lowSurrogate && index >= 2 ? text.slice(index - 2, index) : text[index - 1];
}

function characterAt(text: string, index: number): string
{
  const code = text.codePointAt(index);
  return code === undefined ? '' : String.fromCodePoint(code);
}

// The start and end of the text count as whitespace for flanking.
function isWhitespace(character: string): boolean
{
  return character === '' || WHITESPACE.test(character);
}

function isPunctuation(character: string): boolean
{
  return character !== '' && UNICODE_PUNCTUATION.test(character);
}

// Inline parsing after CommonMark's delimiter algorithm: one left-to-right pass builds a flat slot
// list with delimiter runs and bracket openers, links close at `]`, and emphasis is paired last.
class InlineParser
{
  readonly #text: string;
  readonly #slots: InlineSlot[] = [];
  readonly #delimiters: Delimiter[] = [];
  readonly #brackets: Bracket[] = [];
  // Backtick run lengths with no closing run after some position: no closing run after any later
  // position either, so a text full of stray backticks isn't rescanned for each one
  readonly #unclosedBacktickRuns = new Set<number>();
  #position = 0;
  #pendingText = '';

  constructor(text: string)
  {
    this.#text = text;
  }

  parse(): MarkdownInline[]
  {
    const text = this.#text;
    while (this.#position < text.length)
    {
      PLAIN_TEXT.lastIndex = this.#position;
      const plain = PLAIN_TEXT.exec(text);
      if (plain)
      {
        this.#pendingText += plain[0];
        this.#position += plain[0].length;
        continue;
      }
      const character = text[this.#position];
      if (character === '\\')
      {
        this.#escape();
      }
      else if (character === '\n')
      {
        this.#lineBreak();
      }
      else if (character === '`')
      {
        this.#codeSpan();
      }
      else if (character === '*' || character === '_')
      {
        this.#delimiterRun(character);
      }
      else if (character === '[')
      {
        this.#openBracket(false);
      }
      else if (character === '!' && text[this.#position + 1] === '[')
      {
        this.#openBracket(true);
      }
      else if (character === ']')
      {
        this.#closeBracket();
      }
      else
      {
        this.#pendingText += character;
        this.#position++;
      }
    }
    this.#flushText();
    this.#processEmphasis(0);
    return toInlineNodes(this.#slots);
  }

  #flushText(): void
  {
    if (this.#pendingText !== '')
    {
      this.#slots.push(InlineSlot.text(this.#pendingText));
      this.#pendingText = '';
    }
  }

  #push(slot: InlineSlot): void
  {
    this.#flushText();
    this.#slots.push(slot);
  }

  #escape(): void
  {
    const next = this.#text[this.#position + 1] ?? '';
    if (next === '\n')
    {
      this.#position++;
      this.#lineBreak();
      return;
    }
    if (ASCII_PUNCTUATION.test(next))
    {
      this.#pendingText += next;
      this.#position += 2;
      return;
    }
    this.#pendingText += '\\';
    this.#position++;
  }

  // Every newline inside a paragraph is a visible line break: answers are written for a chat, not
  // wrapped by hand.
  #lineBreak(): void
  {
    this.#push(new InlineSlot({ type: 'break' }, 0));
    this.#position++;
    while (this.#text[this.#position] === ' ' || this.#text[this.#position] === '\t')
    {
      this.#position++;
    }
  }

  #codeSpan(): void
  {
    const text = this.#text;
    const start = this.#position;
    const length = this.#runLength(start, '`');
    let search = start + length;
    while (!this.#unclosedBacktickRuns.has(length))
    {
      const next = text.indexOf('`', search);
      if (next === -1)
      {
        this.#unclosedBacktickRuns.add(length);
        break;
      }
      const nextLength = this.#runLength(next, '`');
      if (nextLength === length)
      {
        let code = text.slice(start + length, next).replace(/\n/g, ' ');
        if (code.length >= 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim() !== '')
        {
          code = code.slice(1, -1);
        }
        this.#push(new InlineSlot({ type: 'code', text: code }, 0));
        this.#position = next + length;
        return;
      }
      search = next + nextLength;
    }
    this.#pendingText += text.slice(start, start + length);
    this.#position = start + length;
  }

  #runLength(start: number, character: string): number
  {
    let end = start;
    while (this.#text[end] === character)
    {
      end++;
    }
    return end - start;
  }

  #delimiterRun(character: string): void
  {
    const start = this.#position;
    const length = this.#runLength(start, character);
    const before = characterBefore(this.#text, start);
    const after = characterAt(this.#text, start + length);
    const leftFlanking = !isWhitespace(after) && (!isPunctuation(after) || isWhitespace(before) || isPunctuation(before));
    const rightFlanking = !isWhitespace(before) && (!isPunctuation(before) || isWhitespace(after) || isPunctuation(after));
    // `_` inside a word (snake_case) neither opens nor closes
    const canOpen = character === '*' ? leftFlanking : leftFlanking && (!rightFlanking || isPunctuation(before));
    const canClose = character === '*' ? rightFlanking : rightFlanking && (!leftFlanking || isPunctuation(after));
    const slot = InlineSlot.text(character.repeat(length));
    this.#push(slot);
    this.#delimiters.push(new Delimiter(slot, character, length, canOpen, canClose));
    this.#position = start + length;
  }

  #openBracket(image: boolean): void
  {
    const slot = InlineSlot.text(image ? '![' : '[');
    this.#push(slot);
    this.#brackets.push(new Bracket(slot, image, this.#position, this.#delimiters.length));
    this.#position += image ? 2 : 1;
  }

  #closeBracket(): void
  {
    const bracket = this.#brackets.pop();
    const target = bracket?.active ? LinkTarget.parse(this.#text, this.#position + 1) : null;
    if (!bracket || !target)
    {
      this.#pendingText += ']';
      this.#position++;
      return;
    }
    this.#flushText();
    this.#processEmphasis(bracket.delimiterBottom);
    const openIndex = this.#slots.indexOf(bracket.slot);
    const label = this.#slots.slice(openIndex + 1);
    if (bracket.image)
    {
      this.#slots.splice(openIndex, label.length + 1, InlineSlot.text(this.#text.slice(bracket.sourceStart, target.end)));
      this.#position = target.end;
      return;
    }
    const href = safeLinkHref(target.destination);
    const height = 1 + maxHeight(label);
    if (href !== null && height > MAX_NESTING)
    {
      this.#pendingText += ']';
      this.#position++;
      return;
    }
    if (href === null)
    {
      // The label stays as plain inline content and the target is dropped
      this.#slots.splice(openIndex, 1);
    }
    else
    {
      this.#slots.splice(openIndex, label.length + 1, new InlineSlot({ type: 'link', href, children: toInlineNodes(label) }, height));
    }
    // A link can't contain another link
    for (const earlier of this.#brackets)
    {
      if (!earlier.image)
      {
        earlier.active = false;
      }
    }
    this.#position = target.end;
  }

  #processEmphasis(bottom: number): void
  {
    let closerIndex = bottom;
    while (closerIndex < this.#delimiters.length)
    {
      const closer = this.#delimiters[closerIndex];
      if (!closer.canClose)
      {
        closerIndex++;
        continue;
      }
      const openerIndex = this.#findOpener(closer, bottom, closerIndex);
      const wrapped = openerIndex !== -1 && this.#wrap(this.#delimiters[openerIndex], closer);
      if (!wrapped)
      {
        if (openerIndex !== -1)
        {
          // Too deep: any later pair with this opener or one before it would hold this content
          // too, so drop them all rather than retry each one for every later closer.
          this.#delimiters.splice(bottom, openerIndex - bottom + 1);
          closerIndex -= openerIndex - bottom + 1;
        }
        if (closer.canOpen)
        {
          closerIndex++;
        }
        else
        {
          this.#delimiters.splice(closerIndex, 1);
        }
        continue;
      }
      // Delimiters inside a matched pair can no longer pair with anything outside it
      this.#delimiters.splice(openerIndex + 1, closerIndex - openerIndex - 1);
      closerIndex = openerIndex + 1;
      const opener = this.#delimiters[openerIndex];
      if (opener.remaining === 0)
      {
        this.#removeSlot(opener.slot);
        this.#delimiters.splice(openerIndex, 1);
        closerIndex--;
      }
      if (closer.remaining === 0)
      {
        this.#removeSlot(closer.slot);
        this.#delimiters.splice(closerIndex, 1);
      }
    }
    this.#delimiters.splice(bottom);
  }

  #findOpener(closer: Delimiter, bottom: number, closerIndex: number): number
  {
    for (let index = closerIndex - 1; index >= bottom; index--)
    {
      if (this.#delimiters[index].opens(closer))
      {
        return index;
      }
    }
    return -1;
  }

  // Wraps the slots between the pair in strong (two characters from each side) or em (one), unless
  // that would nest deeper than MAX_NESTING.
  #wrap(opener: Delimiter, closer: Delimiter): boolean
  {
    const openIndex = this.#slots.indexOf(opener.slot);
    const closeIndex = this.#slots.indexOf(closer.slot);
    const inner = this.#slots.slice(openIndex + 1, closeIndex);
    const height = 1 + maxHeight(inner);
    if (height > MAX_NESTING)
    {
      return false;
    }
    const count = opener.remaining >= 2 && closer.remaining >= 2 ? 2 : 1;
    opener.use(count);
    closer.use(count);
    const children = toInlineNodes(inner);
    const node: MarkdownInline = count === 2 ? { type: 'strong', children } : { type: 'em', children };
    this.#slots.splice(openIndex + 1, inner.length, new InlineSlot(node, height));
    return true;
  }

  #removeSlot(slot: InlineSlot): void
  {
    this.#slots.splice(this.#slots.indexOf(slot), 1);
  }
}
