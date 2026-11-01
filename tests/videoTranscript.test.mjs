import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTranscriptResult,
  formatTranscriptLines,
  parseTimeArg,
  resolveTranscriptRange,
} from '../src/services/pageAgent/videoTranscriptRange.ts';

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
