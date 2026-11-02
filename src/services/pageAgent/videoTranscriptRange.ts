// Which part of a video's subtitles the read_video_transcript tool returns, and how it is laid out for
// the model. Without an explicit `to`, a video stopped mid-way is read only up to the playback
// position, so a summary of "what happened so far" can't give away the ending.

import type { SubtitleCue } from '../../utils/ttmlSubtitles.ts';

export const MAX_TRANSCRIPT_CHARS = 60_000;

// Before this position the user has barely started, and a summary of the whole video is what they
// most likely want.
const MID_WAY_FROM_SECONDS = 60;
const LINE_SPAN_SECONDS = 30;

export type TimeArg =
  | { kind: 'at'; seconds: number }
  | { kind: 'end' }
  | { kind: 'beforePosition'; seconds: number };

export type TranscriptStop = 'position' | 'given' | 'end';

export type TranscriptRange =
  | { ok: true; from: number; to: number; stop: TranscriptStop }
  | { ok: true; unknownPosition: true }
  | { ok: false; error: string };

export type ReadableTranscriptRange = Exclude<TranscriptRange, { ok: false }>;

export interface TranscriptMeta
{
  source: string;
  pageTitle: string;
  /** The chosen track as `code name`. */
  language: string;
  /** The chosen track's code, which the cut note passes on so the next call reads the same track. */
  languageCode: string;
  /** Every track as `code name`. */
  languages: string[];
  /** Seconds; null when the page doesn't know it. */
  duration: number | null;
  /** Seconds; null when the page doesn't know it. */
  position: number | null;
}

const SECONDS = /^\d+(?:\.\d+)?$/;
const MINUTES_SECONDS = /^(\d+):([0-5]\d(?:\.\d+)?)$/;
const HOURS_MINUTES_SECONDS = /^(\d+):([0-5]\d):([0-5]\d(?:\.\d+)?)$/;

/**
 * Seconds, `"s"`, `"m:ss"` (minutes may pass 59) or `"h:mm:ss"`; `"end"` only for `to`, and a
 * leading `-` (that long before the playback position) only for `from`. Null for anything else.
 */
export function parseTimeArg(value: unknown, field: 'from' | 'to'): TimeArg | null
{
  if (typeof value === 'number')
  {
    return Number.isFinite(value) && value >= 0 ? { kind: 'at', seconds: value } : null;
  }

  if (typeof value !== 'string')
  {
    return null;
  }

  const text = value.trim();
  if (field === 'to' && text.toLowerCase() === 'end')
  {
    return { kind: 'end' };
  }

  if (field === 'from' && text.startsWith('-'))
  {
    const seconds = clockSeconds(text.slice(1));
    return seconds === null ? null : { kind: 'beforePosition', seconds };
  }

  const seconds = clockSeconds(text);
  return seconds === null ? null : { kind: 'at', seconds };
}

/** `m:ss` under an hour, `h:mm:ss` from an hour; fractions are dropped. */
export function formatClock(seconds: number): string
{
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

export function resolveTranscriptRange(
  request: { from?: TimeArg; to?: TimeArg },
  video: { position: number | null; cues: readonly SubtitleCue[] },
): TranscriptRange
{
  const { position } = video;

  let from = 0;
  if (request.from !== undefined)
  {
    const resolved = resolvePoint(request.from, position, 'from');
    if (typeof resolved === 'string')
    {
      return { ok: false, error: resolved };
    }
    from = resolved;
  }

  if (request.to !== undefined)
  {
    const to = resolvePoint(request.to, position, 'to');
    if (typeof to === 'string')
    {
      return { ok: false, error: to };
    }
    if (from >= to)
    {
      return { ok: false, error: `from ${formatClock(from)} must be before to ${formatClock(to)}` };
    }
    return { ok: true, from, to, stop: to === Infinity ? 'end' : 'given' };
  }

  if (position === null)
  {
    return { ok: true, unknownPosition: true };
  }

  if (position < MID_WAY_FROM_SECONDS || position >= lastCueEnd(video.cues))
  {
    return { ok: true, from, to: Infinity, stop: 'end' };
  }

  if (from >= position)
  {
    return {
      ok: false,
      error: `from is after the current position ${formatClock(position)}; pass to: "end" only if the user asked about later parts`,
    };
  }
  return { ok: true, from, to: position, stop: 'position' };
}

/**
 * Groups cues into lines of about 30 s, each `[clock] text`, and adds whole lines while the text stays
 * within `maxChars`. `nextFrom` is the start of the first line left out, null when none was.
 */
export function formatTranscriptLines(
  cues: readonly SubtitleCue[],
  maxChars: number,
): { text: string; nextFrom: number | null }
{
  const lines = transcriptLines(cues);
  let text = '';
  for (let index = 0; index < lines.length; index++)
  {
    const line = lines[index];
    const next = text === '' ? line.text : `${text}\n${line.text}`;
    if (next.length > maxChars)
    {
      if (index === 0)
      {
        // A single line over the cap comes only from a broken track (cues stacked on one time); cut
        // it so the result stays within the cap and the next call still moves on.
        return { text: line.text.slice(0, maxChars), nextFrom: lines[1]?.start ?? null };
      }
      return { text, nextFrom: line.start };
    }
    text = next;
  }
  return { text, nextFrom: null };
}

/**
 * The tool's JSON for the model, with the metadata and the note before the long text so the model
 * reads them first, and the step summary for the side panel.
 */
export function buildTranscriptResult(
  meta: TranscriptMeta,
  cues: readonly SubtitleCue[],
  range: ReadableTranscriptRange,
  maxChars: number = MAX_TRANSCRIPT_CHARS,
): { content: string; summary: string }
{
  const header: Record<string, unknown> = {
    source: meta.source,
    page_title: meta.pageTitle,
    language: meta.language,
    languages: meta.languages,
    duration: meta.duration !== null && Number.isFinite(meta.duration) && meta.duration > 0
      ? formatClock(meta.duration)
      : 'unknown',
    position: meta.position === null ? 'unknown' : formatClock(meta.position),
    subtitles_until: cues.length > 0 ? formatClock(lastCueEnd(cues)) : 'none',
  };

  if ('unknownPosition' in range)
  {
    const content = JSON.stringify({
      ...header,
      note: 'The playback position is unknown, so no text is returned: it could give away the ending. Ask the ' +
        'user how far they watched, then call again with to set to that time, or to: "end" if they want the ' +
        'whole video.',
    });
    return { content, summary: `${meta.source}, ${meta.language}, position unknown` };
  }

  const inRange = cues
    .filter(cue => cue.start >= range.from && cue.start < range.to)
    .sort((a, b) => a.start - b.start);
  const { text, nextFrom } = formatTranscriptLines(inRange, maxChars);

  const from = formatClock(range.from);
  const to = range.stop === 'end' ? 'end' : formatClock(range.to);
  const result: Record<string, unknown> = {
    ...header,
    from,
    to: range.stop === 'position' ? `${to} (current position; pass to: "end" for the rest)` : to,
  };
  if (nextFrom !== null)
  {
    result.note = `cut at ${maxChars} characters; call again with ${continuationArgs(nextFrom, range, meta.languageCode)} for the rest`;
  }
  else if (text === '')
  {
    result.note = 'no subtitles in this range';
  }
  result.text = text;

  return {
    content: JSON.stringify(result),
    summary: `${meta.source}, ${meta.language}, ${from}–${to}, ${text.length} characters`,
  };
}

// The next call keeps this call's track and end. With `from` alone it would fall back to the defaults:
// the default track, which may be another one, and the position default, which stops a whole-video
// read at the position or returns nothing when the position is unknown. A range that stopped at the
// position came from that default, so its next call leaves `to` out again.
function continuationArgs(nextFrom: number, range: { to: number; stop: TranscriptStop }, languageCode: string): string
{
  const code = languageCode.trim();
  const args = code === '' ? [] : [`language: ${JSON.stringify(code)}`];
  args.push(`from: "${formatClock(nextFrom)}"`);
  switch (range.stop)
  {
    case 'end':
      args.push('to: "end"');
      break;
    case 'given':
      // Rounded up, so a `to` with a fraction doesn't lose the cues of its last second.
      args.push(`to: "${formatClock(Math.ceil(range.to))}"`);
      break;
    case 'position':
      break;
  }
  return args.join(', ');
}

function clockSeconds(text: string): number | null
{
  if (SECONDS.test(text))
  {
    return Number(text);
  }

  const minutes = MINUTES_SECONDS.exec(text);
  if (minutes !== null)
  {
    return Number(minutes[1]) * 60 + Number(minutes[2]);
  }

  const hours = HOURS_MINUTES_SECONDS.exec(text);
  if (hours !== null)
  {
    return Number(hours[1]) * 3600 + Number(hours[2]) * 60 + Number(hours[3]);
  }

  return null;
}

/** Seconds, or an error for the model when the point needs the position and it is unknown. */
function resolvePoint(point: TimeArg, position: number | null, field: 'from' | 'to'): number | string
{
  switch (point.kind)
  {
    case 'at':
      return point.seconds;
    case 'end':
      return Infinity;
    default:
      if (position === null)
      {
        return `${field}: "-${formatClock(point.seconds)}" needs the playback position, which is unknown; ` +
          'ask the user how far they watched';
      }
      return Math.max(0, position - point.seconds);
  }
}

export function lastCueEnd(cues: readonly SubtitleCue[]): number
{
  return cues.reduce((last, cue) => Math.max(last, cue.end), 0);
}

function transcriptLines(cues: readonly SubtitleCue[]): { start: number; text: string }[]
{
  const groups: { start: number; texts: string[] }[] = [];
  for (const cue of cues)
  {
    const last = groups[groups.length - 1];
    if (last === undefined || cue.start - last.start >= LINE_SPAN_SECONDS)
    {
      groups.push({ start: cue.start, texts: [cue.text] });
    }
    else
    {
      last.texts.push(cue.text);
    }
  }
  return groups.map(group => ({ start: group.start, text: `[${formatClock(group.start)}] ${group.texts.join(' ')}` }));
}
