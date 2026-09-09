import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup, activeBudgetState } from './helpers/setup.js';

describe('end-to-end spend flow', () => {
  let t;
  let app;
  let s;
  beforeEach(() => {
    t = setup({ frozenToday: '2026-09-09' });
    app = t.app;
    s = activeBudgetState(t);
  });

  it('enter -> commit -> history -> delete -> undo', () => {
    // Enter 15.5 via the keypad
    t.dbg.setRaw('');
    for (const ch of ['1', '5', '.', '5']) app.key(ch);
    t.dbg.setEditor({
      editingId: null, rawValue: '15.5', editorComment: 'groceries',
      editorDate: app.today(), editorTime: '',
    });
    app.action('commit');

    // Ledger now has one spend
    assert.equal(s.transactions.length, 1);
    assert.equal(s.transactions[0].value, 15.5);
    assert.equal(s.spentFromDailyBudget, 15.5);

    // History shows it
    const h = app.history(false);
    assert.match(h, /groceries/);
    assert.match(h, /15\.50/);

    // Delete it
    const id = s.transactions[0].id;
    app.remove(id);
    assert.equal(s.transactions.length, 0);
    assert.equal(s.spentFromDailyBudget, 0);

    // Undo restores it
    app.undoDelete();
    assert.equal(s.transactions.length, 1);
    assert.equal(s.transactions[0].value, 15.5);
    assert.equal(s.spentFromDailyBudget, 15.5);
  });

  it('edit flow preserves ledger totals', () => {
    t.dbg.setEditor({ editingId: null, rawValue: '10', editorComment: 'a', editorDate: app.today(), editorTime: '' });
    app.commit();
    const first = s.transactions[0];
    s.transactions.push({ id: 'other', type: 'SPENT', value: 4, date: app.addDays(app.today(), 2), time: '10:00', comment: 'future' });
    app.accountAdd({ id: 'other', type: 'SPENT', value: 4, date: app.addDays(app.today(), 2) });

    // Edit "a" from 10 to 6
    t.dbg.setEditor({ editingId: first.id, rawValue: '6', editorComment: 'a2', editorDate: app.today(), editorTime: '' });
    app.commit();

    assert.equal(s.spentFromDailyBudget, 6);
    assert.equal(s.transactions.length, 2);
  });

  it('pill reflects live input before commit', () => {
    t.dbg.setRaw(7.5);
    const pill = app.pillDisplay();
    // restToday = dailyBudget(10) - spent(0) - raw(7.5) = 2.5
    assert.equal(pill.value, app.money(app.normalize(2.5)));
    assert.equal(pill.isOverdraft, false);
  });
});

describe('spentRow', () => {
  let t;
  let app;
  beforeEach(() => {
    t = setup({ frozenToday: '2026-09-09' });
    app = t.app;
  });

  it('renders value, time, and escapeHtml comment', () => {
    const row = app.spentRow(
      { id: 'x', value: 4.5, date: '2026-09-09', time: '10:00', comment: '<b>bad</b>' },
      false,
    );
    assert.match(row, /4\.50/);
    assert.match(row, /10:00/);
    assert.match(row, /&lt;b&gt;bad&lt;\/b&gt;/);
    assert.match(row, /data-edit="x"/);
    assert.match(row, /data-delete="x"/);
  });

  it('readOnly omits action buttons', () => {
    const row = app.spentRow({ id: 'x', value: 1, date: '2026-09-09', time: '', comment: '' }, true);
    assert.doesNotMatch(row, /data-edit=/);
    assert.doesNotMatch(row, /data-delete=/);
  });
});