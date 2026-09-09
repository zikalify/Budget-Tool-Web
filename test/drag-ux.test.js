import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup, activeBudgetState } from './helpers/setup.js';

describe('sheet drag helpers', () => {
  let app;
  beforeEach(() => {
    app = setup({ frozenToday: '2026-09-09' }).app;
  });

  it('openDragProgress maps an upward pull to a 0..1 progress', () => {
    assert.equal(app.openDragProgress(0, 400), 0);
    assert.equal(app.openDragProgress(-100, 400), 0.25);
    assert.equal(app.openDragProgress(-400, 400), 1);
    assert.equal(app.openDragProgress(40, 400), 0); // downward pull gives no progress
  });

  it('openDragProgress clamps and never divides by zero', () => {
    assert.equal(app.openDragProgress(-900, 400), 1);
    assert.equal(app.openDragProgress(-90, 0), 1);
  });

  it('closeDragProgress maps a downward pull to a 0..1 progress', () => {
    assert.equal(app.closeDragProgress(0, 300), 0);
    assert.equal(app.closeDragProgress(150, 300), 0.5);
    assert.equal(app.closeDragProgress(300, 300), 1);
    assert.equal(app.closeDragProgress(-150, 300), 0); // upward pull gives no progress
  });

  it('dragShouldDismiss applies the threshold (default 0.35)', () => {
    assert.equal(app.dragShouldDismiss(0.5), true);
    assert.equal(app.dragShouldDismiss(0.35), true);
    assert.equal(app.dragShouldDismiss(0.34), false);
    assert.equal(app.dragShouldDismiss(0.2, 0.5), false);
    assert.equal(app.dragShouldDismiss(0.6, 0.5), true);
  });
});

describe('sheet close buttons', () => {
  let t;
  let app;
  beforeEach(() => {
    t = setup({ frozenToday: '2026-09-09' });
    app = t.app;
    activeBudgetState(t);
  });

  it('settings sheet uses a leading back-arrow close, not a trailing ×', () => {
    t.dbg.setSheet('settings');
    const html = app.sheetView();
    assert.match(html, /data-action="close" aria-label="Close">/);
    assert.match(html, /m15 18-6-6 6-6/); // back arrow svg lead
    assert.doesNotMatch(html, /data-action="close">×/);
    assert.doesNotMatch(html, /×/);
  });

  it('history sheet uses the same back-arrow close control', () => {
    t.dbg.setSheet('history');
    const html = app.sheetView();
    assert.match(html, /data-action="close" aria-label="Close">/);
    assert.match(html, /history-sheet-title/);
    assert.doesNotMatch(html, /data-action="close">×/);
  });

  it('analytics, theme, and wallet close controls are labeled Close', () => {
    for (const sheetName of ['analytics', 'theme', 'wallet']) {
      t.dbg.setSheet(sheetName);
      const html = app.sheetView();
      assert.match(html, /data-action="close" aria-label="Close">/, `${sheetName} sheet`);
    }
  });

  it('confirmation dialog exposes no dismiss x - only Cancel/Confirm', () => {
    t.dbg.setPendingConfirm({ value: 'new-period' });
    const html = app.confirmDialog();
    assert.doesNotMatch(html, /data-action="close"/);
    assert.match(html, /data-action="cancel-confirm"/);
    assert.match(html, /data-action="confirm-dialog"/);
  });
});

describe('history today marker', () => {
  let t;
  let app;
  beforeEach(() => {
    t = setup({ frozenToday: '2026-09-09' });
    app = t.app;
    const s = activeBudgetState(t);
    s.budget = 100;
    s.finishDate = '2026-09-30';
    s.transactions = [
      { id: 'i', type: 'INCOME', value: 100, date: '2026-09-01', time: '00:00', comment: '' },
      { id: 'a', type: 'SPENT', value: 10, date: '2026-09-09', time: '10:00', comment: 'coffee' },
      { id: 'b', type: 'SPENT', value: 5, date: '2026-09-08', time: '09:00', comment: 'bus' },
    ];
  });

  it('flags only todays date group with a today chip', () => {
    const html = app.history();
    const chips = html.match(/class="today-chip"/g) || [];
    assert.equal(chips.length, 1);
  });

  it('omits the chip when no spend occurred today', () => {
    t.dbg.getState().transactions = [
      { id: 'i', type: 'INCOME', value: 100, date: '2026-09-01', time: '00:00', comment: '' },
      { id: 'b', type: 'SPENT', value: 5, date: '2026-09-08', time: '09:00', comment: 'bus' },
    ];
    const html = app.history();
    assert.doesNotMatch(html, /today-chip/);
  });
});

describe('amount entry feedback', () => {
  let t;
  let app;
  beforeEach(() => {
    t = setup({ frozenToday: '2026-09-09' });
    app = t.app;
    activeBudgetState(t);
    t.resetEditor();
    t.dbg.setRaw('');
  });

  it('digits update the amount display', () => {
    app.key('1');
    app.key('2');
    assert.match(app.editor(), /amount-display">12</);
    app.key('backspace');
    assert.match(app.editor(), /amount-display">1</);
  });

  it('does not duplicate a decimal point', () => {
    app.key('5');
    app.key('.');
    app.key('.');
    assert.match(app.editor(), /amount-display">5\.</);
  });
});