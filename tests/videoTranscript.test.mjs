import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTranscriptResult,
  formatTranscriptLines,
  parseTimeArg,
  resolveTranscriptRange,
} from '../src/services/pageAgent/videoTranscriptRange.ts';
import {
  chooseTrack,
  isPrimeSubtitleUrl,
  videoTranscriptSource,
} from '../src/services/pageAgent/videoTranscriptSources.ts';

// A cue every 10 s for ten minutes; each text names its start so a test can tell which cues came back.
function cuesEvery10s(until = 600)
{
  const cues = [];
  for (let start = 0; start < until; start += 10)
  {
    cues.push({ start, end: start + 5, text: cueText(start) });
  }
  return cues;
}

function cueText(start)
{
  return `cue${String(start).padStart(4, '0')}`;
}

function cueStartsIn(text)
{
  return [...text.matchAll(/cue(\d{4})/g)].map(match => Number(match[1]));
}

const META = {
  source: 'prime-video',
  pageTitle: 'Episode 4',
  language: 'en-gb English [CC]',
  languages: ['en-gb English [CC]', 'ru-ru Русский'],
  duration: 600,
  position: null,
};

function read(cues, { position = null, from, to, maxChars } = {})
{
  const request = {};
  if (from !== undefined)
  {
    request.from = parseTimeArg(from, 'from');
  }
  if (to !== undefined)
  {
    request.to = parseTimeArg(to, 'to');
  }

  const range = resolveTranscriptRange(request, { position, cues });
  if (!range.ok)
  {
    return { error: range.error };
  }
  const { content } = buildTranscriptResult({ ...META, position }, cues, range, maxChars);
  return JSON.parse(content);
}

test('mid-way without to stops at the position: no cue starting at or after it', () =>
{
  const result = read(cuesEvery10s(), { position: 300 });

  const starts = cueStartsIn(result.text);
  assert.equal(starts[0], 0);
  assert.equal(Math.max(...starts), 290);
  assert.match(result.to, /^5:00 \(current position; pass to: "end"/);
});

test('to: "end" reads past the position to the last cue', () =>
{
  const result = read(cuesEvery10s(), { position: 300, to: 'end' });

  assert.equal(Math.max(...cueStartsIn(result.text)), 590);
  assert.equal(result.to, 'end');
});

test('a position under a minute or after the last cue reads the whole video', () =>
{
  for (const position of [0, 59, 595, 2000])
  {
    const result = read(cuesEvery10s(), { position });
    assert.equal(Math.max(...cueStartsIn(result.text)), 590, `position ${position}`);
    assert.equal(result.to, 'end');
  }
});

test('an unknown position without to returns no text and asks how far the user watched', () =>
{
  const result = read(cuesEvery10s(), { position: null });

  assert.equal(result.text, undefined);
  assert.equal(result.position, 'unknown');
  assert.match(result.note, /position is unknown/);
  assert.match(result.note, /how far they watched/);
});

test('an unknown position with to reads the requested range', () =>
{
  const result = read(cuesEvery10s(), { position: null, to: '2:00' });

  assert.deepEqual(cueStartsIn(result.text), cuesEvery10s(120).map(cue => cue.start));
  assert.equal(result.note, undefined);
});

test('from "-2:00" mid-way reads the two minutes before the position', () =>
{
  const result = read(cuesEvery10s(), { position: 300, from: '-2:00' });

  assert.deepEqual(cueStartsIn(result.text), [180, 190, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290]);
  assert.equal(result.from, '3:00');
});

test('from "-2:00" with an unknown position is an error', () =>
{
  const result = read(cuesEvery10s(), { position: null, from: '-2:00' });

  assert.match(result.error, /position/);
});

test('from past the position without to is an error naming the position', () =>
{
  const result = read(cuesEvery10s(), { position: 300, from: '7:00' });

  assert.match(result.error, /current position 5:00/);
  assert.match(result.error, /to: "end"/);
});

test('a cut result names the start of the first omitted line and never cuts inside a line', () =>
{
  const cues = cuesEvery10s();
  const whole = formatTranscriptLines(cues, Infinity).text.split('\n');
  // Lines group 30 s of cues: three cues each.
  assert.equal(whole.length, 20);

  const maxChars = whole[0].length + 1 + whole[1].length + 1 + Math.floor(whole[2].length / 2);
  const cut = formatTranscriptLines(cues, maxChars);

  assert.deepEqual(cut.text.split('\n'), whole.slice(0, 2));
  assert.equal(cut.nextFrom, 60);

  const result = read(cues, { position: null, to: 'end', maxChars });
  assert.equal(result.note, 'cut at ' + maxChars + ' characters; call again with from: "1:00" for the rest');
  assert.deepEqual(result.text.split('\n'), whole.slice(0, 2));
});

test('the next call from the named start continues without a gap', () =>
{
  const cues = cuesEvery10s();
  const whole = formatTranscriptLines(cues, Infinity).text.split('\n');
  const maxChars = whole[0].length + 1 + whole[1].length;

  const first = read(cues, { position: null, to: 'end', maxChars });
  const second = read(cues, { position: null, from: '1:00', to: 'end', maxChars });

  assert.deepEqual([...cueStartsIn(first.text), ...cueStartsIn(second.text)], cueStartsIn(whole.slice(0, 4).join('\n')));
});

test('an empty range gives empty text and says so', () =>
{
  const result = read(cuesEvery10s(), { position: null, from: '20:00', to: 'end' });

  assert.equal(result.text, '');
  assert.equal(result.note, 'no subtitles in this range');
});

test('parseTimeArg accepts seconds, m:ss, h:mm:ss, "end" for to and "-m:ss" for from', () =>
{
  assert.deepEqual(parseTimeArg(90, 'from'), { kind: 'at', seconds: 90 });
  assert.deepEqual(parseTimeArg('12.5', 'to'), { kind: 'at', seconds: 12.5 });
  assert.deepEqual(parseTimeArg('1:05', 'to'), { kind: 'at', seconds: 65 });
  assert.deepEqual(parseTimeArg('75:30', 'to'), { kind: 'at', seconds: 4530 });
  assert.deepEqual(parseTimeArg('1:02:03.5', 'from'), { kind: 'at', seconds: 3723.5 });
  assert.deepEqual(parseTimeArg('end', 'to'), { kind: 'end' });
  assert.deepEqual(parseTimeArg('-2:00', 'from'), { kind: 'beforePosition', seconds: 120 });
});

test('parseTimeArg rejects "end" for from, a leading minus for to, and malformed values', () =>
{
  assert.equal(parseTimeArg('end', 'from'), null);
  assert.equal(parseTimeArg('-2:00', 'to'), null);
  for (const value of [-5, NaN, Infinity, '', 'soon', '1:5', '1:60', '1:60:00', '1::00', '1:00:', '-end', '--1:00', 'end ish', null, {}, [60]])
  {
    assert.equal(parseTimeArg(value, 'from'), null, `from ${JSON.stringify(value)}`);
    assert.equal(parseTimeArg(value, 'to'), null, `to ${JSON.stringify(value)}`);
  }
});

test('Prime Video pages on store hosts and primevideo.com read from Prime; look-alike hosts do not', () =>
{
  for (const url of [
    'https://www.amazon.com/gp/video/detail/B0B8TR4ZLD/ref=atv_dp',
    'https://www.amazon.com/Clarksons-Farm/dp/B095RK8QWV',
    'https://www.amazon.co.uk/-/en/gp/video/detail/amzn1.dv.gti.123',
    'https://amazon.de/gp/video/storefront',
    'https://www.primevideo.com/detail/0GQ0LW2Q1X4B3V7Y',
    'https://primevideo.com/',
  ])
  {
    assert.equal(videoTranscriptSource(url), 'prime-video', url);
  }

  for (const url of [
    'https://www.amazon.com.evil.org/gp/video/detail/B0B8TR4ZLD',
    'https://notamazon.com/gp/video/detail/B0B8TR4ZLD',
    'https://amazon.example/gp/video/detail/B0B8TR4ZLD',
    'https://primevideo.com.evil.org/detail/x',
    'https://notprimevideo.com/detail/x',
    'https://www.youtube.com/watch?v=abc',
    'https://developer.mozilla.org/en-US/docs/Web/HTML/Element/track',
    'not a url',
    '',
  ])
  {
    assert.equal(videoTranscriptSource(url), 'page-video', url);
  }
});

function track(code, overrides = {})
{
  return { code, name: code, kind: 'subtitles', showing: false, ...overrides };
}

test('the default track is the one shown, else SDH, else English, else the first', () =>
{
  const shown = track('de-de', { showing: true });
  const sdh = track('fr-fr', { kind: 'sdh' });
  const english = track('en-gb');
  const first = track('da-dk');

  assert.equal(chooseTrack([first, english, sdh, shown]), shown);
  assert.equal(chooseTrack([first, english, sdh]), sdh);
  assert.equal(chooseTrack([first, english]), english);
  assert.equal(chooseTrack([first, track('ru-ru')]), first);
});

test('a language picks tracks by code prefix, case-insensitive, then applies the default order', () =>
{
  const russian = track('ru-ru', { name: 'Русский' });
  const britishSdh = track('en-gb', { kind: 'sdh' });
  const american = track('en-us');
  const tracks = [track('da-dk', { showing: true }), american, russian, britishSdh];

  assert.equal(chooseTrack(tracks, 'ru'), russian);
  assert.equal(chooseTrack(tracks, 'RU-RU'), russian);
  // The shown Danish track is not a candidate for "en"; among English tracks SDH wins.
  assert.equal(chooseTrack(tracks, 'en'), britishSdh);
  assert.equal(chooseTrack(tracks, 'EN-US'), american);
});

test('a language without a matching track is an error listing the available languages', () =>
{
  const tracks = [track('en-gb', { name: 'English [CC]' }), track('ru-ru', { name: 'Русский' })];

  const result = chooseTrack(tracks, 'fr');

  assert.ok('error' in result);
  assert.match(result.error, /"fr"/);
  assert.match(result.error, /en-gb English \[CC\], ru-ru Русский/);
});

test('only https URLs on Prime\'s subtitle CDN pass the subtitle URL check', () =>
{
  assert.equal(isPrimeSubtitleUrl('https://cf-timedtext.aux.pv-cdn.net/1a2b/3c4d/5e6f.ttml2'), true);

  for (const url of [
    'http://cf-timedtext.aux.pv-cdn.net/1a2b/3c4d/5e6f.ttml2',
    'https://pv-cdn.net.evil.com/5e6f.ttml2',
    'https://evil.com/cf-timedtext.aux.pv-cdn.net/5e6f.ttml2',
    'https://evilpv-cdn.net/5e6f.ttml2',
    'https://atv-ps.amazon.com/playback/prs/GetVodPlaybackResources',
    'javascript:alert(1)//.pv-cdn.net',
    'cf-timedtext.aux.pv-cdn.net/5e6f.ttml2',
    'not a url',
    '',
    null,
    42,
    { url: 'https://cf-timedtext.aux.pv-cdn.net/x.ttml2' },
  ])
  {
    assert.equal(isPrimeSubtitleUrl(url), false, JSON.stringify(url));
  }
});
