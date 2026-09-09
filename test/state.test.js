import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup, activeBudgetState } from './helpers/setup.js';
import { createApp } from './helpers/loadApp.js';

describe('state', () => {
  let t;
  beforeEach(() => {
    t = setup({ frozenToday: '2026-09-09' });
  });

  describe('defaultState', () => {
    it('has the expected shape', () => {
      const s = t.app.defaultState();
      assert.deepEqual(Object.keys(s).sort(), [
        'appliedDailyDate', 'budget', 'currency', 'dailyBudget', 'finishDate',
        'finishPeriodActualDate', 'hideOverspendingWarn', 'spentFromDailyBudget',
        'startDate', 'theme', 'transactions',
      ].sort());
      assert.equal(s.budget, 0);
      assert.equal(s.dailyBudget, 0);
      assert.equal(s.spentFromDailyBudget, 0);
      assert.equal(s.appliedDailyDate, null);
      assert.equal(s.currency, 'USD');
      assert.equal(s.theme, 'system');
      assert.deepEqual(s.transactions, []);
      assert.equal(s.startDate, t.app.today());
      assert.equal(s.finishDate, t.app.addDays(t.app.today(), 30));
    });
  });

  describe('loadState', () => {
    it('loads stored JSON overriding defaults', () => {
      const seededApp = createApp({
        frozenToday: '2026-09-09',
        seedStorage: { 'budget-tool-web-state': JSON.stringify({
          budget: 250, currency: 'EUR', finishDate: '2026-10-01',
          transactions: [{ id: 'z', type: 'SPENT', value: 3, date: '2026-09-09', time: '10:00', comment: 'seed' }],
        }) },
      });
      const s = seededApp.__dbg.getState();
      assert.equal(s.budget, 250);
      assert.equal(s.currency, 'EUR');
      assert.equal(s.finishDate, '2026-10-01');
      assert.equal(s.transactions.length, 1);
      assert.equal(s.transactions[0].comment, 'seed');
    });

    it('falls back to defaults on corrupted JSON', () => {
      const seededApp = createApp({
        frozenToday: '2026-09-09',
        seedStorage: { 'budget-tool-web-state': '{ this is not json' },
      });
      const s = seededApp.__dbg.getState();
      assert.equal(s.budget, 0);
      assert.equal(s.currency, 'USD');
      assert.deepEqual(s.transactions, []);
    });

    it('falls back to defaults when storage is empty', () => {
      const { app } = setup({ frozenToday: '2026-09-09' });
      const s = app.__dbg.getState();
      assert.equal(s.budget, 0);
      assert.equal(s.currency, 'USD');
    });
  });

  describe('save + derive', () => {
    it('save persists state and derives spentFromDailyBudget from todaySpent', () => {
      const s = activeBudgetState(t);
      s.transactions = [
        { id: 'a', type: 'INCOME', value: 100, date: '2026-09-09', time: '00:00', comment: '' },
        { id: 'b', type: 'SPENT', value: 7.5, date: '2026-09-09', time: '10:00', comment: 'x' },
      ];
      t.app.save();
      assert.equal(s.spentFromDailyBudget, 7.5);
    });
  });

  describe('reconcileDerivedState', () => {
    it('no-op when nothing changed and still today', () => {
      const s = activeBudgetState(t);
      s.appliedDailyDate = t.app.today();
      t.app.reconcileDerivedState();
      assert.equal(s.appliedDailyDate, t.app.today());
    });

    it('rolls daily budget on a new calendar day', () => {
      const s = activeBudgetState(t);
      s.startDate = '2026-09-01';
      s.finishDate = '2026-09-30';
      s.budget = 100;
      s.appliedDailyDate = '2026-09-08'; // yesterday
      s.transactions = [
        { id: 'i', type: 'INCOME', value: 100, date: '2026-09-01', time: '00:00', comment: '' },
        { id: 'b', type: 'SPENT', value: 10, date: '2026-09-08', time: '10:00', comment: '' },
      ];
      s.dailyBudget = 3.45; // stale
      t.app.reconcileDerivedState();
      assert.equal(s.appliedDailyDate, t.app.today());
      // redistributed: (remaining + todaySpent)/daysLeft
      const remaining = t.app.remainingBudget(); // 100 - 10 = 90
      const daysLeft = t.app.daysLeft(); // 22 days (09-09..09-30 inclusive)
      assert.equal(s.dailyBudget, t.app.normalize(remaining / daysLeft));
      assert.equal(s.spentFromDailyBudget, 0);
    });

    it('updates spentFromDailyBudget to actual today spent', () => {
      const s = activeBudgetState(t);
      s.appliedDailyDate = t.app.today();
      s.transactions = [
        { id: 'i', type: 'INCOME', value: 100, date: '2026-09-09', time: '00:00', comment: '' },
        { id: 'b', type: 'SPENT', value: 12, date: '2026-09-09', time: '10:00', comment: '' },
      ];
      s.spentFromDailyBudget = 3; // stale
      t.app.reconcileDerivedState();
      assert.equal(s.spentFromDailyBudget, 12);
    });
  });

  describe('applyRolloverIfNeeded + redistributeDailyBudget', () => {
    it('redistributeDailyBudget spreads remaining + today spent across days left', () => {
      const s = activeBudgetState(t);
      s.startDate = '2026-09-01';
      s.finishDate = '2026-09-30';
      s.budget = 100;
      s.transactions = [
        { id: 'i', type: 'INCOME', value: 100, date: '2026-09-01', time: '00:00', comment: '' },
        { id: 'b', type: 'SPENT', value: 8, date: '2026-09-09', time: '10:00', comment: '' },
      ];
      s.appliedDailyDate = '2026-09-08';
      const applied = t.app.applyRolloverIfNeeded();
      assert.equal(applied, true);
      // remaining = 92, todaySpent = 8, daysLeft = 22 => (92+8)/22 = 100/22
      assert.equal(s.dailyBudget, t.app.normalize(100 / t.app.daysLeft()));
      assert.equal(s.spentFromDailyBudget, 8);
      assert.equal(s.appliedDailyDate, '2026-09-09');
    });

    it('applyRolloverIfNeeded is a no-op when already applied today', () => {
      const s = activeBudgetState(t);
      s.appliedDailyDate = t.app.today();
      assert.equal(t.app.applyRolloverIfNeeded(), false);
    });

    it('applyRolloverIfNeeded is a no-op without a budget', () => {
      const s = t.setState({ budget: 0 });
      s.appliedDailyDate = '2026-09-08';
      assert.equal(t.app.applyRolloverIfNeeded(), false);
    });
  });
});