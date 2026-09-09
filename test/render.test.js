import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup, activeBudgetState } from './helpers/setup.js';

describe('render / markup', () => {
  let t;
  let app;
  let s;
  beforeEach(() => {
    t = setup({ frozenToday: '2026-09-09' });
    app = t.app;
  });

  describe('editor', () => {
    beforeEach(() => { s = activeBudgetState(t); });

    it('editor shows the amount entry area and pill', () => {
      const html = app.editor();
      assert.match(html, /editor-shell/);
      assert.match(html, /amount-display/);
      assert.match(html, /budget-pill/);
    });

    it('keypad exposes digit keys', () => {
      const html = app.keyboard();
      for (const digit of ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '.']) {
        assert.match(html, new RegExp(`data-key="${digit}"`));
      }
    });

    it('keypad exposes backspace and commit actions', () => {
      const html = app.keyboard();
      assert.match(html, /data-key="backspace"/);
      assert.match(html, /data-action="commit"/);
    });

    it('shows the budget pill with status and value', () => {
      const html = app.editor();
      assert.match(html, /budget-pill/);
      assert.match(html, /left today/);
      assert.match(html, /\$10\.00/); // daily remaining with 0 spent
    });

    it('marks pill as overdrawn when overspent', () => {
      const ov = setOverspent();
      assert.match(app.editor(), /budget-pill over/);
      assert.match(app.editor(), /new daily/);
    });

    function setOverspent() {
      s.budget = 100;
      s.dailyBudget = 5;
      s.spentFromDailyBudget = 90;
      s.finishDate = app.addDays(app.today(), 9);
      s.transactions = [
        { id: 'i', type: 'INCOME', value: 100, date: app.today(), time: '00:00', comment: '' },
        { id: 'b', type: 'SPENT', value: 90, date: app.today(), time: '10:00', comment: '' },
      ];
      return s;
    }
  });

  describe('keyboard', () => {
    it('renders the key grid', () => {
      const html = app.keyboard();
      assert.match(html, /<section class="keyboard">/);
      assert.match(html, /key-grid/);
    });
  });

  describe('history', () => {
    beforeEach(() => {
      s = activeBudgetState(t);
      s.budget = 100;
      s.finishDate = '2026-09-30';
      s.transactions = [
        { id: 'i', type: 'INCOME', value: 100, date: '2026-09-01', time: '00:00', comment: '' },
        { id: 'a', type: 'SPENT', value: 10, date: '2026-09-09', time: '10:00', comment: 'coffee' },
        { id: 'b', type: 'SPENT', value: 5, date: '2026-09-08', time: '09:00', comment: 'bus' },
        { id: 'c', type: 'SPENT', value: 3.5, date: '2026-09-09', time: '11:30', comment: 'snack' },
      ];
    });

    it('groups spends by date', () => {
      const html = app.history();
      assert.match(html, /date-group/);
      // two distinct dates -> two groups
      const groups = html.match(/class="date-group"/g) || [];
      assert.equal(groups.length, 2);
    });

    it('renders each spent row with edit/delete actions (not readOnly)', () => {
      const html = app.history(false);
      const edits = html.match(/data-edit=/g) || [];
      assert.equal(edits.length, 3);
      assert.match(html, /data-delete=/);
    });

    it('renders readOnly rows without edit/delete actions', () => {
      const html = app.history(true);
      assert.doesNotMatch(html, /data-edit=/);
      assert.doesNotMatch(html, /data-delete=/);
    });

    it('filters by comment search', () => {
      t.dbg.setHistorySearch('coffee');
      const html = app.history();
      assert.match(html, /coffee/);
      assert.doesNotMatch(html, /bus/);
      t.dbg.setHistorySearch('');
    });

    it('shows empty state when no spends', () => {
      s.transactions = [{ id: 'i', type: 'INCOME', value: 100, date: '2026-09-01', time: '00:00', comment: '' }];
      const html = app.history();
      assert.match(html, /history-empty/);
    });

    it('shows the remaining budget summary', () => {
      const html = app.history();
      assert.match(html, /remaining budget/);
      assert.match(html, /budget-summary/);
    });
  });

  describe('sheetView', () => {
    it('returns onboarding markup', () => {
      t.dbg.setSheet('onboarding');
      const html = app.sheetView();
      assert.match(html, /onboarding/);
      assert.match(html, /Set period/);
    });

    it('returns wallet form', () => {
      activeBudgetState(t);
      t.dbg.setSheet('wallet');
      const html = app.sheetView();
      assert.match(html, /id="wallet-form"/);
      assert.match(html, /name="currency"/);
    });

    it('returns settings sheet with rows', () => {
      activeBudgetState(t);
      t.dbg.setSheet('settings');
      const html = app.sheetView();
      assert.match(html, /Settings/);
      assert.match(html, /data-action="analytics"/);
      assert.match(html, /data-action="export"/);
    });

    it('marks the New period row as destructive', () => {
      t.dbg.setSheet('settings');
      const html = app.sheetView();
      assert.match(html, /class="sheet-row danger" data-action="new-period"/);
    });

    it('returns history sheet', () => {
      activeBudgetState(t);
      t.dbg.setSheet('history');
      const html = app.sheetView();
      assert.match(html, /history-sheet/);
      assert.match(html, /History/);
    });

    it('returns analytics sheet', () => {
      activeBudgetState(t);
      t.dbg.setSheet('analytics');
      const html = app.sheetView();
      assert.match(html, /analytics-sheet/);
      assert.match(html, /whole budget/);
    });

    it('returns theme sheet', () => {
      activeBudgetState(t);
      t.dbg.setSheet('theme');
      const html = app.sheetView();
      assert.match(html, /distribution-choice/);
      assert.match(html, /Follow system theme/);
    });

    it('returns empty string for unknown sheet', () => {
      t.dbg.setSheet('bogus');
      assert.equal(app.sheetView(), '');
    });
  });

  describe('analytics', () => {
    beforeEach(() => {
      s = activeBudgetState(t);
      s.budget = 100;
      s.startDate = '2026-09-01';
      s.finishDate = '2026-09-30';
      s.transactions = [
        { id: 'i', type: 'INCOME', value: 100, date: '2026-09-01', time: '00:00', comment: '' },
        { id: 'a', type: 'SPENT', value: 2, date: '2026-09-09', time: '10:00', comment: 'coffee' },
        { id: 'b', type: 'SPENT', value: 50, date: '2026-09-08', time: '09:00', comment: 'rent' },
        { id: 'c', type: 'SPENT', value: 2.5, date: '2026-09-07', time: '11:30', comment: '' },
      ];
    });

    it('shows min and max stats', () => {
      const html = app.analyticsSheet();
      assert.match(html, /minimum spend/);
      assert.match(html, /maximum spend/);
    });

    it('shows categories from comments', () => {
      const html = app.analyticsSheet();
      assert.match(html, /coffee/);
      assert.match(html, /rent/);
      assert.match(html, /without tag/); // blank comment bucket
    });

    it('shows spent/remaining/days stats', () => {
      const html = app.analyticsSheet();
      assert.match(html, /remaining/);
      assert.match(html, /spent/);
      assert.match(html, /days left/);
    });

    it('empty state when no spends', () => {
      s.transactions = [];
      const html = app.analyticsSheet();
      assert.match(html, /No spends yet/);
    });
  });

  describe('themeSheet', () => {
    it('marks the current theme as selected', () => {
      const st = activeBudgetState(t);
      st.theme = 'dark';
      const html = app.themeSheet();
      assert.match(html, /selected/);
      assert.match(html, /data-action="set-theme:dark"/);
    });
  });

  describe('confirm dialog', () => {
    it('renders a pending new-period confirmation', () => {
      t.dbg.setPendingConfirm({ value: 'new-period' });
      const html = app.confirmDialog();
      assert.match(html, /dialog-layer/);
      assert.match(html, /role="dialog"/);
      assert.match(html, /Start a new period/);
      assert.match(html, /data-action="cancel-confirm"/);
      assert.match(html, /data-action="confirm-dialog"/);
      assert.match(html, /no undo/);
    });

    it('renders a pending finish confirmation', () => {
      t.dbg.setPendingConfirm({ value: 'finish' });
      const html = app.confirmDialog();
      assert.match(html, /Finish this period early/);
      assert.match(html, /Finish now/);
    });

    it('renders generic fallback copy for an unknown context', () => {
      t.dbg.setPendingConfirm({ value: 'mystery' });
      const html = app.confirmDialog();
      assert.match(html, /Are you sure/);
    });
  });

  describe('settings helpers', () => {
    it('sheetRow escapes title/detail', () => {
      const html = app.sheetRow({ action: 'x', symbol: 'w', title: '<b>t</b>', detail: '<i>d</i>' });
      assert.match(html, /&lt;b&gt;t&lt;\/b&gt;/);
      assert.match(html, /&lt;i&gt;d&lt;\/i&gt;/);
    });

    it('sheetRowLead uses an icon for known symbols and span otherwise', () => {
      assert.match(app.sheetRowLead('wallet'), /<svg/);
      assert.match(app.sheetRowLead('＋'), /settings-symbol/);
    });

    it('sheetTitle builds heading with optional trailing', () => {
      const html = app.sheetTitle('Hi', { trailing: '<button>X</button>' });
      assert.match(html, /<h2>Hi<\/h2>/);
      assert.match(html, /<button>X<\/button>/);
      const cls = app.sheetTitle('Hi', { className: 'custom' });
      assert.match(cls, /sheet-title custom/);
    });
  });

  describe('tagging', () => {
    it('suggests previously used tags', () => {
      activeBudgetState(t);
      const s2 = t.app.__dbg.getState();
      s2.transactions = [
        { id: 'i', type: 'INCOME', value: 100, date: t.app.today(), time: '00:00', comment: '' },
        { id: 'a', type: 'SPENT', value: 1, date: t.app.today(), time: '10:00', comment: 'coffee' },
        { id: 'b', type: 'SPENT', value: 2, date: t.app.today(), time: '11:00', comment: 'coffee' },
        { id: 'c', type: 'SPENT', value: 3, date: t.app.today(), time: '12:00', comment: 'rent' },
      ];
      const html = app.tagging();
      assert.match(html, /data-tag="coffee"/);
      assert.match(html, /data-tag="rent"/);
    });

    it('renders empty tag list when no comments exist', () => {
      activeBudgetState(t);
      const html = app.tagging();
      assert.doesNotMatch(html, /tag-list/);
    });
  });

  describe('historyToggle / desktopHistory', () => {
    it('historyToggle renders the handle button', () => {
      assert.match(app.historyToggle(), /history-handle/);
      assert.match(app.historyToggle(), /data-action="history"/);
    });

    it('desktopHistory renders the pane with editor link', () => {
      const html = app.desktopHistory();
      assert.match(html, /history-pane/);
      assert.match(html, /Budget Tool/);
    });
  });
});