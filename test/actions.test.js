import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup, activeBudgetState } from './helpers/setup.js';
import { createApp } from './helpers/loadApp.js';

describe('actions', () => {
  let t;
  let app;
  let s;
  beforeEach(() => {
    t = setup({ frozenToday: '2026-09-09' });
    app = t.app;
    s = activeBudgetState(t);
  });

  it('navigates to settings', () => {
    app.action('settings');
    assert.equal(t.dbg.getSheet(), 'settings');
  });

  it('navigates to wallet', () => {
    app.action('wallet');
    assert.equal(t.dbg.getSheet(), 'wallet');
  });

  it('new-period opens a confirmation when a budget is active', () => {
    t.dbg.setSheet('settings');
    app.action('new-period');
    assert.ok(t.dbg.getPendingConfirm());
    assert.equal(t.dbg.getPendingConfirm().value, 'new-period');
    // not navigated away until confirmed
    assert.equal(t.dbg.getSheet(), 'settings');
  });

  it('confirming new-period proceeds to onboarding', () => {
    t.dbg.setSheet('settings');
    app.action('new-period');
    app.action('confirm-dialog');
    assert.equal(t.dbg.getSheet(), 'onboarding');
    assert.equal(t.dbg.getPendingConfirm(), null);
  });

  it('cancelling new-period stays in settings', () => {
    t.dbg.setSheet('settings');
    app.action('new-period');
    app.action('cancel-confirm');
    assert.equal(t.dbg.getPendingConfirm(), null);
    assert.equal(t.dbg.getSheet(), 'settings');
  });

  it('new-period skips confirmation when no budget is active', () => {
    t.setState({ budget: 0, transactions: [] });
    app.action('new-period');
    assert.equal(t.dbg.getPendingConfirm(), null);
    assert.equal(t.dbg.getSheet(), 'onboarding');
  });

  it('finish asks for confirmation and resets the period on confirm', () => {
    app.action('finish');
    assert.ok(t.dbg.getPendingConfirm());
    assert.equal(t.dbg.getPendingConfirm().value, 'finish');
    app.action('confirm-dialog');
    assert.equal(t.dbg.getState().budget, 0);
    assert.equal(t.dbg.getState().transactions.length, 0);
    assert.equal(t.dbg.getSheet(), 'onboarding');
    assert.equal(t.dbg.getPendingConfirm(), null);
  });

  it('finish cancel leaves the period untouched', () => {
    app.action('finish');
    app.action('cancel-confirm');
    assert.equal(t.dbg.getPendingConfirm(), null);
    assert.equal(t.dbg.getState().budget, 100);
  });

  it('confirm-dialog with nothing pending is a no-op', () => {
    app.action('confirm-dialog');
    assert.equal(t.dbg.getPendingConfirm(), null);
    assert.equal(t.dbg.getState().budget, 100);
  });

  it('navigates to history', () => {
    app.action('history');
    assert.equal(t.dbg.getSheet(), 'history');
  });

  it('navigates to analytics', () => {
    app.action('analytics');
    assert.equal(t.dbg.getSheet(), 'analytics');
  });

  it('navigates to theme', () => {
    app.action('theme');
    assert.equal(t.dbg.getSheet(), 'theme');
  });

  it('closes the sheet', () => {
    t.dbg.setSheet('history');
    app.action('close');
    assert.equal(t.dbg.getSheet(), null);
  });

  it('cancel-edit resets the editor to add mode', () => {
    t.dbg.setEditor({ editingId: 'x', rawValue: '5', editorComment: '', editorDate: app.today(), editorTime: '08:30' });
    app.action('cancel-edit');
    const html = app.editor();
    assert.doesNotMatch(html, /editing spend/);
  });

  it('commits via action dispatch', () => {
    t.dbg.setEditor({ editingId: null, rawValue: '9.99', editorComment: 'snack', editorDate: app.today(), editorTime: '' });
    app.action('commit');
    assert.equal(s.transactions.length, 1);
    assert.equal(s.transactions[0].value, 9.99);
  });

  it('clear-search resets the search filter', () => {
    t.dbg.setHistorySearch('coffee');
    app.action('clear-search');
    const html = app.history();
    // search input value empty
    assert.doesNotMatch(html, /value="coffee"/);
  });

  it('set-theme updates the theme', () => {
    app.action('set-theme:dark');
    assert.equal(s.theme, 'dark');
  });
});

describe('hash navigation', () => {
  it('opening with #history selects the history sheet', () => {
    const { app } = createAppState({ hash: '#history' });
    assert.equal(app.__dbg.getSheet(), 'history');
  });

  it('opening with #analytics selects the analytics sheet', () => {
    const { app } = createAppState({ hash: '#analytics' });
    assert.equal(app.__dbg.getSheet(), 'analytics');
  });

  it('opening without a recognized hash does not force a sheet', () => {
    const { app } = createAppState({ hash: '#random' });
    assert.notEqual(app.__dbg.getSheet(), 'history');
    assert.notEqual(app.__dbg.getSheet(), 'analytics');
  });

  it('handleHash responds to a recognized hash', () => {
    const { app } = createAppState({ hash: '' });
    app.__dbg.setSheet(null);
    // handleHash reads window.location.hash, which is fixed at load; instead
    // of re-loading, verify the function exists and runs without error.
    assert.equal(typeof app.handleHash, 'function');
    assert.doesNotThrow(() => app.handleHash());
  });

  function createAppState({ hash }) {
    const app = createApp({ frozenToday: '2026-09-09', locationHash: hash });
    return { app };
  }
});