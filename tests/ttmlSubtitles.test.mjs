import assert from 'node:assert/strict';
import test from 'node:test';

import { parseTtml } from '../src/utils/ttmlSubtitles.ts';

function ttml(body, rootAttributes = '')
{
  return `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:version="2" xml:lang="en" ${rootAttributes}>
  <head><styling><style xml:id="s1"/></styling></head>
  <body><div>${body}</div></body>
</tt>`;
}

function times(cues)
{
  return cues.map((cue) => [cue.start, cue.end]);
}

function assertTimes(actual, expected)
{
  assert.equal(actual.length, expected.length);
  actual.forEach(([start, end], index) =>
  {
    assert.ok(Math.abs(start - expected[index][0]) < 1e-9, `start ${start} != ${expected[index][0]}`);
    assert.ok(Math.abs(end - expected[index][1]) < 1e-9, `end ${end} != ${expected[index][1]}`);
  });
}

test('reads clock times with and without fractions', () =>
{
  const cues = parseTtml(ttml(`
    <p begin="00:00:24.720" end="00:00:27.320">One</p>
    <p begin="01:02:03" end="01:02:05.5">Two</p>`));

  assertTimes(times(cues), [[24.72, 27.32], [3723, 3725.5]]);
});

test('reads frames with the file frame rate, and 30 fps when it sets none', () =>
{
  assertTimes(times(parseTtml(ttml('<p begin="00:00:01:12" end="00:00:02:00">A</p>', 'ttp:frameRate="24"'))), [[1.5, 2]]);
  assertTimes(times(parseTtml(ttml('<p begin="00:00:01:15" end="00:00:02:00">A</p>'))), [[1.5, 2]]);
  assertTimes(times(parseTtml(ttml('<p begin="48f" end="72f">A</p>', 'ttp:frameRate="24"'))), [[2, 3]]);
});

test('reads ticks with the tick rate, falling back to the frame rate, then to one tick a second', () =>
{
  assertTimes(times(parseTtml(ttml('<p begin="10000000t" end="25000000t">A</p>', 'ttp:tickRate="10000000"'))), [[1, 2.5]]);
  assertTimes(times(parseTtml(ttml('<p begin="50t" end="75t">A</p>', 'ttp:frameRate="25"'))), [[2, 3]]);
  assertTimes(times(parseTtml(ttml('<p begin="3t" end="4t">A</p>'))), [[3, 4]]);
});

test('reads offset times in hours, minutes, seconds and milliseconds', () =>
{
  const cues = parseTtml(ttml(`
    <p begin="12.5s" end="90000ms">A</p>
    <p begin="2m" end="0.05h">B</p>`));

  assertTimes(times(cues), [[12.5, 90], [120, 180]]);
});

test('takes the end from dur when end is missing, and the start when both are missing', () =>
{
  const cues = parseTtml(ttml(`
    <p begin="10s" dur="2.5s">A</p>
    <p begin="20s">B</p>`));

  assertTimes(times(cues), [[10, 12.5], [20, 20]]);
});

test('a line break between words becomes a space, so words are not glued', () =>
{
  const cues = parseTtml(ttml(`
    <p begin="1s" end="2s">line one<br/>line two</p>
    <p begin="3s" end="4s">first<br />second<tt:br/>third<br>fourth</p>`));

  assert.deepEqual(cues.map((cue) => cue.text), ['line one line two', 'first second third fourth']);
});

test('keeps the text of nested spans and joins adjacent spans without a space', () =>
{
  const cues = parseTtml(ttml(
    '<p begin="1s" end="2s"><span style="s1">Hel<span tts:fontStyle="italic">lo</span></span>, <span>world</span></p>'));

  assert.equal(cues[0].text, 'Hello, world');
});

test('reads cues whose elements carry a namespace prefix', () =>
{
  const xml = `<?xml version="1.0"?>
<tt:tt xmlns:tt="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:frameRate="25">
  <tt:body><tt:div>
    <tt:p begin="00:00:01:05" end="00:00:02:00">Prefixed<tt:br/>text</tt:p>
  </tt:div></tt:body>
</tt:tt>`;

  const cues = parseTtml(xml);

  assertTimes(times(cues), [[1.2, 2]]);
  assert.equal(cues[0].text, 'Prefixed text');
});

test('decodes entities and character references', () =>
{
  const cues = parseTtml(ttml(
    '<p begin="1s" end="2s">Tom &amp; Jerry &lt;3 &quot;hi&quot; it&apos;s &#233;t&#xE9; &unknown;</p>'));

  assert.equal(cues[0].text, 'Tom & Jerry <3 "hi" it\'s été &unknown;');
});

test('skips empty paragraphs and paragraphs without a usable begin', () =>
{
  const cues = parseTtml(ttml(`
    <p begin="1s" end="2s"></p>
    <p begin="2s" end="3s">   <br/>  </p>
    <p begin="3s" end="4s"/>
    <p end="5s">no begin</p>
    <p begin="later" end="6s">bad begin</p>
    <p begin="7s" end="8s">kept</p>`));

  assert.deepEqual(cues.map((cue) => cue.text), ['kept']);
});

test('returns cues sorted by start', () =>
{
  const cues = parseTtml(ttml(`
    <p begin="00:00:30.000" end="00:00:31.000">third</p>
    <p begin="00:00:10.000" end="00:00:11.000">first</p>
    <p begin="00:00:20.000" end="00:00:21.000">second</p>`));

  assert.deepEqual(cues.map((cue) => cue.text), ['first', 'second', 'third']);
});

test('collapses whitespace and ignores markup comments', () =>
{
  const cues = parseTtml(ttml(`
    <!-- <p begin="0s" end="1s">commented out</p> -->
    <p begin="1s" end="2s">
      spread
        over   lines
    </p>`));

  assert.deepEqual(cues.map((cue) => cue.text), ['spread over lines']);
});
