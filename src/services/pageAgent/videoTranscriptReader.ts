// What read_video_transcript does on a tab: picks the source by the page URL, gets the subtitles
// through page scripts and hands the model the part the range allows. On Prime Video the subtitle list
// comes from the player's own request, captured in the page; anywhere else from the text tracks of the
// video on the page.
//
// When the subtitles can't be read yet, the result is a message for the model that ends with what to
// tell the user, so the run goes on and the user learns what to do. A page script that fails rejects,
// and the run turns that into a tool error.

import { decodeEntities, parseTtml } from '../../utils/ttmlSubtitles.ts';
import type { SubtitleCue } from '../../utils/ttmlSubtitles.ts';
import type { PageAgentPluginResult } from './pageAgentPlugin.ts';
import { fetchSubtitleFile, primeSubtitleCapture, readPageVideo } from './videoPageScripts.ts';
import type { PrimeCaptureResult } from './videoPageScripts.ts';
import { buildTranscriptResult, lastCueEnd, resolveTranscriptRange } from './videoTranscriptRange.ts';
import type { TimeArg, TranscriptMeta } from './videoTranscriptRange.ts';
import { chooseTrack, isPrimeSubtitleUrl, trackLabel, videoTranscriptSource } from './videoTranscriptSources.ts';

// The page's window property that holds the captured subtitle list until the page reloads.
const PRIME_CAPTURE_PROPERTY = '__sidebarPageAgentPrimeSubtitles';
const SUBTITLE_FILE_MAX_CHARS = 5_000_000;
const TRACK_CUES_TIMEOUT_MS = 5000;
// An episode can end a little before its last cue does; a trailer is a small part of it.
const MIN_VIDEO_SHARE_OF_SUBTITLES = 0.9;

const CAPTURE_INSTALLED = 'Subtitle capture is now on for this page. Ask the user to close the player with ✕ ' +
  '(top left) and press Play again, then ask again. Reloading the page turns it off.';
const NOTHING_CAPTURED = 'No subtitle list captured yet: ask the user to close the player with ✕ if it is open ' +
  'and press Play, then ask again.';
const NO_SUBTITLES = 'This video has no subtitles.';
const UNSAFE_SUBTITLE_URL = 'The subtitle list points outside Prime Video\'s subtitle servers; not reading it.';
const NO_READABLE_CUES = 'The subtitle file has no readable cues.';
const NO_VIDEO = 'No video on this page; videos inside embedded frames can\'t be read.';
const NO_TRACKS = 'The video on this page has no subtitle tracks.';
const CUES_NOT_LOADED = 'The subtitles didn\'t load; ask the user to start the video and try again.';

const CUE_MARKUP = /<[^>]*>/g;

export interface VideoPageAccess
{
  pageUrl(tabId: number): Promise<string>;
  runScript<Args extends unknown[], Result>(
    tabId: number,
    func: (...args: Args) => Result,
    args: Args,
    world: 'MAIN' | 'ISOLATED',
  ): Promise<Awaited<Result>>;
}

export interface VideoTranscriptRequest
{
  /**
   * A language code or its start, e.g. `en`. Absent: on Prime the original language (SDH track), on
   * other pages the track shown; else English, else the first track (see `chooseTrack`).
   */
  language?: string;
  from?: TimeArg;
  to?: TimeArg;
}

export class VideoTranscriptReader
{
  readonly #page: VideoPageAccess;

  constructor(page: VideoPageAccess)
  {
    this.#page = page;
  }

  async read(tabId: number, request: VideoTranscriptRequest): Promise<PageAgentPluginResult>
  {
    const source = videoTranscriptSource(await this.#page.pageUrl(tabId));
    return source === 'prime-video'
      ? await this.#readPrime(tabId, request)
      : await this.#readPageVideo(tabId, request);
  }

  async #readPrime(tabId: number, request: VideoTranscriptRequest): Promise<PageAgentPluginResult>
  {
    const capture = await this.#page.runScript(tabId, primeSubtitleCapture, [PRIME_CAPTURE_PROPERTY], 'MAIN');
    if (capture.installedNow)
    {
      return message(CAPTURE_INSTALLED);
    }
    if (capture.tracks === null)
    {
      return message(NOTHING_CAPTURED);
    }
    if (capture.tracks.length === 0)
    {
      return message(NO_SUBTITLES);
    }

    const track = chooseTrack(capture.tracks, request.language);
    if ('error' in track)
    {
      return { ok: false, error: track.error };
    }
    // The list was captured in the page's MAIN world, where the page can change it: only Prime's
    // subtitle servers are fetched, whatever it says.
    if (!isPrimeSubtitleUrl(track.url))
    {
      return message(UNSAFE_SUBTITLE_URL);
    }

    const file = await this.#page.runScript(
      tabId,
      fetchSubtitleFile,
      [track.url, SUBTITLE_FILE_MAX_CHARS],
      'ISOLATED',
    );
    if ('error' in file)
    {
      return message(`Could not download the subtitles (${file.error}).`);
    }

    const cues = parseTtml(file.text);
    if (cues.length === 0)
    {
      return message(NO_READABLE_CUES);
    }

    const video = videoOfSubtitles(capture.video, cues);
    return transcript({
      source: 'prime-video',
      pageTitle: capture.title,
      language: trackLabel(track),
      languageCode: track.code,
      languages: capture.tracks.map(trackLabel),
      duration: video?.duration ?? null,
      position: video?.position ?? null,
    }, cues, request);
  }

  async #readPageVideo(tabId: number, request: VideoTranscriptRequest): Promise<PageAgentPluginResult>
  {
    const listing = await this.#page.runScript(tabId, readPageVideo, [null, TRACK_CUES_TIMEOUT_MS], 'ISOLATED');
    if ('noVideo' in listing)
    {
      return message(NO_VIDEO);
    }
    if (listing.tracks.length === 0)
    {
      return message(NO_TRACKS);
    }

    const track = chooseTrack(listing.tracks, request.language);
    if ('error' in track)
    {
      return { ok: false, error: track.error };
    }

    const read = await this.#page.runScript(tabId, readPageVideo, [track.index, TRACK_CUES_TIMEOUT_MS], 'ISOLATED');
    if ('noVideo' in read)
    {
      return message(NO_VIDEO);
    }
    const loaded = read.cues ?? [];
    if (loaded.length === 0)
    {
      return message(CUES_NOT_LOADED);
    }

    const cues = loaded
      .map(cue => ({ start: cue.start, end: cue.end, text: cleanWebVttText(cue.text) }))
      .filter(cue => cue.text !== '');
    if (cues.length === 0)
    {
      return message(NO_READABLE_CUES);
    }

    return transcript({
      source: 'page-video',
      pageTitle: read.title,
      language: trackLabel(track),
      languageCode: track.code,
      languages: read.tracks.map(trackLabel),
      duration: read.video.duration,
      position: read.video.position,
    }, cues, request);
  }
}

// After ✕ the episode's element can lose its duration while the detail page's trailer plays, which
// makes the trailer the longest <video>. Its time must not pass for the playback position (under a
// minute it would read the whole episode), so a video much shorter than the subtitles counts as unknown.
function videoOfSubtitles(
  video: PrimeCaptureResult['video'],
  cues: readonly SubtitleCue[],
): PrimeCaptureResult['video']
{
  if (video === null || video.duration < lastCueEnd(cues) * MIN_VIDEO_SHARE_OF_SUBTITLES)
  {
    return null;
  }
  return video;
}

function message(text: string): PageAgentPluginResult
{
  return { ok: true, content: text, summary: text };
}

function transcript(meta: TranscriptMeta, cues: SubtitleCue[], request: VideoTranscriptRequest): PageAgentPluginResult
{
  const range = resolveTranscriptRange(request, { position: meta.position, cues });
  if (!range.ok)
  {
    return { ok: false, error: range.error };
  }
  const { content, summary } = buildTranscriptResult(meta, cues, range);
  return { ok: true, content, summary };
}

// A <track>'s cue text is WebVTT markup: voice, class and timestamp tags (`<v Bob>`, `<c.loud>`,
// `<00:01.000>`) and character references, with line breaks between the lines on screen.
function cleanWebVttText(text: string): string
{
  return decodeEntities(text.replace(CUE_MARKUP, '')).replace(/\s+/g, ' ').trim();
}
