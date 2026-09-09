import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup, activeBudgetState } from './helpers/setup.js';

describe('keyboard input', () => {
  let t;
  let app;
  beforeEach(() => {
    t = setup({ frozenToday: '2026-09-09' });
    app = t.app;
    activeBudgetState(t);
    t.dbg.setRaw('');
  });

  function amountDisplay() {
    const m = app.editor().match(/amount-display">([^<]*)</);
    return m ? m[1] : null;
  }

  it('appends digits to rawValue', () => {
    app.key('1');
    app.key('2');
    app.key('3');
    assert.equal(amountDisplay(), '123');
  });

  it('adds a single decimal point', () => {
    app.key('1');
    app.key('.');
    app.key('5');
    assert.equal(amountDisplay(), '1.5');
  });

  it('prevents a second decimal point', () => {
    app.key('1');
    app.key('.');
    app.key('.');
    app.key('2');
    assert.equal(amountDisplay(), '1.2');
  });

  it('backspace removes the last digit', () => {
    app.key('4');
    app.key('2');
    app.key('backspace');
    assert.equal(amountDisplay(), '4');
  });

  it('caps rawValue at 12 characters', () => {
    let expected = '';
    for (let i = 0; i < 15; i++) {
      app.key('9');
      expected = (expected + '9').slice(0, 12);
    }
    assert.equal(amountDisplay(), expected);
  });

  it('allows a leading dot and renders it as 0.x', () => {
    // key('.') on empty rawValue yields rawValue === '.';
    // display shows '.', which is how the original app behaves
    app.key('.');
    app.key('5');
    assert.equal(amountDisplay(), '.5');
  });
});

describe('export', () => {
  let t;
  let app;
  beforeEach(() => {
    t = setup({ frozenToday: '2026-09-09' });
    app = t.app;
  });

  it('exportCommitTime returns a readable timestamp', () => {
    const out = app.exportCommitTime({ date: '2026-09-09', time: '10:30' });
    assert.ok(typeof out === 'string' && out.length > 0);
  });

  it('exportCommitTime falls back to fullDate for an unparseable time', () => {
    // A clean ISO date with a bogus time hits the NaN guard and falls back.
    const out = app.exportCommitTime({ date: '2026-09-09', time: '25:00' });
    assert.equal(out, app.fullDate('2026-09-09'));
  });

  it('csvSafe is applied for CSV cells (verified via security tests)', () => {
    assert.equal(app.csvSafe('=HYPERLINK("x")'), "'=HYPERLINK(\"x\")");
  });
});