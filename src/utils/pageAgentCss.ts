// CSS the page agent writes goes through PageAgentCssSanitizer before it reaches a page. Page text
// reaches the model, so a prompt-injected page could make it write CSS that loads remote URLs
// (attribute selectors with url() backgrounds leak input values). CSS that can't load anything
// can only change how the page looks.

// Custom property the inserted stylesheet sets on :root, so the side panel can tell whether the
// page still has the stylesheet (a reload or navigation drops CSS inserted with insertCSS).
export const PAGE_AGENT_MARKER_PROPERTY = '--sidebar-page-agent';

// USER origin with !important declarations beats the page's own !important rules and inline
// styles, which some sites' scripts write for sizes.
export const PAGE_AGENT_CSS_ORIGIN: 'USER' | 'AUTHOR' = 'USER';

export const PAGE_AGENT_CSS_MAX_BYTES = 20 * 1024;

export type PageAgentCssCheck = { ok: true } | { ok: false; reason: string };

class ForbiddenConstruct
{
  readonly pattern: RegExp;
  readonly name: string;

  constructor(pattern: RegExp, name: string)
  {
    this.pattern = pattern;
    this.name = name;
  }
}

// var() is rejected outright: the page can define a custom property as a remote url(), and a text
// check can't follow var() to it. image-set() and src() are rejected outright too, even with data:
// URLs, since they also take a plain string as a URL. -webkit-image-set( comes before image-set(
// so the reason names the one the model wrote.
const FORBIDDEN_CONSTRUCTS = [
  new ForbiddenConstruct(/@import/i, '@import'),
  new ForbiddenConstruct(/-webkit-image-set\(/i, '-webkit-image-set()'),
  new ForbiddenConstruct(/image-set\(/i, 'image-set()'),
  new ForbiddenConstruct(/src\(/i, 'src()'),
  new ForbiddenConstruct(/var\(/i, 'var()'),
  new ForbiddenConstruct(/expression\(/i, 'expression()'),
  new ForbiddenConstruct(/behavior\s*:/i, 'behavior:'),
  new ForbiddenConstruct(/-moz-binding/i, '-moz-binding'),
];

// A backslash followed by 1-6 hex digits (and one optional whitespace, CRLF counting as one) is
// that code point; a backslash followed by any other character is that character.
const CSS_ESCAPE = /\\(?:([0-9a-fA-F]{1,6})(?:\r\n|[ \t\n\r\f])?|([\s\S]))/gu;

const URL_FUNCTION = /url\(/gi;

const URL_SNIPPET_LENGTH = 80;

export class PageAgentCssSanitizer
{
  static check(css: string): PageAgentCssCheck
  {
    if (new TextEncoder().encode(css).length > PAGE_AGENT_CSS_MAX_BYTES)
    {
      return { ok: false, reason: `the stylesheet is larger than ${PAGE_AGENT_CSS_MAX_BYTES / 1024} KB` };
    }

    // Comments are not stripped: a comment ends a token, so it can't hide url( or @import, while
    // stripping would also eat text inside strings (content:"/*" ... "*/") and a url( between them.
    const resolved = resolveCssEscapes(css);

    for (const construct of FORBIDDEN_CONSTRUCTS)
    {
      if (construct.pattern.test(resolved))
      {
        return { ok: false, reason: `${construct.name} is not allowed` };
      }
    }

    for (const match of resolved.matchAll(URL_FUNCTION))
    {
      const argument = urlArgument(resolved.slice((match.index ?? 0) + match[0].length));
      if (!argument.toLowerCase().startsWith('data:'))
      {
        return {
          ok: false,
          reason: `url() with a non-data: URL is not allowed (${JSON.stringify(urlSnippet(argument))}); only data: URLs may be used`,
        };
      }
    }

    return { ok: true };
  }
}

/**
 * The text that is inserted into the page: the sanitized stylesheet plus a :root rule that sets the
 * marker property to `appliedId`. removeCSS needs this exact text.
 */
export function withMarker(css: string, appliedId: string): string
{
  const quotedId = appliedId.replace(/["\\]/g, '\\$&');
  return `${css}\n:root { ${PAGE_AGENT_MARKER_PROPERTY}: "${quotedId}" !important; }\n`;
}

function resolveCssEscapes(css: string): string
{
  return css.replace(CSS_ESCAPE, (_match, hex: string | undefined, other: string | undefined) =>
  {
    if (hex === undefined)
    {
      return other ?? '';
    }
    const codePoint = parseInt(hex, 16);
    const isSurrogate = codePoint >= 0xd800 && codePoint <= 0xdfff;
    if (codePoint === 0 || codePoint > 0x10ffff || isSurrogate)
    {
      return '\uFFFD';
    }
    return String.fromCodePoint(codePoint);
  });
}

// The start of a url( argument with its opening quote and the leading whitespace and control
// characters the URL parser strips removed.
function urlArgument(afterParenthesis: string): string
{
  const unquoted = trimUrlStart(afterParenthesis);
  if (unquoted.startsWith('"') || unquoted.startsWith('\''))
  {
    return trimUrlStart(unquoted.slice(1));
  }
  return unquoted;
}

function trimUrlStart(text: string): string
{
  let start = 0;
  while (start < text.length && text.charCodeAt(start) <= 0x20)
  {
    start++;
  }
  return text.slice(start);
}

function urlSnippet(argument: string): string
{
  const end = argument.search(/["')]/);
  const url = end === -1 ? argument : argument.slice(0, end);
  return url.length > URL_SNIPPET_LENGTH ? `${url.slice(0, URL_SNIPPET_LENGTH)}...` : url;
}
