// Functions read_video_transcript injects with chrome.scripting.executeScript.
//
// Chrome serializes an injected function's source and runs it in the page, so every function here must
// stay self-contained: no imports, no module-level constants or helpers, only their arguments and
// nested functions. Types are fine: they are erased. Node tests import this module, so nothing here may
// touch the DOM or chrome.* at import time.

import type { SubtitleCue } from '../../utils/ttmlSubtitles.ts';
import type { TranscriptTrack } from './videoTranscriptSources.ts';

/** A subtitle track from Prime's GetVodPlaybackResources response. */
export interface PrimeSubtitleTrack extends TranscriptTrack
{
  url: string;
}

export interface PrimeCaptureResult
{
  /** The wrapper went in with this call: nothing can be captured until the player opens again. */
  installedNow: boolean;
  /** Null until the player has asked for its playback resources since the wrapper went in. */
  tracks: PrimeSubtitleTrack[] | null;
  /** The `<video>` with the longest duration (the episode, not the trailer); null when none knows it. */
  video: { duration: number; position: number | null } | null;
  title: string;
}

export type SubtitleFileResult = { text: string } | { error: string };

export interface PageVideoTrack extends TranscriptTrack
{
  /** Index in the video's `textTracks`, for the second call that reads the cues. */
  index: number;
}

export type PageVideoResult =
  | { noVideo: true }
  | {
    video: { duration: number | null; position: number };
    tracks: PageVideoTrack[];
    /** Only when a track index was given; raw cue text, WebVTT tags included. Empty when none loaded in time. */
    cues?: SubtitleCue[];
  };

interface PrimeCaptureState
{
  tracks: PrimeSubtitleTrack[] | null;
  capturedAt: number;
}

/**
 * Injected into the MAIN world: the player's own `window.fetch` is the one to wrap. The first call
 * wraps it, so the player's next GetVodPlaybackResources response leaves its subtitle list in
 * `window[property]`; later calls only read that list. The player looks `window.fetch` up on each
 * request, so a wrapper added after the page loaded still sees the request when the player opens again.
 *
 * The wrapper must never change what the page gets: it returns the original fetch's own promise, and
 * everything the capture does is caught and dropped.
 */
export function primeSubtitleCapture(property: string): PrimeCaptureResult
{
  const maxTracks = 100;
  const pageWindow = window as unknown as Record<string, unknown>;

  function requestUrl(input: unknown): string
  {
    if (typeof input === 'string')
    {
      return input;
    }
    const candidate = input as { href?: unknown; url?: unknown } | null;
    if (candidate && typeof candidate.href === 'string')
    {
      return candidate.href;
    }
    return candidate && typeof candidate.url === 'string' ? candidate.url : '';
  }

  // Keeps only what the transcript needs: the playback envelope and session data in the same response
  // never leave this function.
  function subtitleTracks(body: unknown): PrimeSubtitleTrack[] | null
  {
    const list = (body as { timedTextUrls?: { result?: { subtitleUrls?: unknown } } } | null)
      ?.timedTextUrls?.result?.subtitleUrls;
    if (!Array.isArray(list))
    {
      return null;
    }
    const tracks: PrimeSubtitleTrack[] = [];
    for (const entry of list)
    {
      if (tracks.length >= maxTracks)
      {
        break;
      }
      const { languageCode, url, displayName, type } = (entry ?? {}) as Record<string, unknown>;
      if (typeof languageCode !== 'string' || typeof url !== 'string')
      {
        continue;
      }
      tracks.push({
        code: languageCode,
        name: typeof displayName === 'string' ? displayName : languageCode,
        kind: type === 'Sdh' ? 'sdh' : 'subtitles',
        showing: false,
        url,
      });
    }
    return tracks;
  }

  let state = pageWindow[property] as PrimeCaptureState | undefined;
  const installedNow = state === undefined;
  if (state === undefined)
  {
    const created: PrimeCaptureState = { tracks: null, capturedAt: 0 };
    state = created;
    Object.defineProperty(window, property, { value: created, enumerable: false });

    const original = window.fetch;
    window.fetch = function (this: unknown, ...args: Parameters<typeof fetch>): Promise<Response>
    {
      const promise = original.apply(this, args);
      try
      {
        if (requestUrl(args[0]).includes('/playback/prs/GetVodPlaybackResources'))
        {
          // Attached before the page gets the promise, so the clone is taken before the page reads the body.
          promise
            .then(response => response.clone().json())
            .then(body =>
            {
              const tracks = subtitleTracks(body);
              if (tracks !== null)
              {
                created.tracks = tracks;
                created.capturedAt = Date.now();
              }
            })
            .catch(() => undefined);
        }
      }
      catch
      {
        // The page's request goes on whatever the capture runs into.
      }
      return promise;
    };
  }

  let episode: HTMLVideoElement | null = null;
  for (const video of Array.from(document.querySelectorAll('video')))
  {
    if (Number.isFinite(video.duration) && video.duration > 0 && (episode === null || video.duration > episode.duration))
    {
      episode = video;
    }
  }

  return {
    installedNow,
    tracks: Array.isArray(state.tracks) ? state.tracks.map(track => ({ ...track })) : null,
    // After ✕ the episode element can stay in the page at 0, which must not read as "not started".
    video: episode === null
      ? null
      : { duration: episode.duration, position: episode.currentTime > 0 ? episode.currentTime : null },
    title: document.title,
  };
}

/**
 * Injected into the isolated world. The browser's own fetch under the page's CORS, without cookies, so
 * the extension reads only what the page itself could read.
 */
export async function fetchSubtitleFile(url: string, maxChars: number): Promise<SubtitleFileResult>
{
  try
  {
    const response = await fetch(url, { credentials: 'omit' });
    if (!response.ok)
    {
      return { error: `HTTP ${response.status}` };
    }
    const text = await response.text();
    return text.length > maxChars ? { error: 'too large' } : { text };
  }
  catch (error)
  {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Injected into the isolated world. The `<video>` with the largest visible area and its subtitle and
 * caption tracks; with `trackIndex`, also that track's cues. A track that is off loads no cues, so it
 * is switched to hidden for the read and back afterwards: the captions the user sees don't change.
 */
export async function readPageVideo(trackIndex: number | null, timeoutMs: number): Promise<PageVideoResult>
{
  const pollMs = 100;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let chosen: HTMLVideoElement | null = null;
  let chosenArea = 0;
  for (const video of Array.from(document.querySelectorAll('video')))
  {
    const rect = video.getBoundingClientRect();
    const width = Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0);
    const height = Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0);
    const area = Math.max(0, width) * Math.max(0, height);
    if (area > chosenArea)
    {
      chosen = video;
      chosenArea = area;
    }
  }
  if (chosen === null)
  {
    return { noVideo: true };
  }

  const tracks: PageVideoTrack[] = [];
  Array.from(chosen.textTracks).forEach((track, index) =>
  {
    if (track.kind === 'subtitles' || track.kind === 'captions')
    {
      tracks.push({ index, code: track.language, name: track.label, kind: track.kind, showing: track.mode === 'showing' });
    }
  });
  // A page's <video> stays in the page, so 0 really means not started, which reads the whole video.
  const video = {
    duration: Number.isFinite(chosen.duration) ? chosen.duration : null,
    position: chosen.currentTime,
  };
  if (trackIndex === null)
  {
    return { video, tracks };
  }

  const track = chosen.textTracks[trackIndex];
  if (!track || (track.kind !== 'subtitles' && track.kind !== 'captions'))
  {
    return { video, tracks, cues: [] };
  }

  const switchedOn = track.mode === 'disabled';
  if (switchedOn)
  {
    track.mode = 'hidden';
  }
  try
  {
    const deadline = Date.now() + timeoutMs;
    while ((track.cues?.length ?? 0) === 0 && Date.now() < deadline)
    {
      await new Promise(resolve => setTimeout(resolve, pollMs));
    }
    const cues: SubtitleCue[] = [];
    const list = track.cues;
    for (let i = 0; list !== null && i < list.length; i++)
    {
      const cue = list[i];
      cues.push({
        start: cue.startTime,
        end: cue.endTime,
        text: 'text' in cue && typeof cue.text === 'string' ? cue.text : '',
      });
    }
    return { video, tracks, cues };
  }
  finally
  {
    // Left alone when the user switched the captions on during the wait.
    if (switchedOn && track.mode === 'hidden')
    {
      track.mode = 'disabled';
    }
  }
}
