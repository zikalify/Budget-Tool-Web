import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup, activeBudgetState } from './helpers/setup.js';

describe('system back button', () => {
  let t;
  let app;
  beforeEach(() => {
    t = setup({ frozenToday: '2026-09-09' });
    app = t.app;
  });

  const fireBack = () => app.__win._fire('popstate', {});

  it('closes an open pane instead of leaving the app', () => {
    activeBudgetState(t);
    app.action('settings');
    assert.equal(t.dbg.getSheet(), 'settings');
    fireBack();
    assert.equal(t.dbg.getSheet(), null);
    assert.equal(t.dbg.getPendingConfirm(), null);
  });

  it('dismisses a pending confirmation dialog first', () => {
    activeBudgetState(t);
    t.dbg.setSheet(null);
    app.render();
    app.action('finish');
    assert.equal(t.dbg.getPendingConfirm().value, 'finish');
    fireBack();
    assert.equal(t.dbg.getPendingConfirm(), null);
    assert.equal(t.dbg.getSheet(), null);
  });

  it('closes the pane beneath a dismissed dialog on the next back', () => {
    activeBudgetState(t);
    app.action('history');
    assert.equal(t.dbg.getSheet(), 'history');
    t.dbg.setPendingConfirm({ value: 'finish' });
    app.renderSheet();
    fireBack();
    assert.equal(t.dbg.getPendingConfirm(), null);
    assert.equal(t.dbg.getSheet(), 'history', 'first back only dismisses the dialog');
    fireBack();
    assert.equal(t.dbg.getSheet(), null, 'second back closes the pane');
  });

  it('never exits while onboarding needs a budget', () => {
    t.setState({ budget: 0, startDate: app.today(), finishDate: app.addDays(app.today(), 9), currency: 'USD', transactions: [] });
    app.render();
    assert.equal(t.dbg.getSheet(), 'onboarding');
    fireBack();
    assert.equal(t.dbg.getSheet(), 'onboarding');
  });

  it('a straggler hashchange cannot reopen a pane closed by the system back', () => {
    activeBudgetState(t);
    t.dbg.setSheet('history');
    app.render();
    app.__win.location.hash = '#history';
    fireBack();
    assert.equal(t.dbg.getSheet(), null);
    app.__win._fire('hashchange', {});
    assert.equal(t.dbg.getSheet(), null, 'hash-shortcut reopen is suppressed');
  });
});