// Prime Video serves subtitles as TTML2. The parser works on the text with regular expressions instead
// of DOMParser so the Node tests run it, and it keeps only what a transcript needs: each <p>'s times
// and its text.

export interface SubtitleCue
{
  /** Seconds. */
  start: number;
  /** Seconds. */
  end: number;
  text: string;
}

const DEFAULT_FRAME_RATE = 30;

const COMMENT = /<!--[\s\S]*?-->/g;
const ROOT_START_TAG = /<(?:[\w.-]+:)?tt(?:\s([^>]*))?>/;
const ATTRIBUTE = /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const LINE_BREAK = /<(?:[\w.-]+:)?br(?:\s[^>]*)?\/?>/g;
const TAG = /<[^>]*>/g;
const CLOCK_TIME = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/;
const CLOCK_TIME_WITH_FRAMES = /^(\d+):(\d+):(\d+):(\d+)(?:\.\d+)?$/;
const OFFSET_TIME = /^(\d+(?:\.\d+)?)(h|ms|m|s|f|t)$/;
const ENTITY = /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z]+));/g;

// XML's predefined entities, plus the ones WebVTT cue text uses: the transcript reader decodes
// <track> cue text with this decoder too.
const NAMED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', '\''],
  ['nbsp', '\u00a0'],
  ['lrm', '\u200e'],
  ['rlm', '\u200f'],
]);

export function parseTtml(xml: string): SubtitleCue[]
{
  const text = xml.replace(COMMENT, '');
  const timing = TtmlTiming.fromRootAttributes(attributesOf(ROOT_START_TAG.exec(text)?.[1] ?? ''));
  const cues: SubtitleCue[] = [];

  const startTag = /<(?:[\w.-]+:)?p(?:\s([^>]*?))?\s*(\/)?>/g;
  const endTag = /<\/(?:[\w.-]+:)?p\s*>/g;
  let match: RegExpExecArray | null;
  while ((match = startTag.exec(text)) !== null)
  {
    if (match[2] === '/')
    {
      continue;
    }

    endTag.lastIndex = startTag.lastIndex;
    const end = endTag.exec(text);
    if (end === null)
    {
      break;
    }

    const content = text.slice(startTag.lastIndex, end.index);
    startTag.lastIndex = endTag.lastIndex;
    const cue = paragraphCue(attributesOf(match[1] ?? ''), content, timing);
    if (cue !== null)
    {
      cues.push(cue);
    }
  }

  return cues.sort((a, b) => a.start - b.start);
}

/** Decodes XML character references and the named entities XML and WebVTT use; unknown ones stay as written. */
export function decodeEntities(text: string): string
{
  return text.replace(ENTITY, (whole, decimal: string | undefined, hex: string | undefined, name: string | undefined) =>
  {
    if (name !== undefined)
    {
      return NAMED_ENTITIES.get(name) ?? whole;
    }

    const codePoint = decimal !== undefined ? parseInt(decimal, 10) : parseInt(hex ?? '', 16);
    return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : whole;
  });
}

function paragraphCue(attributes: Map<string, string>, content: string, timing: TtmlTiming): SubtitleCue | null
{
  const start = timing.seconds(attributes.get('begin'));
  if (start === null)
  {
    return null;
  }

  const text = decodeEntities(content.replace(LINE_BREAK, ' ').replace(TAG, ''))
    .replace(/\s+/g, ' ')
    .trim();
  if (text === '')
  {
    return null;
  }

  // With both end and dur the earlier one ends the cue, as in TTML's timing model.
  const ends: number[] = [];
  const end = timing.seconds(attributes.get('end'));
  if (end !== null)
  {
    ends.push(end);
  }
  const duration = timing.seconds(attributes.get('dur'));
  if (duration !== null)
  {
    ends.push(start + duration);
  }

  return { start, end: Math.max(start, ends.length > 0 ? Math.min(...ends) : start), text };
}

/** Attributes by local name: `ttp:frameRate` is `frameRate`, whatever prefix the file binds. */
function attributesOf(source: string): Map<string, string>
{
  const attributes = new Map<string, string>();
  for (const match of source.matchAll(ATTRIBUTE))
  {
    const localName = match[1].slice(match[1].lastIndexOf(':') + 1);
    if (!attributes.has(localName))
    {
      attributes.set(localName, match[2] ?? match[3] ?? '');
    }
  }
  return attributes;
}

class TtmlTiming
{
  readonly frameRate: number;
  readonly tickRate: number;

  constructor(frameRate: number, tickRate: number)
  {
    this.frameRate = frameRate;
    this.tickRate = tickRate;
  }

  // TTML: without ttp:tickRate, a file that sets ttp:frameRate counts ticks in frames, else in seconds.
  static fromRootAttributes(attributes: Map<string, string>): TtmlTiming
  {
    const frameRate = positiveNumber(attributes.get('frameRate'));
    const tickRate = positiveNumber(attributes.get('tickRate'));
    return new TtmlTiming(frameRate ?? DEFAULT_FRAME_RATE, tickRate ?? frameRate ?? 1);
  }

  seconds(expression: string | undefined): number | null
  {
    if (expression === undefined)
    {
      return null;
    }

    const value = expression.trim();

    const clock = CLOCK_TIME.exec(value);
    if (clock !== null)
    {
      return Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
    }

    const withFrames = CLOCK_TIME_WITH_FRAMES.exec(value);
    if (withFrames !== null)
    {
      return Number(withFrames[1]) * 3600 + Number(withFrames[2]) * 60 + Number(withFrames[3])
        + Number(withFrames[4]) / this.frameRate;
    }

    const offset = OFFSET_TIME.exec(value);
    if (offset === null)
    {
      return null;
    }

    const count = Number(offset[1]);
    switch (offset[2])
    {
      case 'h':
        return count * 3600;
      case 'm':
        return count * 60;
      case 's':
        return count;
      case 'ms':
        return count / 1000;
      case 'f':
        return count / this.frameRate;
      default:
        return count / this.tickRate;
    }
  }
}

function positiveNumber(value: string | undefined): number | null
{
  if (value === undefined)
  {
    return null;
  }

  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
