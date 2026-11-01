import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { primeSubtitleCapture } from '../src/services/pageAgent/videoPageScripts.ts';

// The Prime wrapper runs inside Prime's player: a bug here breaks playback, so these tests pin that the
// page gets exactly what its own fetch returns.

const PROPERTY = '__testPrimeSubtitles';
const PLAYBACK_URL = 'https://atv-ps.amazon.com/playback/prs/GetVodPlaybackResources?deviceID=x';
const OTHER_URL = 'https://www.amazon.com/api/other';

const PLAYBACK_BODY = {
  playbackUrls: { envelope: 'secret-envelope' },
  sessionization: { sessionHandoff: 'secret-session' },
  forcedNarrativeUrls: [{ languageCode: 'de-de', url: 'https://cf-timedtext.aux.pv-cdn.net/forced.ttml2' }],
  timedTextUrls: {
    result: {
      subtitleUrls: [
        {
          languageCode: 'en-gb',
          displayName: 'English [CC]',
          type: 'Sdh',
          subtype: 'Dialog',
          format: 'TTMLv2',
          trackGroupId: 'group-1',
          url: 'https://cf-timedtext.aux.pv-cdn.net/a/en.ttml2',
        },
        {
          languageCode: 'ru-ru',
          type: 'Subtitle',
          format: 'TTMLv2',
          url: 'https://cf-timedtext.aux.pv-cdn.net/a/ru.ttml2',
        },
        { languageCode: 'fr-fr', displayName: 'Français' },
        null,
      ],
    },
  },
};

const EXPECTED_TRACKS = [
  { code: 'en-gb', name: 'English [CC]', kind: 'sdh', showing: false, url: 'https://cf-timedtext.aux.pv-cdn.net/a/en.ttml2' },
  { code: 'ru-ru', name: 'ru-ru', kind: 'subtitles', showing: false, url: 'https://cf-timedtext.aux.pv-cdn.net/a/ru.ttml2' },
];

afterEach(() =>
{
  delete globalThis.window;
  delete globalThis.document;
});

// A page whose own fetch answers with `respond(url)`; `calls` records each call's this and arguments.
function installPage(respond, videos = [])
{
  const calls = [];
  const pageWindow = {
    fetch(...args)
    {
      calls.push({ self: this, args });
      return respond(args[0]);
    },
  };
  globalThis.window = pageWindow;
  globalThis.document = { title: 'Episode 4', querySelectorAll: () => videos };
  return { pageWindow, calls };
}

function jsonResponse(body)
{
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}

// The capture reads its clone asynchronously, after the page got its response.
async function settle()
{
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

function collectUnhandledRejections()
{
  const reasons = [];
  const listener = reason => reasons.push(reason);
  process.on('unhandledRejection', listener);
  return { reasons, stop: () => process.off('unhandledRejection', listener) };
}

test('the page gets the very promise its own fetch returned, called with its this and arguments', () =>
{
  const pending = Promise.resolve(jsonResponse(PLAYBACK_BODY));
  const { pageWindow, calls } = installPage(() => pending);

  const first = primeSubtitleCapture(PROPERTY);
  assert.equal(first.installedNow, true);
  assert.equal(first.tracks, null);

  const init = { method: 'POST', body: '{}' };
  assert.equal(pageWindow.fetch(PLAYBACK_URL, init), pending);
  assert.equal(pageWindow.fetch(OTHER_URL), pending);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].self, pageWindow);
  assert.equal(calls[0].args[0], PLAYBACK_URL);
  assert.equal(calls[0].args[1], init);
});

test('the page still reads the body after the capture took its clone', async () =>
{
  const { pageWindow } = installPage(() => Promise.resolve(jsonResponse(PLAYBACK_BODY)));
  primeSubtitleCapture(PROPERTY);

  const response = await pageWindow.fetch(PLAYBACK_URL, { method: 'POST' });
  assert.deepEqual(await response.json(), PLAYBACK_BODY);

  const chained = await pageWindow.fetch(PLAYBACK_URL).then(answer => answer.json());
  assert.deepEqual(chained, PLAYBACK_BODY);

  await settle();
  assert.deepEqual(primeSubtitleCapture(PROPERTY).tracks, EXPECTED_TRACKS);
});

test('only the subtitle fields of the playback response are kept, in a property the page does not list', async () =>
{
  const { pageWindow } = installPage(() => Promise.resolve(jsonResponse(PLAYBACK_BODY)));
  primeSubtitleCapture(PROPERTY);

  // The player may pass a Request instead of a string.
  await pageWindow.fetch(new Request(PLAYBACK_URL, { method: 'POST' }));
  await settle();

  const result = primeSubtitleCapture(PROPERTY);
  assert.equal(result.installedNow, false);
  assert.deepEqual(result.tracks, EXPECTED_TRACKS);
  assert.equal(result.title, 'Episode 4');

  const stored = JSON.stringify(pageWindow[PROPERTY]);
  assert.doesNotMatch(stored, /secret|forced|group-1|TTMLv2/);
  assert.equal(Object.keys(pageWindow).includes(PROPERTY), false);

  // The caller gets a copy: changing it leaves the stored list alone.
  result.tracks[0].url = 'https://evil.test/x';
  assert.deepEqual(primeSubtitleCapture(PROPERTY).tracks, EXPECTED_TRACKS);
});

test('a response for another URL is not captured', async () =>
{
  const { pageWindow } = installPage(() => Promise.resolve(jsonResponse(PLAYBACK_BODY)));
  primeSubtitleCapture(PROPERTY);

  await pageWindow.fetch(OTHER_URL);
  await settle();

  assert.equal(primeSubtitleCapture(PROPERTY).tracks, null);
});

test('malformed JSON, a non-Response answer and a rejected fetch are swallowed; the page sees its own rejection', async () =>
{
  const unhandled = collectUnhandledRejections();
  try
  {
    let respond = () => Promise.resolve(new Response('not json'));
    const { pageWindow } = installPage(url => respond(url));
    primeSubtitleCapture(PROPERTY);

    const response = await pageWindow.fetch(PLAYBACK_URL);
    assert.equal(await response.text(), 'not json');

    respond = () => Promise.resolve({ status: 200 });
    assert.deepEqual(await pageWindow.fetch(PLAYBACK_URL), { status: 200 });

    const offline = new TypeError('Failed to fetch');
    respond = () => Promise.reject(offline);
    await assert.rejects(pageWindow.fetch(PLAYBACK_URL), error => error === offline);

    await settle();
    assert.deepEqual(unhandled.reasons, []);
    assert.equal(primeSubtitleCapture(PROPERTY).tracks, null);
  }
  finally
  {
    unhandled.stop();
  }
});

test('a second call does not wrap fetch again', async () =>
{
  const { pageWindow, calls } = installPage(() => Promise.resolve(jsonResponse(PLAYBACK_BODY)));
  primeSubtitleCapture(PROPERTY);
  const wrapped = pageWindow.fetch;

  const again = primeSubtitleCapture(PROPERTY);
  assert.equal(again.installedNow, false);
  assert.equal(pageWindow.fetch, wrapped);

  await pageWindow.fetch(PLAYBACK_URL);
  assert.equal(calls.length, 1);
});

test('the episode is the longest video, and a position of 0 reads as unknown', () =>
{
  const trailer = { duration: 124, currentTime: 60 };
  const episode = { duration: 2924, currentTime: 0 };
  const loading = { duration: Number.NaN, currentTime: 0 };
  installPage(() => Promise.resolve(jsonResponse({})), [trailer, episode, loading]);

  assert.deepEqual(primeSubtitleCapture(PROPERTY).video, { duration: 2924, position: null });

  episode.currentTime = 1500;
  assert.deepEqual(primeSubtitleCapture(PROPERTY).video, { duration: 2924, position: 1500 });
});
