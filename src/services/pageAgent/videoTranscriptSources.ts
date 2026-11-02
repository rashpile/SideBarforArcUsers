// Where read_video_transcript takes the subtitles from, which track it reads, and which subtitle files
// it may download. The tool fetches a Prime subtitle URL taken from the page's own network traffic, so
// only Prime's subtitle CDN passes: a page can't steer the fetch elsewhere.

export type VideoTranscriptSource = 'prime-video' | 'page-video';

export interface TranscriptTrack
{
  /** Language code, e.g. `en-gb`; may be empty for a `<track>` without `srclang`. */
  code: string;
  name: string;
  kind: 'sdh' | 'subtitles' | 'captions';
  /** The track the player shows right now. */
  showing: boolean;
}

// Prime titles also open as store pages (`/<Title>/dp/<ASIN>`), so any path on a store host counts. A
// fixed list keeps hosts like `amazon.com.evil.org` out.
const AMAZON_STORES = [
  'com', 'ca', 'com.mx', 'com.br', 'co.uk', 'de', 'fr', 'it', 'es', 'nl', 'se', 'pl', 'com.be', 'com.tr',
  'ae', 'sa', 'eg', 'in', 'co.jp', 'sg', 'com.au',
];
const AMAZON_HOSTS: ReadonlySet<string> = new Set(
  AMAZON_STORES.flatMap(store => [`amazon.${store}`, `www.amazon.${store}`]),
);

export function videoTranscriptSource(pageUrl: string): VideoTranscriptSource
{
  const host = hostnameOf(pageUrl);
  if (host === null)
  {
    return 'page-video';
  }

  if (host === 'primevideo.com' || host.endsWith('.primevideo.com') || AMAZON_HOSTS.has(host))
  {
    return 'prime-video';
  }
  return 'page-video';
}

/** `code name` as the model sees it in the result and in errors. */
export function trackLabel(track: TranscriptTrack): string
{
  const code = track.code.trim();
  const name = track.name.trim();
  if (name === '' || name === code)
  {
    return code;
  }
  return code === '' ? name : `${code} ${name}`;
}

/**
 * With `language`, only tracks whose code starts with it (case-insensitive: `ru` picks `ru-ru`). Among
 * those, the track shown, else the SDH track (on Prime the original audio language), else English,
 * else the first.
 */
export function chooseTrack<Track extends TranscriptTrack>(
  tracks: readonly Track[],
  language?: string,
): Track | { error: string }
{
  if (tracks.length === 0)
  {
    return { error: 'the video has no subtitle tracks' };
  }

  const wanted = language?.trim().toLowerCase() ?? '';
  const candidates = wanted === ''
    ? tracks
    : tracks.filter(track => track.code.trim().toLowerCase().startsWith(wanted));
  if (candidates.length === 0)
  {
    return {
      error: `no subtitles for language "${language}"; available: ${tracks.map(trackLabel).join(', ')}`,
    };
  }

  return candidates.find(track => track.showing)
    ?? candidates.find(track => track.kind === 'sdh')
    ?? candidates.find(track => track.code.trim().toLowerCase().startsWith('en'))
    ?? candidates[0];
}

export function isPrimeSubtitleUrl(url: unknown): boolean
{
  if (typeof url !== 'string')
  {
    return false;
  }

  try
  {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname.endsWith('.pv-cdn.net');
  }
  catch
  {
    return false;
  }
}

function hostnameOf(url: string): string | null
{
  try
  {
    return new URL(url).hostname.toLowerCase();
  }
  catch
  {
    return null;
  }
}
