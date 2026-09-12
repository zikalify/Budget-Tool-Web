import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers/setup.js';

describe('wallet', () => {
  let t;
  let app;
  beforeEach(() => {
    t = setup({ frozenToday: '2026-09-09' });
    app = t.app;
  });

  function form(values) {
    return {
      preventDefault() {},
      currentTarget: { _fields: values },
      get(name) { return values[name]; },
    };
  }

  describe('freshSaveWallet (new period)', () => {
    it('creates an INCOME transaction and sets the period fields', () => {
      const s = t.setState({ budget: 0, transactions: [] });
      app.freshSaveWallet(form({
        budget: '200', startDate: '2026-09-01', finishDate: '2026-09-30', currency: 'EUR',
      }));
      assert.equal(s.budget, 200);
      assert.equal(s.startDate, '2026-09-01');
      assert.equal(s.finishDate, '2026-09-30');
      assert.equal(s.currency, 'EUR');
      assert.equal(s.transactions.length, 1);
      const tx = s.transactions[0];
      assert.equal(tx.type, 'INCOME');
      assert.equal(tx.value, 200);
      assert.equal(tx.date, '2026-09-01');
      assert.equal(tx.time, '00:00');
      assert.equal(s.appliedDailyDate, app.today());
      assert.equal(s.finishPeriodActualDate, null);
      // daily = budget/daysBetween(30 days)
      assert.equal(s.dailyBudget, app.normalize(200 / 30));
    });

    it('resets spentFromDailyBudget to zero for a new period', () => {
      const s = t.setState({ budget: 50, transactions: [], spentFromDailyBudget: 9 });
      t.dbg.setStartingNewPeriod(true);
      app.freshSaveWallet(form({
        budget: '100', startDate: '2026-09-01', finishDate: '2026-09-10', currency: 'USD',
      }));
      assert.equal(s.spentFromDailyBudget, 0);
      assert.equal(s.transactions.length, 1);
    });

    it('rejects a zero/empty budget', () => {
      const s = t.setState({ budget: 0, transactions: [], sheet: 'onboarding' });
      app.freshSaveWallet(form({
        budget: '0', startDate: '2026-09-01', finishDate: '2026-09-30', currency: 'USD',
      }));
      assert.equal(s.budget, 0);
      assert.equal(s.transactions.length, 0);
    });

    it('rejects finish before today and finish before start', () => {
      const s = t.setState({ budget: 0, transactions: [] });
      app.freshSaveWallet(form({
        budget: '100', startDate: '2026-09-01', finishDate: '2026-09-05', currency: 'USD',
      }));
      assert.equal(s.budget, 0);

      const s2 = t.setState({ budget: 0, transactions: [] });
      app.freshSaveWallet(form({
        budget: '100', startDate: '2026-09-10', finishDate: '2026-09-05', currency: 'USD',
      }));
      assert.equal(s2.budget, 0);
    });
  });

  describe('freshSaveWallet (edit existing period)', () => {
    it('updates income value and redistributes when budget changes', () => {
      const s = t.setState({
        budget: 200,
        startDate: '2026-09-01',
        finishDate: '2026-09-30',
        currency: 'USD',
        appliedDailyDate: app.today(),
        transactions: [
          { id: 'i', type: 'INCOME', value: 200, date: '2026-09-01', time: '00:00', comment: '' },
          { id: 'a', type: 'SPENT', value: 20, date: '2026-09-09', time: '10:00', comment: 'x' },
        ],
      });
      app.freshSaveWallet(form({
        budget: '180', startDate: '2026-09-01', finishDate: '2026-09-30', currency: 'USD',
      }));
      assert.equal(s.budget, 180);
      assert.equal(s.transactions.find(x => x.type === 'INCOME').value, 180);
      // save() re-derives the daily counter from today's spends (20 today)
      assert.equal(s.spentFromDailyBudget, 20);
      // dailyBudget excludes today's spend (double-subtraction fix): the "left
      // today" figure subtracts it again, so the pool is (180, not 160)/daysLeft
      assert.equal(s.dailyBudget, app.normalize(180 / app.daysBetween(app.today(), '2026-09-30')));
    });

    it('updates startDate when dates change', () => {
      const s = t.setState({
        budget: 100,
        startDate: '2026-09-01',
        finishDate: '2026-09-30',
        currency: 'USD',
        transactions: [
          { id: 'i', type: 'INCOME', value: 100, date: '2026-09-01', time: '00:00', comment: '' },
        ],
      });
      app.freshSaveWallet(form({
        budget: '100', startDate: '2026-09-02', finishDate: '2026-09-30', currency: 'USD',
      }));
      assert.equal(s.startDate, '2026-09-02');
    });

    it('keeps spends intact when editing the period', () => {
      const s = t.setState({
        budget: 100,
        startDate: '2026-09-01',
        finishDate: '2026-09-30',
        currency: 'USD',
        transactions: [
          { id: 'i', type: 'INCOME', value: 100, date: '2026-09-01', time: '00:00', comment: '' },
          { id: 'a', type: 'SPENT', value: 10, date: '2026-09-08', time: '10:00', comment: 'keep me' },
        ],
      });
      app.freshSaveWallet(form({
        budget: '100', startDate: '2026-09-01', finishDate: '2026-09-30', currency: 'USD',
      }));
      assert.equal(s.transactions.length, 2);
      assert.ok(s.transactions.some(x => x.id === 'a'));
    });

    it('raising the total mid-day never shrinks "left today"', () => {
      // Period 8/20..9/28 (20 days left incl today), consistent 10/day past
      // spending, 2.00 spent today → "left today" shows 8.00.
      const s = t.setState({
        budget: 300,
        dailyBudget: 10,
        startDate: '2026-08-20',
        finishDate: '2026-09-28',
        currency: 'USD',
        appliedDailyDate: app.today(),
        spentFromDailyBudget: 2,
        transactions: [
          { id: 'i', type: 'INCOME', value: 300, date: '2026-08-20', time: '00:00', comment: '' },
          ...Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, type: 'SPENT', value: 10, date: '2026-08-20', time: `${String(i + 9).padStart(2, '0')}:00`, comment: '' })),
          { id: 't', type: 'SPENT', value: 2, date: app.today(), time: '10:00', comment: '' },
        ],
      });
      const before = app.restToday();
      assert.equal(before, 8);

      // Increase smaller than today's spend: before the fix this dropped the
      // allowance because today's spend was subtracted from the pool twice.
      app.freshSaveWallet(form({
        budget: '301', startDate: '2026-08-20', finishDate: '2026-09-28', currency: 'USD',
      }));
      const raised = app.restToday();
      assert.ok(raised > before, `raising budget should not shrink left today (${before} -> ${raised})`);
      assert.equal(s.dailyBudget, app.normalize(301 - 100) / app.daysBetween(app.today(), '2026-09-28'));

      // Restoring the original total restores the exact original allowance.
      app.freshSaveWallet(form({
        budget: '300', startDate: '2026-08-20', finishDate: '2026-09-28', currency: 'USD',
      }));
      assert.equal(app.restToday(), before);
    });
  });

  describe('currencies', () => {
    it('currencyName returns a label for NONE and known codes', () => {
      assert.equal(app.currencyName('NONE'), 'No currency symbol');
      assert.ok(typeof app.currencyName('USD') === 'string' && app.currencyName('USD').length > 0);
      // unknown codes fall back to the code itself
      assert.equal(app.currencyName('ZZZ'), 'ZZZ');
    });

    it('currencyOption shows the code and its full name', () => {
      const usd = app.currencyOption('USD', 'USD');
      assert.match(usd, /value="USD" selected/);
      assert.ok(usd.includes(app.currencyName('USD')));
      assert.ok(usd.includes('USD — '));
      const eur = app.currencyOption('EUR', 'USD');
      assert.match(eur, /value="EUR" /);
      assert.ok(eur.includes('EUR — '));
    });

    it('currencyOption labels NONE with its descriptive name', () => {
      const none = app.currencyOption('NONE', 'USD');
      assert.match(none, /value="NONE" /);
      assert.ok(none.includes('No currency symbol'));
    });

    it('supportedCurrencies always includes USD, EUR, GBP and NONE fallback list', () => {
      const list = app.supportedCurrencies();
      assert.ok(list.includes('USD'));
      assert.ok(list.includes('EUR'));
      assert.ok(list.includes('GBP'));
      assert.ok(list.length > 100);
    });

    it('supportedCurrencies never lists testing or unknown codes', () => {
      const list = app.supportedCurrencies();
      assert.ok(!list.includes('XTS'));
      assert.ok(!list.includes('XXX'));
    });

    it('currency names are pinned English names, identical on every device', () => {
      assert.equal(app.currencyName('GBP'), 'British Pound');
      assert.equal(app.currencyName('USD'), 'US Dollar');
      assert.equal(app.currencyName('EUR'), 'Euro');
    });

    it('every listed currency has a distinct full name (no "CODE — CODE" rows)', () => {
      for (const code of app.supportedCurrencies()) {
        const name = app.currencyName(code);
        assert.notEqual(name, code, `expected a full name for ${code}`);
      }
      const opts = app.currencyOptions();
      for (const code of app.supportedCurrencies()) {
        assert.doesNotMatch(opts, new RegExp(`${code} — ${code}`));
      }
    });

    it('currencyOptions starts with NONE', () => {
      const s = t.setState({ currency: 'EUR' });
      const opts = app.currencyOptions();
      assert.match(opts, /^<option value="NONE" /);
      assert.match(opts, /value="EUR" selected/);
    });
  });
});