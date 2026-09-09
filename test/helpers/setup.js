import { createApp } from './loadApp.js';

/**
 * Build a fresh app instance pinned to a fixed "today" (2026-09-09) and expose
 * convenience helpers for arranging module state and editor inputs.
 */
export function setup({ frozenToday = '2026-09-09' } = {}) {
  const app = createApp({ frozenToday });
  const dbg = app.__dbg;

  const setState = overrides => {
    const base = app.defaultState();
    Object.assign(base, overrides);
    dbg.setState(base);
    return app.__dbg.getState();
  };

  const resetEditor = () => dbg.setEditor({
    editingId: null,
    rawValue: null,
    editorComment: '',
    editorDate: app.today(),
    editorTime: '',
  });

  return { app, dbg, setState, resetEditor };
}

/**
 * Set up a realistic active period with a budget and optional spends.
 * Returns the app instance.
 */
export function activeBudgetState(t) {
  const { app, setState, resetEditor } = t;
  resetEditor();
  return setState({
    budget: 100,
    dailyBudget: 10,
    spentFromDailyBudget: 0,
    startDate: app.today(),
    finishDate: app.addDays(app.today(), 9),
    appliedDailyDate: app.today(),
    currency: 'USD',
    transactions: [],
  });
}
