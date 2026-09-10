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

  // A tap target inside a sheet layer, optionally exposing a real sheet element
  // that records styles for the finger-following assertions.
  function paneTarget() {
    const sheetEl = { classList: { add() {}, remove() {} }, style: {} };
    const layer = {
      classList: { add() {}, remove() {} },
      style: { removeProperty() {} },
      querySelector() { return sheetEl; },
    };
    const target = {
      nodeType: 1,
      parentElement: null,
      closest(sel) { return sel === '.sheet-layer' ? layer : null; },
    };
    return { layer, sheetEl, target };
  }

  // A tap target inside a sheet whose own scrollable content is at/off the top.
  function scrolledTarget(scrollTop) {
    const layer = {
      classList: { add() {}, remove() {} },
      style: { removeProperty() {} },
      querySelector() { return null; },
    };
    const scrollable = { nodeType: 1, scrollHeight: 500, clientHeight: 200, scrollTop, parentElement: null };
    return {
      nodeType: 1,
      parentElement: scrollable,
      closest(sel) { return sel === '.sheet-layer' ? layer : null; },
    };
  }

  const begin = (over) => app.__doc._fire('touchstart', Object.assign({
    touches: [{ identifier: 1, clientX: 100, clientY: 100 }],
    target: null,
  }, over || {}));

  const move = (over) => app.__doc._fire('touchmove', Object.assign({
    touches: [{ identifier: 1, clientX: 100, clientY: 130 }],
    cancelable: true,
    preventDefault() {},
    target: null,
  }, over || {}));

  const finish = (over) => app.__doc._fire('touchend', Object.assign({
    changedTouches: [{ identifier: 1, clientX: 100, clientY: 130 }],
    target: null,
  }, over || {}));

  it('a downward swipe on the pane dismisses it', () => {
    activeBudgetState(t);
    t.dbg.setSheet('settings');
    app.render();
    const { target } = paneTarget();
    begin({ target });
    move({ target });
    finish({ changedTouches: [{ identifier: 1, clientX: 100, clientY: 130 }] });
    assert.equal(t.dbg.getSheet(), null);
  });

  it('the pane sticks to the finger as it is pulled down', () => {
    activeBudgetState(t);
    t.dbg.setSheet('history');
    app.render();
    const { target, sheetEl } = paneTarget();
    begin({ target });
    move({ target, touches: [{ identifier: 1, clientX: 100, clientY: 130 }] });
    assert.equal(sheetEl.style.transform, 'translateY(30px)');
    move({ target, touches: [{ identifier: 1, clientX: 100, clientY: 160 }] });
    assert.equal(sheetEl.style.transform, 'translateY(60px)');
    finish({ changedTouches: [{ identifier: 1, clientX: 100, clientY: 160 }] });
    assert.equal(t.dbg.getSheet(), null);
  });

  it('a gentle short drag springs back instead of dismissing', () => {
    activeBudgetState(t);
    t.dbg.setSheet('settings');
    app.render();
    const { target } = paneTarget();
    begin({ target });
    move({ target, touches: [{ identifier: 1, clientX: 100, clientY: 110 }] });
    finish({ changedTouches: [{ identifier: 1, clientX: 100, clientY: 110 }] });
    assert.equal(t.dbg.getSheet(), 'settings');
  });

  it('an upward swipe scrolls the pane instead of dismissing', () => {
    activeBudgetState(t);
    t.dbg.setSheet('history');
    app.render();
    const { target } = paneTarget();
    begin({ target });
    move({ target, touches: [{ identifier: 1, clientX: 100, clientY: 60 }] });
    finish({ changedTouches: [{ identifier: 1, clientX: 100, clientY: 60 }] });
    assert.equal(t.dbg.getSheet(), 'history');
  });

  it('a downward swipe leaves a pane that is scrolled down alone', () => {
    activeBudgetState(t);
    t.dbg.setSheet('history');
    app.render();
    const scrolled = scrolledTarget(20);
    begin({ target: scrolled });
    move({ target: scrolled });
    finish({ changedTouches: [{ identifier: 1, clientX: 100, clientY: 130 }] });
    assert.equal(t.dbg.getSheet(), 'history');
    const atTop = scrolledTarget(0);
    begin({ target: atTop });
    move({ target: atTop });
    finish({ changedTouches: [{ identifier: 1, clientX: 100, clientY: 130 }] });
    assert.equal(t.dbg.getSheet(), null);
  });

  it('cancels the native overscroll when dragging the pane down', () => {
    activeBudgetState(t);
    t.dbg.setSheet('settings');
    app.render();
    let cancelled = false;
    const { target } = paneTarget();
    begin({ target });
    move({
      target,
      cancelable: true,
      preventDefault() { cancelled = true; },
    });
    assert.ok(cancelled);
  });

  it('never dismisses onboarding while a budget is missing', () => {
    t.setState({ budget: 0, startDate: app.today(), finishDate: app.addDays(app.today(), 9), currency: 'USD', transactions: [] });
    app.render();
    assert.equal(t.dbg.getSheet(), 'onboarding');
    const { target } = paneTarget();
    begin({ target });
    move({ target });
    finish({ changedTouches: [{ identifier: 1, clientX: 100, clientY: 130 }] });
    assert.equal(t.dbg.getSheet(), 'onboarding');
  });
});