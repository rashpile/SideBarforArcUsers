import assert from 'node:assert/strict';
import test from 'node:test';

import { SearchKeyboard } from '../src/searchPopup/searchKeyboard.ts';
import { keyCodeOf } from '../src/utils/shortcutKey.ts';

const key = (keyName, code, modifiers = {}) => ({
  key: keyName,
  code,
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  ...modifiers,
});

const ALT = { altKey: true };
// The user lets go of Option: the Alt keyup no longer has altKey set
const altReleased = () => key('Alt', 'AltLeft');

const NONE = { kind: 'none' };
const PICK = { kind: 'pick' };
const CLOSE = { kind: 'close' };
// Every modifier let go: the keyup that would pick if the press had left the pick armed
const allReleased = () => key('Meta', 'MetaLeft');

test('letting go of the modifier right after opening keeps the popup open for typing', () =>
{
  const keyboard = new SearchKeyboard('⌥E');

  keyboard.shortcutMove(0);

  assert.deepEqual(keyboard.keyup(altReleased()), NONE);
});

test('a shortcut press picks on the release of its modifier, once', () =>
{
  const keyboard = new SearchKeyboard('⌥E');

  assert.equal(keyboard.shortcutMove(1), 1);
  assert.deepEqual(keyboard.keyup(key('e', 'KeyE', ALT)), NONE);
  assert.deepEqual(keyboard.keyup(altReleased()), PICK);
  assert.deepEqual(keyboard.keyup(key('e', 'KeyE')), NONE);
});

test('a missed release does not turn the next typed letter into a pick', () =>
{
  const keyboard = new SearchKeyboard('⌥E');
  keyboard.shortcutMove(1);

  assert.deepEqual(keyboard.keydown(key('g', 'KeyG')), NONE);
  assert.deepEqual(keyboard.keyup(key('g', 'KeyG')), NONE);
});

test('typing plain letters, digits and Shift+letters neither moves nor picks', () =>
{
  const keyboard = new SearchKeyboard('⌥E');

  for (const event of [key('e', 'KeyE'), key('a', 'KeyA'), key('1', 'Digit1'), key('E', 'KeyE', { shiftKey: true })])
  {
    assert.deepEqual(keyboard.keydown(event), NONE);
    assert.deepEqual(keyboard.keyup(event), NONE);
  }
});

test('arrows, Enter, Esc, Tab and Alt+A map to their actions', () =>
{
  const keyboard = new SearchKeyboard('⌥E');

  assert.deepEqual(keyboard.keydown(key('ArrowDown', 'ArrowDown')), { kind: 'move', steps: 1 });
  assert.deepEqual(keyboard.keydown(key('ArrowUp', 'ArrowUp')), { kind: 'move', steps: -1 });
  assert.deepEqual(keyboard.keydown(key('Enter', 'Enter')), PICK);
  assert.deepEqual(keyboard.keydown(key('Escape', 'Escape')), { kind: 'close' });
  assert.deepEqual(keyboard.keydown(key('Tab', 'Tab')), { kind: 'scope', step: 1 });
  assert.deepEqual(keyboard.keydown(key('Tab', 'Tab', { shiftKey: true })), { kind: 'scope', step: -1 });
  // macOS Option+A types "å"; the code still says KeyA
  assert.deepEqual(keyboard.keydown(key('å', 'KeyA', ALT)), { kind: 'toggleSpaces' });
});

test('Enter while an input method composes text is left to the input', () =>
{
  const keyboard = new SearchKeyboard('⌥E');

  assert.deepEqual(keyboard.keydown(key('Enter', 'Enter', { isComposing: true })), NONE);
});

test('Shift+Enter with text searches the web; Enter picks with or without text', () =>
{
  const keyboard = new SearchKeyboard('⌥E');

  assert.deepEqual(keyboard.keydown(key('Enter', 'Enter', { shiftKey: true }), 'cats'), { kind: 'searchWeb' });
  assert.deepEqual(keyboard.keydown(key('Enter', 'Enter'), 'cats'), PICK);
  assert.deepEqual(keyboard.keydown(key('Enter', 'Enter'), ''), PICK);
});

test('Enter with the shortcut\'s modifiers still held picks the row it moved to, Shift or not', () =>
{
  const keyboard = new SearchKeyboard('Ctrl+Shift+K');

  assert.deepEqual(keyboard.keydown(key('Enter', 'Enter', { shiftKey: true, ctrlKey: true }), 'cats'), PICK);
  assert.deepEqual(keyboard.keydown(key('Enter', 'Enter', { shiftKey: true, metaKey: true }), 'cats'), PICK);
  assert.deepEqual(keyboard.keydown(key('Enter', 'Enter', { shiftKey: true, altKey: true }), 'cats'), PICK);
});

test('Shift+Enter with a blank field or while composing does nothing', () =>
{
  const keyboard = new SearchKeyboard('⌥E');

  assert.deepEqual(keyboard.keydown(key('Enter', 'Enter', { shiftKey: true }), ''), NONE);
  assert.deepEqual(keyboard.keydown(key('Enter', 'Enter', { shiftKey: true }), '   '), NONE);
  assert.deepEqual(keyboard.keydown(key('Enter', 'Enter', { shiftKey: true, isComposing: true }), 'cats'), NONE);
});

test('a shortcut press that reaches the page moves and arms the pick', () =>
{
  const keyboard = new SearchKeyboard('⌥E');

  assert.deepEqual(keyboard.keydown(key('´', 'KeyE', ALT)), { kind: 'move', steps: 1 });
  assert.deepEqual(keyboard.keyup(altReleased()), PICK);
});

test('the shortcut\'s key without its modifier is typed, not a move', () =>
{
  const keyboard = new SearchKeyboard('Ctrl+Shift+K');

  assert.deepEqual(keyboard.keydown(key('K', 'KeyK', { shiftKey: true })), NONE);
  assert.deepEqual(keyboard.keydown(key('K', 'KeyK', { shiftKey: true, ctrlKey: true })), { kind: 'move', steps: 1 });
});

test('a text-editing press on the shortcut\'s key neither moves nor picks', () =>
{
  const keyboard = new SearchKeyboard('Alt+Shift+A');

  // Select All in the search field, then letting go of Ctrl
  assert.deepEqual(keyboard.keydown(key('a', 'KeyA', { ctrlKey: true })), NONE);
  assert.deepEqual(keyboard.keyup(key('Control', 'ControlLeft')), NONE);
  assert.deepEqual(keyboard.keydown(key('a', 'KeyA', { metaKey: true })), NONE);
  assert.deepEqual(keyboard.keyup(key('Meta', 'MetaLeft')), NONE);
});

test('only the shortcut\'s exact modifiers make its key a move', () =>
{
  const shortcuts = [
    ['⌥E', 'KeyE', { altKey: true }],
    ['Alt+E', 'KeyE', { altKey: true }],
    ['⇧⌘K', 'KeyK', { shiftKey: true, metaKey: true }],
    ['Ctrl+Shift+K', 'KeyK', { ctrlKey: true, shiftKey: true }],
    ['MacCtrl+Shift+3', 'Digit3', { ctrlKey: true, shiftKey: true }],
    ['⌃,', 'Comma', { ctrlKey: true }],
    ['Command+Period', 'Period', { metaKey: true }],
    ['⌃.', 'Period', { ctrlKey: true }],
    ['⌃⌥⇧⌘E', 'KeyE', { ctrlKey: true, altKey: true, shiftKey: true, metaKey: true }],
  ];

  for (const [shortcut, code, modifiers] of shortcuts)
  {
    assert.deepEqual(new SearchKeyboard(shortcut).keydown(key('x', code, modifiers)), { kind: 'move', steps: 1 }, shortcut);

    for (const flag of ['metaKey', 'ctrlKey', 'altKey', 'shiftKey'])
    {
      const flipped = { ...modifiers, [flag]: !modifiers[flag] };
      assert.deepEqual(new SearchKeyboard(shortcut).keydown(key('x', code, flipped)), NONE, `${shortcut} with ${flag} flipped`);
    }
  }
});

test('Cmd+. and Ctrl+. close, and letting go of the modifier afterwards does not pick', () =>
{
  const shortcuts = [
    ['⌥E', { altKey: true }],
    ['⌘E', { metaKey: true }],
  ];
  const cancels = [
    ['Cmd+.', { metaKey: true }],
    ['Ctrl+.', { ctrlKey: true }],
  ];

  for (const [shortcut, held] of shortcuts)
  {
    for (const [cancel, modifiers] of cancels)
    {
      const label = `${cancel} with ${shortcut}`;
      const keyboard = new SearchKeyboard(shortcut);
      keyboard.shortcutMove(1);

      // The shortcut's modifier is still held while the cancel key goes down
      assert.deepEqual(keyboard.keydown(key('.', 'Period', { ...held, ...modifiers })), CLOSE, label);
      assert.deepEqual(keyboard.keyup(allReleased()), NONE, label);
    }
  }
});

test('Esc with the modifier held closes, and letting go of the modifier afterwards does not pick', () =>
{
  const presses = [
    ['⌘E', 'Cmd+Esc', { metaKey: true }],
    ['⌥E', 'Option+Esc', { altKey: true }],
    ['⌃E', 'Ctrl+Esc', { ctrlKey: true }],
  ];

  for (const [shortcut, label, held] of presses)
  {
    const keyboard = new SearchKeyboard(shortcut);
    keyboard.shortcutMove(1);

    assert.deepEqual(keyboard.keydown(key('Escape', 'Escape', held)), CLOSE, label);
    assert.deepEqual(keyboard.keyup(allReleased()), NONE, label);
  }
});

test('Period without Cmd or Ctrl neither closes nor moves', () =>
{
  const keyboard = new SearchKeyboard('⌥E');

  assert.deepEqual(keyboard.keydown(key('.', 'Period')), NONE);
  assert.deepEqual(keyboard.keydown(key('>', 'Period', { shiftKey: true })), NONE);
  // macOS Option+. types "≥"
  assert.deepEqual(keyboard.keydown(key('≥', 'Period', ALT)), NONE);
});

test('releasing Shift while Cmd is still held does not pick', () =>
{
  const keyboard = new SearchKeyboard('⇧⌘K');
  keyboard.shortcutMove(1);

  assert.deepEqual(keyboard.keyup(key('Shift', 'ShiftLeft', { metaKey: true })), NONE);
  assert.deepEqual(keyboard.keyup(key('Meta', 'MetaLeft')), PICK);
});

test('keyCodeOf reads the key out of Chrome\'s shortcut text', () =>
{
  assert.equal(keyCodeOf('⌥E'), 'KeyE');
  assert.equal(keyCodeOf('Alt+E'), 'KeyE');
  assert.equal(keyCodeOf('⇧⌘K'), 'KeyK');
  assert.equal(keyCodeOf('MacCtrl+Shift+3'), 'Digit3');
  assert.equal(keyCodeOf('Ctrl+Shift+Comma'), 'Comma');
  assert.equal(keyCodeOf('⌃,'), 'Comma');
  assert.equal(keyCodeOf('Command+Period'), 'Period');
  assert.equal(keyCodeOf('⌃.'), 'Period');
});

test('keyCodeOf gives no code for keys a page can\'t match, nor for no shortcut', () =>
{
  assert.equal(keyCodeOf('⌥Space'), undefined);
  assert.equal(keyCodeOf('Ctrl+Shift+Home'), undefined);
  assert.equal(keyCodeOf('⌥↓'), undefined);
  assert.equal(keyCodeOf(''), undefined);
  assert.equal(keyCodeOf(undefined), undefined);
});

test('no shortcut set: modified letters are not moves', () =>
{
  const keyboard = new SearchKeyboard(undefined);

  assert.deepEqual(keyboard.keydown(key('e', 'KeyE', ALT)), NONE);
});
