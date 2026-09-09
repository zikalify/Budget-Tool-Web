import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup, activeBudgetState } from './helpers/setup.js';

describe('transactions', () => {
  let t;
  let s;
  let app;
  beforeEach(() => {
    t = setup({ frozenToday: '2026-09-09' });
    app = t.app;
    s = activeBudgetState(t);
  });

  function commit(overrides = {}) {
    t.dbg.setEditor({
      editingId: null,
      rawValue: '5',
      editorComment: '',
      editorDate: app.today(),
      editorTime: '10:00',
      ...overrides,
    });
    app.commit();
  }

  describe('accountAdd / accountRemove', () => {
    it('adds today spend to spentFromDailyBudget', () => {
      const item = { id: 'x', type: 'SPENT', value: 2.5, date: app.today() };
      app.accountAdd(item);
      assert.equal(s.spentFromDailyBudget, 2.5);
    });

    it('adds future spend to reduce dailyBudget', () => {
      const before = s.dailyBudget;
      const item = { id: 'x', type: 'SPENT', value: 5, date: app.addDays(app.today(), 3) };
      app.accountAdd(item);
      assert.equal(s.dailyBudget, app.normalize(before - 5 / app.daysLeft()));
    });

    it('removes the same amounts', () => {
      const todayItem = { id: 'x', type: 'SPENT', value: 2.5, date: app.today() };
      const futureItem = { id: 'y', type: 'SPENT', value: 5, date: app.addDays(app.today(), 3) };
      const dailyBeforeAdd = s.dailyBudget;
      app.accountAdd(todayItem);
      app.accountAdd(futureItem);
      app.accountRemove(todayItem);
      app.accountRemove(futureItem);
      assert.equal(s.spentFromDailyBudget, 0);
      assert.equal(s.dailyBudget, dailyBeforeAdd);
    });

    it('accountRemove ignores null/undefined', () => {
      app.accountRemove(null);
      app.accountRemove(undefined);
      assert.equal(s.spentFromDailyBudget, 0);
    });
  });

  describe('commit (add)', () => {
    it('adds a SPENT record with today date and current time', () => {
      commit({ rawValue: '12.5', editorComment: 'groceries' });
      assert.equal(s.transactions.length, 1);
      const tx = s.transactions[0];
      assert.equal(tx.type, 'SPENT');
      assert.equal(tx.value, 12.5);
      assert.equal(tx.date, app.today());
      assert.equal(tx.time, app.nowTime()); // fresh spends use the current clock
      assert.equal(tx.comment, 'groceries');
      assert.ok(tx.id && typeof tx.id === 'string');
    });

    it('updates spentFromDailyBudget for a today spend', () => {
      commit({ rawValue: '3' });
      assert.equal(s.spentFromDailyBudget, 3);
    });

    it('trims comment', () => {
      commit({ rawValue: '1', editorComment: '  lunch  ' });
      assert.equal(s.transactions[0].comment, 'lunch');
    });

    it('does nothing when value is zero (no edit)', () => {
      const before = s.transactions.length;
      t.dbg.setEditor({ editingId: null, rawValue: '0', editorComment: '', editorDate: app.today(), editorTime: '10:00' });
      app.commit();
      assert.equal(s.transactions.length, before);
    });
  });

  describe('commit (edit)', () => {
    it('replaces an existing spend and rebalances daily counters', () => {
      commit({ rawValue: '10', editorComment: 'first' });
      const original = s.transactions[0];
      const sfdbAfterAdd = s.spentFromDailyBudget; // 10
      t.dbg.setEditor({ editingId: original.id, rawValue: '7', editorComment: 'edited', editorDate: app.today(), editorTime: '11:00' });
      app.commit();
      assert.equal(s.transactions.length, 1);
      const edited = s.transactions[0];
      assert.equal(edited.value, 7);
      assert.equal(edited.comment, 'edited');
      // old 10 removed then new 7 added -> today's spend = 7
      assert.equal(s.spentFromDailyBudget, 7);
      assert.notEqual(edited.id, original.id);
      assert.equal(edited.date, app.today());
      assert.equal(edited.time, '11:00');
    });

    it('clamps edit date to today when later', () => {
      commit({ rawValue: '5' });
      const original = s.transactions[0];
      t.dbg.setEditor({ editingId: original.id, rawValue: '6', editorComment: '', editorDate: app.addDays(app.today(), 5), editorTime: '11:00' });
      app.commit();
      assert.equal(s.transactions[0].date, app.today());
    });

    it('deletes the spend when editing with a zero value', () => {
      commit({ rawValue: '5' });
      const original = s.transactions[0];
      t.dbg.setEditor({ editingId: original.id, rawValue: '0', editorComment: '', editorDate: app.today(), editorTime: '11:00' });
      app.commit();
      assert.equal(s.transactions.length, 0);
      assert.equal(s.spentFromDailyBudget, 0);
    });
  });

  describe('remove / undoDelete', () => {
    it('removes a spend and adjusts counters', () => {
      commit({ rawValue: '8', editorComment: 'taxi' });
      const tx = s.transactions[0];
      app.remove(tx.id);
      assert.equal(s.transactions.length, 0);
      assert.equal(s.spentFromDailyBudget, 0);
    });

    it('undoDelete restores the removed spend', () => {
      commit({ rawValue: '8', editorComment: 'taxi' });
      const tx = s.transactions[0];
      app.remove(tx.id);
      app.undoDelete();
      assert.equal(s.transactions.length, 1);
      assert.equal(s.transactions[0].id, tx.id);
      assert.equal(s.transactions[0].value, 8);
      assert.equal(s.spentFromDailyBudget, 8);
    });

    it('remove ignores unknown id', () => {
      commit({ rawValue: '1' });
      const before = s.transactions.length;
      app.remove('does-not-exist');
      assert.equal(s.transactions.length, before);
    });

    it('undoDelete does nothing when nothing was deleted', () => {
      const before = s.transactions.length;
      app.undoDelete();
      assert.equal(s.transactions.length, before);
    });
  });

  describe('beginEdit / resetEditor', () => {
    it('beginEdit loads a spend into the editor', () => {
      commit({ rawValue: '42', editorComment: 'gadget' });
      const tx = s.transactions[0];
      app.beginEdit(tx.id);
      assert.equal(t.dbg.getSheet(), null); // editing exits any open sheet
      const html = app.editor();
      assert.match(html, /editing spend/);
      assert.match(html, /42/);
      assert.match(html, /gadget/);
    });

    it('beginEdit ignores unknown id', () => {
      app.beginEdit('nope');
      const html = app.editor();
      assert.doesNotMatch(html, /editing spend/);
    });

    it('resetEditor clears the editor to add mode', () => {
      commit({ rawValue: '42' });
      const tx = s.transactions[0];
      app.beginEdit(tx.id);
      app.resetEditor();
      const html = app.editor();
      assert.match(html, /enter a spend/);
      assert.doesNotMatch(html, /editing spend/);
    });
  });
});