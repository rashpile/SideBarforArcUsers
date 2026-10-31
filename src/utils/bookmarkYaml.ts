// Bookmark folders as YAML: a serializer and a parser for one small YAML subset,
// written by hand to avoid a YAML dependency. The format is a list of items, each
// a bookmark (`title`, `url`) or a folder (`folder`, `items`).

import { ARCHIVE_FOLDER_TITLE, isSystemFolder } from './archiveFolder.ts';
import { FAVORITES_FOLDER_TITLE } from './favoritesFolder.ts';
import { normalizeBookmarkUrl } from './bookmarkUrl.ts';

/** The fields of a bookmark tree node the serializer reads. */
export interface YamlSourceNode
{
  title?: string;
  url?: string;
  children?: YamlSourceNode[];
}

export class YamlBookmark
{
  title: string;
  url: string;
  /** 1-based source line; 0 when not parsed from text. */
  line: number;

  constructor(title: string, url: string, line = 0)
  {
    this.title = title;
    this.url = url;
    this.line = line;
  }
}

export class YamlFolder
{
  title: string;
  items: YamlItem[];
  line: number;

  constructor(title: string, items: YamlItem[], line = 0)
  {
    this.title = title;
    this.items = items;
    this.line = line;
  }
}

export type YamlItem = YamlBookmark | YamlFolder;

export class YamlBookmarkList
{
  items: YamlItem[];

  constructor(items: YamlItem[])
  {
    this.items = items;
  }

  /** Builds the list from bookmark tree nodes, skipping system folders at any depth. */
  static fromBookmarkNodes(nodes: readonly YamlSourceNode[]): YamlBookmarkList
  {
    return new YamlBookmarkList(convertNodes(nodes));
  }

  toYaml(): string
  {
    if (this.items.length === 0) return '[]\n';
    const lines: string[] = [];
    writeItems(this.items, 0, lines);
    return lines.join('\n') + '\n';
  }

  counts(): { folders: number; bookmarks: number }
  {
    const counts = { folders: 0, bookmarks: 0 };
    countItems(this.items, counts);
    return counts;
  }

  /** e.g. `3 folders, 12 bookmarks`; zero parts are left out. */
  summary(): string
  {
    const { folders, bookmarks } = this.counts();
    const parts: string[] = [];
    if (folders > 0) parts.push(plural(folders, 'folder'));
    if (bookmarks > 0 || folders === 0) parts.push(plural(bookmarks, 'bookmark'));
    return parts.join(', ');
  }
}

function plural(count: number, word: string): string
{
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function convertNodes(nodes: readonly YamlSourceNode[]): YamlItem[]
{
  const items: YamlItem[] = [];
  for (const node of nodes)
  {
    if (isSystemFolder(node)) continue;
    if (node.url !== undefined)
    {
      items.push(new YamlBookmark(node.title ?? '', node.url));
    }
    else
    {
      items.push(new YamlFolder(node.title ?? '', convertNodes(node.children ?? [])));
    }
  }
  return items;
}

function countItems(items: readonly YamlItem[], counts: { folders: number; bookmarks: number }): void
{
  for (const item of items)
  {
    if (item instanceof YamlFolder)
    {
      counts.folders++;
      countItems(item.items, counts);
    }
    else
    {
      counts.bookmarks++;
    }
  }
}

function writeItems(items: readonly YamlItem[], indent: number, lines: string[]): void
{
  const pad = ' '.repeat(indent);
  for (const item of items)
  {
    if (item instanceof YamlFolder)
    {
      lines.push(`${pad}- folder: ${quote(item.title)}`);
      if (item.items.length === 0)
      {
        lines.push(`${pad}  items: []`);
      }
      else
      {
        lines.push(`${pad}  items:`);
        writeItems(item.items, indent + 4, lines);
      }
    }
    else
    {
      lines.push(`${pad}- title: ${quote(item.title)}`);
      lines.push(`${pad}  url: ${quote(item.url)}`);
    }
  }
}

function quote(value: string): string
{
  let out = '"';
  for (const ch of value)
  {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\r') out += '\\r';
    else if (code < 0x20 || code === 0x7f) out += '\\u' + code.toString(16).padStart(4, '0');
    else out += ch;
  }
  return out + '"';
}

// ---------------------------------------------------------------------------
// Parser

export class YamlParseError
{
  /** 1-based line number. */
  line: number;
  message: string;

  constructor(line: number, message: string)
  {
    this.line = line;
    this.message = message;
  }

  toString(): string
  {
    return `Line ${this.line}: ${this.message}`;
  }
}

export type YamlParseResult =
  | { ok: true; list: YamlBookmarkList }
  | { ok: false; errors: YamlParseError[] };

/** Thrown inside the parser to stop at the first structural error. */
class StructuralError extends Error
{
  line: number;

  constructor(line: number, message: string)
  {
    super(message);
    this.line = line;
  }
}

/** A non-blank, non-comment source line. */
class SourceLine
{
  number: number;
  indent: number;
  /** The text after the indentation. */
  content: string;

  constructor(number: number, indent: number, content: string)
  {
    this.number = number;
    this.indent = indent;
    this.content = content;
  }

  isSequenceItem(): boolean
  {
    return this.content === '-' || this.content.startsWith('- ');
  }
}

const KNOWN_KEYS = ['title', 'url', 'folder', 'items'];

/** Raw fields of one `- key: value` item before it becomes a bookmark or folder. */
class RawItem
{
  line: number;
  title?: string;
  url?: string;
  folder?: string;
  items?: YamlItem[];
  hasItems = false;
  #seenKeys = new Set<string>();

  constructor(line: number)
  {
    this.line = line;
  }

  claimKey(key: string, line: number): void
  {
    if (!KNOWN_KEYS.includes(key))
    {
      throw new StructuralError(line, `Unknown key "${key}" (expected title, url, folder or items).`);
    }
    if (this.#seenKeys.has(key))
    {
      throw new StructuralError(line, `Duplicate key "${key}".`);
    }
    this.#seenKeys.add(key);
  }

  toItem(): YamlItem
  {
    const hasUrl = this.url !== undefined;
    const hasFolder = this.folder !== undefined;
    if (hasUrl && hasFolder)
    {
      throw new StructuralError(this.line, 'An item has both "url" and "folder"; use one.');
    }
    if (!hasUrl && !hasFolder)
    {
      throw new StructuralError(this.line, 'An item needs "url" (bookmark) or "folder" (folder).');
    }
    if (hasFolder)
    {
      if (this.title !== undefined)
      {
        throw new StructuralError(this.line, 'A folder takes its name from "folder", not "title".');
      }
      return new YamlFolder(this.folder ?? '', this.items ?? [], this.line);
    }
    if (this.hasItems)
    {
      throw new StructuralError(this.line, 'A bookmark cannot have "items".');
    }
    return new YamlBookmark(this.title ?? '', this.url ?? '', this.line);
  }
}

class Parser
{
  #lines: SourceLine[];
  #position = 0;

  constructor(lines: SourceLine[])
  {
    this.#lines = lines;
  }

  parseDocument(): YamlItem[]
  {
    const first = this.#peek();
    if (!first || first.content === '[]' || stripComment(first.content) === '[]')
    {
      throw new StructuralError(first?.number ?? 1, 'Nothing to paste.');
    }
    if (!first.isSequenceItem())
    {
      throw new StructuralError(first.number, 'The top level must be a list: start each item with "- ".');
    }
    const items = this.#parseSequence(first.indent);
    const rest = this.#peek();
    if (rest)
    {
      throw new StructuralError(rest.number, 'Bad indentation.');
    }
    if (items.length === 0)
    {
      throw new StructuralError(first.number, 'Nothing to paste.');
    }
    return items;
  }

  #peek(): SourceLine | undefined
  {
    return this.#lines[this.#position];
  }

  /** Reads `- ` items at exactly `indent`; stops at the first line that is not one. */
  #parseSequence(indent: number): YamlItem[]
  {
    const items: YamlItem[] = [];
    for (let line = this.#peek(); line && line.indent === indent && line.isSequenceItem(); line = this.#peek())
    {
      items.push(this.#parseItem(line));
    }
    return items;
  }

  #parseItem(line: SourceLine): YamlItem
  {
    const afterDash = line.content.slice(1);
    const keyText = afterDash.trimStart();
    if (keyText === '')
    {
      throw new StructuralError(line.number, 'Expected "key: value" after "- ".');
    }
    const keyColumn = line.indent + 1 + (afterDash.length - keyText.length);
    const item = new RawItem(line.number);
    this.#position++;
    this.#parseKey(item, keyText, keyColumn, line.number);

    for (let next = this.#peek(); next && next.indent >= keyColumn; next = this.#peek())
    {
      if (next.indent > keyColumn)
      {
        throw new StructuralError(next.number, 'Bad indentation.');
      }
      this.#position++;
      this.#parseKey(item, next.content, keyColumn, next.number);
    }
    return item.toItem();
  }

  #parseKey(item: RawItem, text: string, keyColumn: number, lineNumber: number): void
  {
    const match = /^([A-Za-z_][\w-]*):(?:[ ]+(.*))?$/.exec(text);
    if (!match)
    {
      throw new StructuralError(lineNumber, 'Expected "key: value".');
    }
    const key = match[1];
    const rawValue = match[2] ?? '';
    item.claimKey(key, lineNumber);

    if (key === 'items')
    {
      item.hasItems = true;
      item.items = this.#parseItemsValue(rawValue, keyColumn, lineNumber);
      return;
    }
    const value = parseScalar(rawValue, lineNumber);
    if (key === 'title') item.title = value;
    else if (key === 'url') item.url = value;
    else item.folder = value;
  }

  #parseItemsValue(rawValue: string, keyColumn: number, lineNumber: number): YamlItem[]
  {
    const value = stripComment(rawValue).trim();
    if (value === '[]') return [];
    if (value !== '')
    {
      throw new StructuralError(lineNumber, '"items" must be a list: "items: []" or "- " lines below it.');
    }
    const next = this.#peek();
    if (!next || next.indent < keyColumn) return [];
    // PyYAML writes a nested list at the same indent as its key.
    if (next.isSequenceItem())
    {
      return this.#parseSequence(next.indent);
    }
    if (next.indent > keyColumn)
    {
      throw new StructuralError(next.number, '"items" must be a list: start each item with "- ".');
    }
    return [];
  }
}

/** Cuts a ` #` comment off a plain value. */
function stripComment(text: string): string
{
  if (text.startsWith('#')) return '';
  const at = text.search(/[ \t]#/);
  return at >= 0 ? text.slice(0, at) : text;
}

function parseScalar(raw: string, lineNumber: number): string
{
  if (raw.startsWith('"'))
  {
    return parseDoubleQuoted(raw, lineNumber);
  }
  if (raw.startsWith("'"))
  {
    return parseSingleQuoted(raw, lineNumber);
  }
  return stripComment(raw).trim();
}

function checkAfterQuote(rest: string, lineNumber: number): void
{
  const trimmed = rest.trimStart();
  if (trimmed !== '' && !(trimmed.startsWith('#') && trimmed.length < rest.length))
  {
    throw new StructuralError(lineNumber, 'Unexpected text after the closing quote.');
  }
}

const SIMPLE_ESCAPES: Record<string, string> = { '\\': '\\', '"': '"', 'n': '\n', 't': '\t', 'r': '\r', '/': '/' };

function parseDoubleQuoted(raw: string, lineNumber: number): string
{
  let out = '';
  let i = 1;
  while (i < raw.length)
  {
    const ch = raw[i];
    if (ch === '"')
    {
      checkAfterQuote(raw.slice(i + 1), lineNumber);
      return out;
    }
    if (ch !== '\\')
    {
      out += ch;
      i++;
      continue;
    }
    const escape = raw[i + 1];
    if (escape === undefined) break;
    if (escape in SIMPLE_ESCAPES)
    {
      out += SIMPLE_ESCAPES[escape];
      i += 2;
      continue;
    }
    if (escape === 'u')
    {
      const hex = raw.slice(i + 2, i + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex))
      {
        throw new StructuralError(lineNumber, 'Bad \\u escape: expected four hex digits.');
      }
      out += String.fromCharCode(parseInt(hex, 16));
      i += 6;
      continue;
    }
    throw new StructuralError(lineNumber, `Unknown escape "\\${escape}".`);
  }
  throw new StructuralError(lineNumber, 'Unterminated quote.');
}

function parseSingleQuoted(raw: string, lineNumber: number): string
{
  let out = '';
  let i = 1;
  while (i < raw.length)
  {
    const ch = raw[i];
    if (ch === "'")
    {
      if (raw[i + 1] === "'")
      {
        out += "'";
        i += 2;
        continue;
      }
      checkAfterQuote(raw.slice(i + 1), lineNumber);
      return out;
    }
    out += ch;
    i++;
  }
  throw new StructuralError(lineNumber, 'Unterminated quote.');
}

function readLines(text: string): SourceLine[]
{
  const source = text.startsWith('﻿') ? text.slice(1) : text;
  const lines: SourceLine[] = [];
  source.split(/\r?\n/).forEach((rawLine, index) =>
  {
    const number = index + 1;
    const line = rawLine.replace(/\s+$/, '');
    const indentMatch = /^[ \t]*/.exec(line);
    const leading = indentMatch ? indentMatch[0] : '';
    const content = line.slice(leading.length);
    if (content === '' || content.startsWith('#')) return;
    if (leading.includes('\t'))
    {
      throw new StructuralError(number, 'Tabs are not allowed for indentation; use spaces.');
    }
    lines.push(new SourceLine(number, leading.length, content));
  });
  return lines;
}

const SYSTEM_FOLDER_TITLES = [ARCHIVE_FOLDER_TITLE, FAVORITES_FOLDER_TITLE];

/** Normalizes URLs and fills missing titles in place; returns every problem found. */
function validateItems(items: readonly YamlItem[], errors: YamlParseError[]): void
{
  for (const item of items)
  {
    if (item instanceof YamlFolder)
    {
      if (item.title.trim() === '')
      {
        errors.push(new YamlParseError(item.line, 'A folder needs a name.'));
      }
      else if (SYSTEM_FOLDER_TITLES.includes(item.title))
      {
        errors.push(new YamlParseError(item.line, `"${item.title}" is reserved for the sidebar; rename the folder.`));
      }
      validateItems(item.items, errors);
      continue;
    }
    const url = normalizeBookmarkUrl(item.url);
    if (url === '')
    {
      errors.push(new YamlParseError(item.line, 'A bookmark needs a URL.'));
      continue;
    }
    try
    {
      new URL(url);
    }
    catch
    {
      errors.push(new YamlParseError(item.line, `Invalid URL "${item.url}".`));
      continue;
    }
    item.url = url;
    if (item.title.trim() === '') item.title = url;
  }
}

export function parseBookmarkYaml(text: string): YamlParseResult
{
  let items: YamlItem[];
  try
  {
    items = new Parser(readLines(text)).parseDocument();
  }
  catch (error)
  {
    if (error instanceof StructuralError)
    {
      return { ok: false, errors: [new YamlParseError(error.line, error.message)] };
    }
    throw error;
  }
  const errors: YamlParseError[] = [];
  validateItems(items, errors);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, list: new YamlBookmarkList(items) };
}
