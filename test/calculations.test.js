import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup, activeBudgetState } from './helpers/setup.js';

describe('calculations', () => {
  let t;
  beforeEach(() => { t = setup({ frozenToday: '2026-09-09' }); });

  describe('dates', () => {
    it('dateKey formats ISO yyyy-mm-dd from a Date', () => {
      assert.equal(t.app.dateKey(new Date(2026, 8, 9)), '2026-09-09');
      assert.equal(t.app.dateKey(new Date(2026, 0, 5)), '2026-01-05');
      assert.equal(t.app.dateKey('2026-12-31'), '2026-12-31');
    });

    it('today reflects the injected clock', () => {
      assert.equal(t.app.today(), '2026-09-09');
    });

    it('nowTime reflects the injected clock', () => {
      assert.equal(t.app.nowTime(), '08:30');
    });

    it('daysBetween includes both endpoints and is minimum 1', () => {
      assert.equal(t.app.daysBetween('2026-09-01', '2026-09-30'), 30);
      assert.equal(t.app.daysBetween('2026-09-09', '2026-09-09'), 1);
      assert.equal(t.app.daysBetween('2026-09-09', '2026-09-08'), 1); // negative clamped
    });

    it('addDays moves dates across month boundaries', () => {
      assert.equal(t.app.addDays('2026-09-09', 1), '2026-09-10');
      assert.equal(t.app.addDays('2026-09-09', -1), '2026-09-08');
      assert.equal(t.app.addDays('2026-09-30', 1), '2026-10-01');
      assert.equal(t.app.addDays('2026-12-31', 1), '2027-01-01');
    });

    it('dateValue + dateLabel/fullDate produce strings', () => {
      assert.ok(typeof t.app.dateLabel('2026-09-09') === 'string' && t.app.dateLabel('2026-09-09').length > 0);
      assert.ok(t.app.fullDate('2026-09-09').includes('2026'));
    });
  });

  describe('normalize', () => {
    it('rounds to two decimals', () => {
      assert.equal(t.app.normalize('12.345'), 12.35);
      assert.equal(t.app.normalize('12.344'), 12.34);
      assert.equal(t.app.normalize('10'), 10);
      assert.equal(t.app.normalize('10.5'), 10.5);
    });

    it('returns 0 for non-numeric input', () => {
      assert.equal(t.app.normalize('abc'), 0);
      assert.equal(t.app.normalize(''), 0);
      assert.equal(t.app.normalize(null), 0);
      assert.equal(t.app.normalize(undefined), 0);
      assert.equal(t.app.normalize(NaN), 0);
    });
  });

  describe('money', () => {
    it('formats with the state currency', () => {
      t.setState({ currency: 'USD' });
      assert.equal(t.app.money(10.5), '$10.50');
    });

    it('supports NONE (plain 2-decimal number)', () => {
      assert.equal(t.app.money(10.5, 'NONE'), '10.50');
    });

    it('handles zero and non-numeric', () => {
      assert.ok(t.app.money(0, 'NONE') === '0.00');
      assert.ok(t.app.money(null, 'NONE') === '0.00');
      assert.ok(t.app.money('bad', 'NONE') === '0.00');
    });
  });

  describe('ledger aggregates', () => {
    beforeEach(() => {
      activeBudgetState(t);
      const s = t.app.__dbg.getState();
      s.transactions = [
        { id: 'a', type: 'INCOME', value: 100, date: '2026-09-09', time: '00:00', comment: '' },
        { id: 'b', type: 'SPENT', value: 10, date: '2026-09-09', time: '10:00', comment: 'coffee' },
        { id: 'c', type: 'SPENT', value: 20, date: '2026-09-08', time: '09:00', comment: 'rent' },
        { id: 'd', type: 'SPENT', value: 5, date: '2026-09-09', time: '11:00', comment: '' },
      ];
    });

    it('spends filters only SPENT records', () => {
      const s = t.app.spends();
      assert.equal(s.length, 3);
      assert.ok(s.every(item => item.type === 'SPENT'));
    });

    it('income sums INCOME records', () => {
      assert.equal(t.app.income(), 100);
    });

    it('totalSpent sums all spends', () => {
      assert.equal(t.app.totalSpent(), 35);
    });

    it('todaySpent only counts today', () => {
      assert.equal(t.app.todaySpent(), 15); // 10 + 5
    });

    it('remainingBudget = budget - total spent, clamped to [0, budget]', () => {
      assert.equal(t.app.remainingBudget(), 65);
      // Overspend clamps to 0
      const s = t.app.__dbg.getState();
      s.transactions.push({ id: 'e', type: 'SPENT', value: 100, date: '2026-09-09', time: '12:00', comment: '' });
      assert.equal(t.app.remainingBudget(), 0);
    });
  });

  describe('pillDisplay and daily math', () => {
    it('no budget -> set period, zero value', () => {
      const pill = t.app.pillDisplay();
      assert.equal(pill.status, 'set period');
      assert.equal(pill.value, t.app.money(0));
      assert.equal(pill.isOverdraft, false);
    });

    it('within budget, not overspent -> left today', () => {
      const s = activeBudgetState(t);
      s.dailyBudget = 10;
      s.spentFromDailyBudget = 4;
      const pill = t.app.pillDisplay();
      assert.equal(pill.status, 'left today');
      assert.equal(pill.isOverdraft, false);
      assert.equal(pill.value, t.app.money(6));
      assert.equal(pill.progress, 60);
    });

    it('overspent today -> new daily budget across remaining days', () => {
      const s = activeBudgetState(t);
      // finish 9 days out -> daysLeft includes today and finish
      s.finishDate = '2026-09-18'; // today..finish = 10 days
      s.budget = 100;
      s.transactions = [
        { id: 'i', type: 'INCOME', value: 100, date: '2026-09-09', time: '00:00', comment: '' },
      ];
      // spent 90 today via ledger
      s.transactions.push({ id: 'b', type: 'SPENT', value: 90, date: '2026-09-09', time: '10:00', comment: '' });
      // spentFromDailyBudget reflects today's spend
      s.spentFromDailyBudget = 90;
      s.appliedDailyDate = '2026-09-09';
      const pill = t.app.pillDisplay();
      assert.equal(pill.status, 'new daily');
      assert.equal(pill.isOverdraft, true);
    });

    it('restToday subtracts uncommitted rawValue', () => {
      const s = activeBudgetState(t);
      s.dailyBudget = 10;
      s.spentFromDailyBudget = 4;
      t.dbg.setRaw(2.5);
      assert.equal(t.app.restToday(), 3.5);
      t.dbg.setRaw(null);
      assert.equal(t.app.restToday(), 6);
    });

    it('newDailyBudget spreads remaining including pending spend', () => {
      const s = activeBudgetState(t);
      s.budget = 100;
      s.finishDate = '2026-09-18'; // 10 days total (today included)
      s.transactions = [
        { id: 'i', type: 'INCOME', value: 100, date: '2026-09-09', time: '00:00', comment: '' },
        { id: 'b', type: 'SPENT', value: 90, date: '2026-09-09', time: '10:00', comment: '' },
      ];
      s.spentFromDailyBudget = 90;
      // remaining = 10; pending = 0 => spread across daysLeft-1 = 9 days
      t.dbg.setRaw(0);
      assert.ok(t.app.newDailyBudget() > 0);
    });
  });
});
