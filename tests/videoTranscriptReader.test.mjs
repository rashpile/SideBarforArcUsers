import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchSubtitleFile,
  primeSubtitleCapture,
  readPageVideo,
} from '../src/services/pageAgent/videoPageScripts.ts';
import { parseTimeArg } from '../src/services/pageAgent/videoTranscriptRange.ts';
import { VideoTranscriptReader } from '../src/services/pageAgent/videoTranscriptReader.ts';

const TAB = 7;
const PRIME_URL = 'https://www.amazon.com/gp/video/detail/B0TEST/ref=atv_dp';
const PAGE_URL = 'https://developer.mozilla.org/en-US/docs/Web/HTML/Element/track';
const EN_URL = 'https://cf-timedtext.aux.pv-cdn.net/a/en.ttml2';
const RU_URL = 'https://cf-timedtext.aux.pv-cdn.net/a/ru.ttml2';

const PRIME_TRACKS = [
  { code: 'en-gb', name: 'English [CC]', kind: 'sdh', showing: false, url: EN_URL },
  { code: 'ru-ru', name: 'Русский', kind: 'subtitles', showing: false, url: RU_URL },
];

// Page access that answers each injected function with a handler and records the tab, function and
// world of every call.
class FakeVideoPage
{
  constructor(url, handlers)
  {
    this.url = url;
    this.handlers = handlers;
    this.urlTabs = [];
    this.calls = [];
  }

  async pageUrl(tabId)
  {
    this.urlTabs.push(tabId);
    return this.url;
  }

  async runScript(tabId, func, args, world)
  {
    this.calls.push({ tabId, func, args, world });
    const handler = this.handlers.get(func);
    if (handler === undefined)
    {
      throw new Error(`unexpected page script ${func.name}`);
    }
    return handler(...args);
  }

  callsOf(func)
  {
    return this.calls.filter(call => call.func === func);
  }
}

// A cue every 10 s for ten minutes; each text names its language and start, then a second line.
function ttml(language, until = 600)
{
  const paragraphs = [];
  for (let start = 0; start < until; start += 10)
  {
    paragraphs.push(`<p begin="${start}s" end="${start + 5}s">${language}${String(start).padStart(4, '0')}<br/>line</p>`);
  }
  return '<?xml version="1.0" encoding="UTF-8"?>' +
    `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:version="2" xml:lang="${language}">` +
    `<body><div>${paragraphs.join('')}</div></body></tt>`;
}

function cueStartsIn(text, language)
{
  return [...text.matchAll(new RegExp(`${language}(\\d{4})`, 'g'))].map(match => Number(match[1]));
}

function captured(position, tracks = PRIME_TRACKS)
{
  return { installedNow: false, tracks, video: { duration: 600, position }, title: 'Episode 4' };
}

function primePage(capture)
{
  const files = new Map([[EN_URL, { text: ttml('en') }], [RU_URL, { text: ttml('ru') }]]);
  return new FakeVideoPage(PRIME_URL, new Map([
    [primeSubtitleCapture, () => capture],
    [fetchSubtitleFile, url => files.get(url) ?? { error: 'HTTP 404' }],
  ]));
}

function request({ language, from, to } = {})
{
  return {
    ...(language !== undefined && { language }),
    ...(from !== undefined && { from: parseTimeArg(from, 'from') }),
    ...(to !== undefined && { to: parseTimeArg(to, 'to') }),
  };
}

async function readJson(page, options)
{
  const result = await new VideoTranscriptReader(page).read(TAB, request(options));
  assert.equal(result.ok, true, result.error);
  return JSON.parse(result.content);
}

test('every page call goes to the given tab: the capture in the MAIN world, the subtitle file in the isolated one', async () =>
{
  const page = primePage(captured(300));

  const result = await new VideoTranscriptReader(page).read(TAB, {});

  assert.equal(result.ok, true);
  assert.deepEqual(page.urlTabs, [TAB]);
  assert.deepEqual(
    page.calls.map(call => [call.tabId, call.func, call.world]),
    [[TAB, primeSubtitleCapture, 'MAIN'], [TAB, fetchSubtitleFile, 'ISOLATED']],
  );
  assert.equal(page.calls[1].args[0], EN_URL);
});

test('a capture that went in with this call asks the user to reopen the player and fetches nothing', async () =>
{
  const page = primePage({ installedNow: true, tracks: null, video: null, title: 'Episode 4' });

  const result = await new VideoTranscriptReader(page).read(TAB, {});

  assert.equal(result.ok, true);
  assert.match(result.content, /close the player with ✕ \(top left\) and press Play again/);
  assert.equal(page.callsOf(fetchSubtitleFile).length, 0);

  const waiting = primePage({ installedNow: false, tracks: null, video: null, title: 'Episode 4' });
  const notYet = await new VideoTranscriptReader(waiting).read(TAB, {});
  assert.match(notYet.content, /No subtitle list captured yet/);
  assert.equal(waiting.callsOf(fetchSubtitleFile).length, 0);
});

test('a subtitle URL outside Prime\'s subtitle servers is refused without a fetch', async () =>
{
  for (const url of ['https://evil.example/en.ttml2', 'https://pv-cdn.net.evil.example/en.ttml2', 'http://cf-timedtext.aux.pv-cdn.net/a/en.ttml2'])
  {
    const page = primePage(captured(300, [{ ...PRIME_TRACKS[0], url }]));

    const result = await new VideoTranscriptReader(page).read(TAB, request({ to: 'end' }));

    assert.equal(result.ok, true);
    assert.match(result.content, /outside Prime Video's subtitle servers/, url);
    assert.equal(page.callsOf(fetchSubtitleFile).length, 0, url);
  }
});

test('a captured list is read from the TTML file and stops at the position mid-way', async () =>
{
  const body = await readJson(primePage(captured(300)));

  assert.equal(body.source, 'prime-video');
  assert.equal(body.page_title, 'Episode 4');
  assert.equal(body.language, 'en-gb English [CC]');
  assert.deepEqual(body.languages, ['en-gb English [CC]', 'ru-ru Русский']);
  assert.equal(body.position, '5:00');
  assert.match(body.to, /^5:00 \(current position/);

  const starts = cueStartsIn(body.text, 'en');
  assert.equal(starts[0], 0);
  assert.equal(Math.max(...starts), 290);
  assert.match(body.text, /^\[0:00\] en0000 line en0010 line/);
});

test('a language prefix picks the track whose file is fetched; an unknown language is an error without a fetch', async () =>
{
  const page = primePage(captured(300));
  const body = await readJson(page, { language: 'ru', to: 'end' });

  assert.deepEqual(page.callsOf(fetchSubtitleFile).map(call => call.args[0]), [RU_URL]);
  assert.equal(body.language, 'ru-ru Русский');
  assert.equal(Math.max(...cueStartsIn(body.text, 'ru')), 590);

  const other = primePage(captured(300));
  const missing = await new VideoTranscriptReader(other).read(TAB, request({ language: 'de' }));
  assert.equal(missing.ok, false);
  assert.match(missing.error, /available: en-gb English \[CC\], ru-ru Русский/);
  assert.equal(other.callsOf(fetchSubtitleFile).length, 0);
});

test('Prime with the episode position unknown and no `to` gives no transcript text, only the unknown-position note', async () =>
{
  const body = await readJson(primePage(captured(null)));

  assert.equal(body.position, 'unknown');
  assert.equal('text' in body, false);
  assert.equal('to' in body, false);
  assert.match(body.note, /position is unknown/);
});

test('page-video reads the chosen track\'s cues on a second call with its index, WebVTT markup cleaned', async () =>
{
  const tracks = [
    { index: 0, code: 'de', name: 'Deutsch', kind: 'subtitles', showing: false },
    { index: 2, code: 'en', name: 'English', kind: 'captions', showing: true },
  ];
  const video = { duration: 120, position: 0 };
  const cues = [
    { start: 1, end: 3, text: '<v Bob>Fish &amp; chips</v>' },
    { start: 4, end: 6, text: '<i>Tom&#39;s</i>\n<c.loud>turn</c> &lt;3 <00:00:05.000>now' },
    { start: 7, end: 8, text: '<b> </b>' },
  ];
  const page = new FakeVideoPage(PAGE_URL, new Map([
    [readPageVideo, trackIndex => ({ video, tracks, title: 'Track demo', ...(trackIndex === 2 ? { cues } : trackIndex !== null && { cues: [] }) })],
  ]));

  const body = await readJson(page);

  assert.deepEqual(
    page.calls.map(call => [call.tabId, call.func, call.world, call.args[0]]),
    [[TAB, readPageVideo, 'ISOLATED', null], [TAB, readPageVideo, 'ISOLATED', 2]],
  );
  assert.deepEqual(page.urlTabs, [TAB]);
  assert.equal(body.source, 'page-video');
  assert.equal(body.page_title, 'Track demo');
  assert.equal(body.language, 'en English');
  assert.equal(body.to, 'end');
  assert.equal(body.text, '[0:01] Fish & chips Tom\'s turn <3 now');
});

test('page-video without a video, without subtitle tracks or without loaded cues gives its message', async () =>
{
  const tracks = [{ index: 0, code: 'en', name: 'English', kind: 'subtitles', showing: false }];
  const video = { duration: 120, position: 30 };
  const cases = [
    { answer: () => ({ noVideo: true }), expected: /No video on this page/, calls: 1 },
    { answer: () => ({ video, tracks: [], title: 'Demo' }), expected: /has no subtitle tracks/, calls: 1 },
    {
      answer: trackIndex => ({ video, tracks, title: 'Demo', ...(trackIndex !== null && { cues: [] }) }),
      expected: /didn't load; ask the user to start the video/,
      calls: 2,
    },
  ];

  for (const { answer, expected, calls } of cases)
  {
    const page = new FakeVideoPage(PAGE_URL, new Map([[readPageVideo, answer]]));

    const result = await new VideoTranscriptReader(page).read(TAB, {});

    assert.equal(result.ok, true);
    assert.match(result.content, expected);
    assert.equal(result.summary, result.content);
    assert.equal(page.calls.length, calls);
  }
});
