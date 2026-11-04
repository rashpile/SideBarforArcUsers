import assert from 'node:assert/strict';
import test from 'node:test';

import { CodeDrafts } from '../src/components/pageAgent/codeDrafts.ts';

const TAB = 7;
const applied = (appliedCss, appliedScript, appliedUrl) => ({ appliedCss, appliedScript, appliedUrl });

test('the chat\'s code applied on another site opens for that site, not the tab\'s', () =>
{
  const cases = [
    ['CSS only', applied('a { color: red; }', '', 'https://one.test/page')],
    ['script only', applied('', 'agent.add(document.body, "x");', 'https://one.test/page')],
  ];
  for (const [name, code] of cases)
  {
    const drafts = new CodeDrafts();
    drafts.open(TAB, code, 'https://two.test/other');

    const draft = drafts.draftFor(TAB);
    assert.equal(draft.origin, 'https://one.test', name);
    assert.equal(draft.css, code.appliedCss, name);
    assert.equal(draft.script, code.appliedScript, name);
  }
});

test('the chat\'s code applied on another page of the tab\'s site opens for that site', () =>
{
  const drafts = new CodeDrafts();
  drafts.open(TAB, applied('a {}', 'run();', 'https://one.test/first'), 'https://one.test/second');

  assert.equal(drafts.draftFor(TAB).origin, 'https://one.test');
});

test('with nothing applied the draft opens for the tab\'s site, and not at all without an http(s) page', () =>
{
  const cleared = new CodeDrafts();
  cleared.open(TAB, applied('', '', ''), 'https://two.test/other');
  assert.equal(cleared.draftFor(TAB).origin, 'https://two.test');

  // An empty set recorded on another site carries no code to keep from the tab's site.
  const emptySet = new CodeDrafts();
  emptySet.open(TAB, applied('  ', '', 'https://one.test/page'), 'https://two.test/other');
  assert.equal(emptySet.draftFor(TAB).origin, 'https://two.test');

  const noPage = new CodeDrafts();
  noPage.open(TAB, applied('', '', ''), 'chrome://extensions/');
  assert.equal(noPage.draftFor(TAB), undefined);
});

test('opening again keeps the tab\'s draft and its edits', () =>
{
  const drafts = new CodeDrafts();
  drafts.open(TAB, applied('', '', ''), 'https://two.test/');
  drafts.update(TAB, 'b { color: blue; }', '');
  drafts.open(TAB, applied('a {}', '', 'https://one.test/'), 'https://two.test/');

  const draft = drafts.draftFor(TAB);
  assert.equal(draft.css, 'b { color: blue; }');
  assert.equal(draft.origin, 'https://two.test');
});
