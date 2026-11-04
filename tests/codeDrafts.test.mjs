import assert from 'node:assert/strict';
import test from 'node:test';

import { CodeDrafts } from '../src/components/pageAgent/codeDrafts.ts';
import { SavedPageStyle } from '../src/stores/savedPageStyles.ts';

const TAB = 7;
const applied = (appliedCss, appliedScript, appliedUrl) => ({ appliedCss, appliedScript, appliedUrl });
const NOTHING_APPLIED = applied('', '', '');
const saved = (css, script, origin) => new SavedPageStyle(css, true, origin, 'rev-1', script);

test('the chat\'s code applied on another site opens for that site, not the tab\'s', () =>
{
  const cases = [
    ['CSS only', applied('a { color: red; }', '', 'https://one.test/page')],
    ['script only', applied('', 'agent.add(document.body, "x");', 'https://one.test/page')],
  ];
  for (const [name, code] of cases)
  {
    const drafts = new CodeDrafts();
    drafts.open(TAB, code, null, 'https://two.test/other');

    const draft = drafts.draftFor(TAB);
    assert.equal(draft.origin, 'https://one.test', name);
    assert.equal(draft.css, code.appliedCss, name);
    assert.equal(draft.script, code.appliedScript, name);
  }
});

test('the chat\'s code applied on another page of the tab\'s site opens for that site', () =>
{
  const drafts = new CodeDrafts();
  drafts.open(TAB, applied('a {}', 'run();', 'https://one.test/first'), null, 'https://one.test/second');

  assert.equal(drafts.draftFor(TAB).origin, 'https://one.test');
});

test('with nothing applied the bookmark\'s saved style opens, bound to the site it was saved on', () =>
{
  const blankSets = [['nothing applied', NOTHING_APPLIED], ['a blank set', applied('  ', '\n', 'https://three.test/')]];
  const styles = [
    ['CSS and script', saved('a { color: red; }', 'run();', 'https://www.youtube.com')],
    ['CSS only', saved('a { color: red; }', '', 'https://www.youtube.com')],
    ['script only', saved('', 'run();', 'https://www.youtube.com')],
  ];
  const tabs = [['on the saved site', 'https://www.youtube.com/watch?v=1'], ['on another site', 'https://two.test/']];
  for (const [setName, set] of blankSets)
  {
    for (const [styleName, style] of styles)
    {
      for (const [tabName, tabUrl] of tabs)
      {
        const name = `${setName}, ${styleName}, tab ${tabName}`;
        const drafts = new CodeDrafts();
        drafts.open(TAB, set, style, tabUrl);

        const draft = drafts.draftFor(TAB);
        assert.equal(draft.css, style.css, name);
        assert.equal(draft.script, style.script, name);
        assert.equal(draft.origin, 'https://www.youtube.com', name);
      }
    }
  }
});

test('the chat\'s applied code wins over the bookmark\'s saved style', () =>
{
  const style = saved('saved { color: red; }', 'saved();', 'https://www.youtube.com');
  const cases = [
    ['CSS only', applied('chat { color: blue; }', '', 'https://one.test/page')],
    ['script only', applied('', 'chat();', 'https://one.test/page')],
  ];
  for (const [name, code] of cases)
  {
    const drafts = new CodeDrafts();
    drafts.open(TAB, code, style, 'https://www.youtube.com/watch?v=1');

    const draft = drafts.draftFor(TAB);
    assert.equal(draft.css, code.appliedCss, name);
    assert.equal(draft.script, code.appliedScript, name);
    assert.equal(draft.origin, 'https://one.test', name);
  }
});

test('without applied code or a saved style the draft is empty and for the tab\'s site', () =>
{
  const cases = [
    ['no saved style', NOTHING_APPLIED, null],
    // An empty set recorded on another site carries no code to keep from the tab's site.
    ['a blank set from another site', applied('  ', '', 'https://one.test/page'), null],
    ['a blank saved style from another site', NOTHING_APPLIED, saved('', '', 'https://one.test')],
  ];
  for (const [name, set, style] of cases)
  {
    const drafts = new CodeDrafts();
    drafts.open(TAB, set, style, 'https://two.test/other');

    const draft = drafts.draftFor(TAB);
    assert.equal(draft.css, '', name);
    assert.equal(draft.script, '', name);
    assert.equal(draft.origin, 'https://two.test', name);
  }

  const noPage = new CodeDrafts();
  noPage.open(TAB, NOTHING_APPLIED, null, 'chrome://extensions/');
  assert.equal(noPage.draftFor(TAB), undefined);
});

test('opening again keeps the tab\'s draft and its edits', () =>
{
  const drafts = new CodeDrafts();
  drafts.open(TAB, NOTHING_APPLIED, null, 'https://two.test/');
  drafts.update(TAB, 'b { color: blue; }', '');
  drafts.open(TAB, applied('a {}', '', 'https://one.test/'), saved('c {}', '', 'https://one.test'), 'https://two.test/');

  const draft = drafts.draftFor(TAB);
  assert.equal(draft.css, 'b { color: blue; }');
  assert.equal(draft.origin, 'https://two.test');
});
