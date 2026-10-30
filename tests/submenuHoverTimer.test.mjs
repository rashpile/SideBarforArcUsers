import assert from 'node:assert/strict';
import test from 'node:test';

import { SUBMENU_CLOSE_DELAY_MS, SUBMENU_OPEN_DELAY_MS, SubmenuHoverTimer } from '../src/utils/submenuHoverTimer.ts';

class FakeClock
{
  constructor()
  {
    this.now = 0;
    this.nextHandle = 1;
    this.scheduled = new Map();
  }

  timers()
  {
    return {
      setTimeout: (callback, ms) =>
      {
        const handle = this.nextHandle++;
        this.scheduled.set(handle, { at: this.now + ms, callback });
        return handle;
      },
      clearTimeout: (handle) => this.scheduled.delete(handle)
    };
  }

  advance(ms)
  {
    this.now += ms;
    for (const [handle, entry] of [...this.scheduled])
    {
      if (entry.at <= this.now)
      {
        this.scheduled.delete(handle);
        entry.callback();
      }
    }
  }
}

function setup()
{
  const clock = new FakeClock();
  const state = { open: false };
  const timer = new SubmenuHoverTimer((open) => { state.open = open; }, clock.timers());
  return { clock, state, timer };
}

test('pointer crossing the trigger on its way to the row below does not open the submenu', () =>
{
  const { clock, state, timer } = setup();

  timer.pointerEnteredTrigger();
  clock.advance(SUBMENU_OPEN_DELAY_MS - 1);
  assert.equal(state.open, false);

  timer.pointerLeft();
  clock.advance(SUBMENU_OPEN_DELAY_MS + SUBMENU_CLOSE_DELAY_MS);
  assert.equal(state.open, false);
});

test('resting on the trigger opens the submenu after the open delay', () =>
{
  const { clock, state, timer } = setup();

  timer.pointerEnteredTrigger();
  clock.advance(SUBMENU_OPEN_DELAY_MS);
  assert.equal(state.open, true);
});

test('clicking the trigger opens the submenu at once and drops a pending open', () =>
{
  const { clock, state, timer } = setup();

  timer.pointerEnteredTrigger();
  timer.openNow();
  assert.equal(state.open, true);
  assert.equal(clock.scheduled.size, 0);
});

test('moving from the trigger into the panel keeps the submenu open', () =>
{
  const { clock, state, timer } = setup();

  timer.openNow();
  timer.pointerLeft();
  clock.advance(SUBMENU_CLOSE_DELAY_MS - 1);
  timer.pointerEnteredPanel();
  clock.advance(SUBMENU_CLOSE_DELAY_MS);
  assert.equal(state.open, true);
});

test('leaving the panel for another row of the parent menu closes the submenu', () =>
{
  const { clock, state, timer } = setup();

  timer.openNow();
  timer.pointerEnteredPanel();
  timer.pointerLeft();
  clock.advance(SUBMENU_CLOSE_DELAY_MS);
  assert.equal(state.open, false);
});

test('cancelPending stops a scheduled open from firing', () =>
{
  const { clock, state, timer } = setup();

  timer.pointerEnteredTrigger();
  timer.cancelPending();
  clock.advance(SUBMENU_OPEN_DELAY_MS);
  assert.equal(state.open, false);
});
