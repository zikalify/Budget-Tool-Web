import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup, activeBudgetState } from './helpers/setup.js';

describe('swipe down to dismiss', () => {
  let t;
  let app;
  beforeEach(() => {
    t = setup({ frozenToday: '2026-09-09' });
    app = t.app;
  });

  const begin = (over) => app.__doc._fire('touchstart', Object.assign({
    touches: [{ identifier: 1, clientX: 100, clientY: 100 }],
    target: plainTarget(),
  }, over || {}));

  const move = (over) => app.__doc._fire('touchmove', Object.assign({
    touches: [{ identifier: 1, clientX: 100, clientY: 130 }],
    cancelable: true,
    preventDefault() {},
    target: plainTarget(),
  }, over || {}));

  // A target inside a plain (non-scrolling) sheet layer.
  function plainTarget() {
    const layer = { querySelector() { return null; } };
    return {
      nodeType: 1,
      parentElement: null,
      closest(sel) { return sel === '.sheet-layer' ? layer : null; },
    };
  }

  // A target inside a sheet whose own scrollable content is at/off the top.
  function scrolledTarget(scrollTop) {
    const layer = { querySelector() { return null; } };
    const scrollable = { nodeType: 1, scrollHeight: 500, clientHeight: 200, scrollTop, parentElement: null };
    return {
      nodeType: 1,
      parentElement: scrollable,
      closest(sel) { return sel === '.sheet-layer' ? layer : null; },
    };
  }

  it('a downward swipe on the pane dismisses it', () => {
    activeBudgetState(t);
    t.dbg.setSheet('settings');
    app.render();
    begin({ target: plainTarget() });
    move({ target: plainTarget() });
    assert.equal(t.dbg.getSheet(), null);
  });

  it('a short downward drag below the swipe distance does nothing', () => {
    activeBudgetState(t);
    t.dbg.setSheet('settings');
    app.render();
    begin({ target: plainTarget() });
    move({ target: plainTarget(), touches: [{ identifier: 1, clientX: 100, clientY: 110 }] });
    assert.equal(t.dbg.getSheet(), 'settings');
  });

  it('an upward swipe scrolls the pane instead of dismissing', () => {
    activeBudgetState(t);
    t.dbg.setSheet('history');
    app.render();
    begin({ target: plainTarget() });
    move({ target: plainTarget(), touches: [{ identifier: 1, clientX: 100, clientY: 60 }] });
    assert.equal(t.dbg.getSheet(), 'history');
  });

  it('a downward swipe leaves a pane that is scrolled down alone', () => {
    activeBudgetState(t);
    t.dbg.setSheet('history');
    app.render();
    const target = scrolledTarget(20);
    begin({ target });
    move({ target });
    assert.equal(t.dbg.getSheet(), 'history');
    const atTop = scrolledTarget(0);
    begin({ target: atTop });
    move({ target: atTop });
    assert.equal(t.dbg.getSheet(), null);
  });

  it('cancels the native overscroll when dismissing', () => {
    activeBudgetState(t);
    t.dbg.setSheet('settings');
    app.render();
    let cancelled = false;
    begin({ target: plainTarget() });
    move({
      target: plainTarget(),
      cancelable: true,
      preventDefault() { cancelled = true; },
    });
    assert.ok(cancelled);
  });

  it('never dismisses onboarding while a budget is missing', () => {
    t.setState({ budget: 0, startDate: app.today(), finishDate: app.addDays(app.today(), 9), currency: 'USD', transactions: [] });
    app.render();
    assert.equal(t.dbg.getSheet(), 'onboarding');
    begin({ target: plainTarget() });
    move({ target: plainTarget() });
    assert.equal(t.dbg.getSheet(), 'onboarding');
  });
});