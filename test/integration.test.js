import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup, activeBudgetState } from './helpers/setup.js';
import { createApp } from './helpers/loadApp.js';

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

describe('remove after day rollover restores dailyBudget', () => {
  let t;
  let app;
  let s;
  beforeEach(() => {
    t = setup({ frozenToday: '2026-09-09' });
    app = t.app;
    s = activeBudgetState(t);
  });

  it('deleting a today spend the next day corrects dailyBudget via render', () => {
    // Day 1: add a spend
    const t1 = setup({ frozenToday: '2026-09-09' });
    const s1 = activeBudgetState(t1);
    t1.dbg.setEditor({ editingId: null, rawValue: '50', editorComment: 'food', editorDate: t1.app.today(), editorTime: '10:00' });
    t1.app.commit();
    assert.equal(s1.spentFromDailyBudget, 50);
    assert.equal(s1.dailyBudget, 10);

    // Day 2: create a fresh app pinned to the next day, load the same state
    const t2 = setup({ frozenToday: '2026-09-10' });
    const s2 = t2.app.__dbg.getState();
    Object.assign(s2, JSON.parse(JSON.stringify(s1)));
    s2.appliedDailyDate = '2026-09-09'; // stale — forces rollover on render

    // Remove the Day 1 spend. remove() now calls render(), which fires
    // applyRolloverIfNeeded → redistributeDailyBudget, recalculating dailyBudget
    // authoritatively instead of relying on the asymmetric accountRemove increment.
    const spendId = s2.transactions.find(t => t.type === 'SPENT').id;
    t2.app.remove(spendId);

    // redistributeDailyBudget: (remainingBudget + todaySpent) / daysLeft
    // = (100 + 0) / daysBetween(Sep 10, Sep 18) = 100/9
    const expectedDaily = t2.app.normalize(100 / t2.app.daysBetween('2026-09-10', '2026-09-18'));
    assert.equal(s2.dailyBudget, expectedDaily);
    assert.equal(s2.spentFromDailyBudget, 0);
    assert.equal(s2.transactions.filter(t => t.type === 'SPENT').length, 0);
  });

  it('deleting all same-day spends returns pill to daily budget', () => {
    // Add 4 spends today, delete all, pill should show the full dailyBudget
    t.dbg.setEditor({ editingId: null, rawValue: '5', editorComment: '', editorDate: app.today(), editorTime: '10:00' });
    app.commit();
    t.dbg.setEditor({ editingId: null, rawValue: '3', editorComment: '', editorDate: app.today(), editorTime: '10:00' });
    app.commit();
    t.dbg.setEditor({ editingId: null, rawValue: '2', editorComment: '', editorDate: app.today(), editorTime: '10:00' });
    app.commit();
    t.dbg.setEditor({ editingId: null, rawValue: '8', editorComment: '', editorDate: app.today(), editorTime: '10:00' });
    app.commit();
    assert.equal(s.spentFromDailyBudget, 18);

    const ids = s.transactions.filter(t => t.type === 'SPENT').map(t => t.id);
    for (const id of ids) app.remove(id);

    assert.equal(s.dailyBudget, 10);
    assert.equal(s.spentFromDailyBudget, 0);
    const pill = app.pillDisplay();
    assert.equal(pill.isOverdraft, false);
    assert.equal(pill.value, app.money(10));
  });

  it('deleting a past-date spend the next day uses authoritative redistribution', () => {
    // Day 1: manually add a past-date spend (simulating an off-day entry)
    const pastDate = '2026-09-08';
    const pastItem = { id: 'past1', type: 'SPENT', value: 6, date: pastDate, time: '14:00', comment: 'yesterday' };
    s.transactions.push(pastItem);
    app.accountAdd(pastItem);
    const dailyBudgetAfterAdd = s.dailyBudget; // 10 - 6/daysLeft

    // Day 2: create fresh app, load state, delete the past spend
    const t2 = setup({ frozenToday: '2026-09-10' });
    const s2 = t2.app.__dbg.getState();
    Object.assign(s2, JSON.parse(JSON.stringify(s)));
    s2.appliedDailyDate = '2026-09-09';

    t2.app.remove('past1');

    // After render → redistributeDailyBudget, dailyBudget = (100 + 0) / 9
    const expectedDaily = t2.app.normalize(100 / t2.app.daysBetween('2026-09-10', '2026-09-18'));
    assert.equal(s2.dailyBudget, expectedDaily);
    assert.equal(s2.spentFromDailyBudget, 0);
  });
});

describe('exact user scenario: 5192 PHP, Sep 7–Oct 10', () => {
  it('clean scenario gives correct 102.47 on Sep 10 after adding 130', () => {
    const t = setup({ frozenToday: '2026-09-10' });
    const app = t.app;
    const s = activeBudgetState(t);

    s.budget = 5192;
    s.startDate = '2026-09-07';
    s.finishDate = '2026-10-10';
    s.transactions = [
      { id: 'income', type: 'INCOME', value: 5192, date: '2026-09-07', time: '00:00', comment: '' },
      { id: 's1', type: 'SPENT', value: 1464, date: '2026-09-07', time: '10:00', comment: '' },
      { id: 's2', type: 'SPENT', value: 199, date: '2026-09-08', time: '10:00', comment: '' },
      { id: 's3', type: 'SPENT', value: 325, date: '2026-09-09', time: '10:00', comment: '' },
      { id: 's4', type: 'SPENT', value: 130, date: '2026-09-10', time: '10:00', comment: '' },
    ];
    s.appliedDailyDate = '2026-09-09';

    assert.equal(app.totalSpent(), 2118);

    app.redistributeDailyBudget();

    // remainingBudget = 5192 - 2118 = 3074, todaySpent = 130, daysLeft = 31
    // dailyBudget = (3074 + 130) / 31 = 103.35
    assert.equal(s.dailyBudget, app.normalize(3204 / 31));
    assert.equal(s.spentFromDailyBudget, 130);

    const pill = app.pillDisplay();
    assert.equal(pill.isOverdraft, true);
    // overdraft: newDailyBudget = 3074 / 30 = 102.47
    assert.equal(pill.value, app.money(app.normalize(3074 / 30)));
  });

  it('old spends from a prior period reduce dailyBudget (the 82.11 bug)', () => {
    const t = setup({ frozenToday: '2026-09-10' });
    const app = t.app;
    const s = activeBudgetState(t);

    s.budget = 5192;
    s.startDate = '2026-09-07';
    s.finishDate = '2026-10-10';
    s.transactions = [
      { id: 'income', type: 'INCOME', value: 5192, date: '2026-09-07', time: '00:00', comment: '' },
      { id: 'old1', type: 'SPENT', value: 300, date: '2026-09-01', time: '10:00', comment: 'stale' },
      { id: 'old2', type: 'SPENT', value: 358, date: '2026-09-03', time: '10:00', comment: 'stale' },
      { id: 's1', type: 'SPENT', value: 1464, date: '2026-09-07', time: '10:00', comment: '' },
      { id: 's2', type: 'SPENT', value: 199, date: '2026-09-08', time: '10:00', comment: '' },
      { id: 's3', type: 'SPENT', value: 325, date: '2026-09-09', time: '10:00', comment: '' },
      { id: 's4', type: 'SPENT', value: 130, date: '2026-09-10', time: '10:00', comment: '' },
    ];
    s.appliedDailyDate = '2026-09-09';

    // Old spends inflate totalSpent: 658 + 2118 = 2776
    assert.equal(app.totalSpent(), 2776);

    app.redistributeDailyBudget();

    // remainingBudget = 5192 - 2776 = 2416, todaySpent = 130, daysLeft = 31
    // dailyBudget = (2416 + 130) / 31 = 2546 / 31 = 82.13
    const expectedBad = app.normalize(2546 / 31);
    assert.equal(s.dailyBudget, expectedBad);
    assert.notEqual(s.dailyBudget, app.normalize(3204 / 31));

    const pill = app.pillDisplay();
    assert.equal(pill.isOverdraft, true);
    assert.equal(pill.value, app.money(app.normalize(2416 / 30)));
    assert.notEqual(pill.value, app.money(app.normalize(3074 / 30)));
  });

  it('freshSaveWallet edit path clears stale spends when start date moves forward', () => {
    const t = setup({ frozenToday: '2026-09-10' });
    const app = t.app;
    const s = activeBudgetState(t);

    s.budget = 4000;
    s.startDate = '2026-09-01';
    s.finishDate = '2026-09-30';
    s.transactions = [
      { id: 'old-income', type: 'INCOME', value: 4000, date: '2026-09-01', time: '00:00', comment: '' },
      { id: 'old1', type: 'SPENT', value: 300, date: '2026-09-02', time: '10:00', comment: 'old' },
      { id: 'old2', type: 'SPENT', value: 358, date: '2026-09-05', time: '10:00', comment: 'old' },
    ];

    t.dbg.setSheet('wallet');
    t.dbg.setStartingNewPeriod(false);
    const fakeForm = { _fields: { budget: '5192', startDate: '2026-09-07', finishDate: '2026-10-10', currency: 'PHP' } };
    const event = { preventDefault() {}, currentTarget: fakeForm };
    app.freshSaveWallet(event);

    // Old spends before new start date are dropped
    assert.equal(s.transactions.filter(i => i.type === 'SPENT').length, 0);
    assert.equal(app.totalSpent(), 0);

    // dailyBudget is correct: no stale spends inflate it
    // remaining = max(0, 5192 - (0 - 0)) = 5192 (no spends today)
    // days = daysBetween('2026-09-10', '2026-10-10') = 31
    // dailyBudget = 5192 / 31 = 167.48
    const expectedCorrect = app.normalize(5192 / 31);
    assert.equal(s.dailyBudget, expectedCorrect);
  });

  it('freshSaveWallet edit keeps spends when start date unchanged', () => {
    const t = setup({ frozenToday: '2026-09-10' });
    const app = t.app;
    const s = activeBudgetState(t);

    s.budget = 5192;
    s.startDate = '2026-09-07';
    s.finishDate = '2026-10-10';
    s.transactions = [
      { id: 'income', type: 'INCOME', value: 5192, date: '2026-09-07', time: '00:00', comment: '' },
      { id: 's1', type: 'SPENT', value: 1464, date: '2026-09-07', time: '10:00', comment: '' },
      { id: 's2', type: 'SPENT', value: 199, date: '2026-09-08', time: '10:00', comment: '' },
    ];

    t.dbg.setSheet('wallet');
    t.dbg.setStartingNewPeriod(false);
    const fakeForm = { _fields: { budget: '6000', startDate: '2026-09-07', finishDate: '2026-10-15', currency: 'PHP' } };
    const event = { preventDefault() {}, currentTarget: fakeForm };
    app.freshSaveWallet(event);

    // Spends within the period are kept
    assert.equal(s.transactions.filter(i => i.type === 'SPENT').length, 2);
    assert.equal(app.totalSpent(), 1663);

    // dailyBudget is correct: only current spends counted
    // remaining = max(0, 6000 - (1663 - 0)) = 4337
    // days = daysBetween('2026-09-10', '2026-10-15') = 36
    const expected = app.normalize(4337 / 36);
    assert.equal(s.dailyBudget, expected);
  });
});

describe('wallet edit then delete restores dailyBudget', () => {
  let t;
  let app;
  let s;
  beforeEach(() => {
    t = setup({ frozenToday: '2026-09-09' });
    app = t.app;
    s = activeBudgetState(t);
  });

  it('changing finish date then deleting a past spend gives correct dailyBudget', () => {
    // Set up: budget 100, Sep 09–Sep 18 (10 days), daily = 10
    // Add a spend of 30 on Sep 09
    t.dbg.setEditor({ editingId: null, rawValue: '30', editorComment: '', editorDate: app.today(), editorTime: '10:00' });
    app.commit();
    assert.equal(s.spentFromDailyBudget, 30);

    // Simulate freshSaveWallet changing finish to Sep 20 (extend by 2 days)
    // remaining = 100 - (30 - 30) = 100 (spentToday=30 subtracts it out)
    // days = daysBetween(Sep 09, Sep 20) = 12
    // dailyBudget = 100/12 = 8.33
    const newFinish = '2026-09-20';
    const totalSpent = app.totalSpent();
    const spentToday = app.todaySpent();
    const remaining = Math.max(0, 100 - (totalSpent - spentToday));
    const days = Math.max(1, app.daysBetween(app.today(), newFinish));
    s.dailyBudget = app.normalize(remaining / days);
    s.finishDate = newFinish;
    s.appliedDailyDate = app.today();
    app.save();

    assert.equal(s.dailyBudget, app.normalize(100 / 12));

    // Now delete the Sep 09 spend
    const spendId = s.transactions.find(t => t.type === 'SPENT').id;
    app.remove(spendId);

    // After remove: accountRemove adds back 30/daysLeft for Sep 09
    // BUT render fires redistributeDailyBudget which recalculates:
    // dailyBudget = (100 + 0) / daysBetween(Sep 09, Sep 20) = 100/12
    assert.equal(s.dailyBudget, app.normalize(100 / 12));
    assert.equal(s.spentFromDailyBudget, 0);
    assert.equal(s.transactions.filter(t => t.type === 'SPENT').length, 0);
  });
});