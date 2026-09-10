import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_PATH = join(__dirname, '..', '..', 'app.js');

let cachedSource = null;

/**
 * Load app.js in a sandboxed context with stubbed browser globals, then expose
 * every module-scoped function and a debug handle to read/mutate private state.
 *
 * Each call to createApp() yields a fresh module instance with isolated state,
 * simulating a clean browser load.
 *
 * Options:
 *   - dates: an object of extra globals to inject (e.g. a fake Date).
 *   - frozenToday: ISO date string (YYYY-MM-DD) to pin the app's clock to.
 *     Uses a fake Date subclass so time-dependent logic is deterministic.
 */
export function createApp({ dates = {}, frozenToday = null, seedStorage = null, locationHash = '' } = {}) {
  const src = cachedSource || (cachedSource = readFileSync(APP_PATH, 'utf8'));

  const debugExport = `
const __dbg = {
  getState: () => state,
  setState: (s) => { state = s; },
  mutateState: (fn) => { fn(state); },
  setSheet: (v) => { sheet = v; },
  getSheet: () => sheet,
  setEditor: (e) => {
    editingId = e.editingId;
    rawValue = e.rawValue;
    editorComment = e.editorComment;
    editorDate = e.editorDate;
    editorTime = e.editorTime;
  },
  setRaw: (v) => { rawValue = v; },
  setHistorySearch: (v) => { historySearch = v; },
  setStartingNewPeriod: (v) => { startingNewPeriod = v; },
  getPendingConfirm: () => pendingConfirm,
  setPendingConfirm: (v) => { pendingConfirm = v; },
};
return {
  __dbg,
  dateKey, today, nowTime, uid, dateValue, dateLabel, fullDate,
  money, daysBetween, addDays, defaultState, supportedCurrencies, currencyName,
  loadState, save, spends, income, totalSpent, todaySpent, remainingBudget,
  daysLeft, restToday, newDailyBudget, pillDisplay, normalize,
  render, renderSheet, desktopHistory, editor, tagging, dateEditor,
  historyToggle, keyButton, keyboard, spentRow, history, sheetView,
  analyticsSheet, themeSheet, freshSettingsSheet, currencyOption,
  currencyOptions, freshWalletSheet, bind, key, updateEditorPreview, action,
  confirmDialog,
  beginEdit, resetEditor, commit, accountAdd, accountRemove,
  redistributeDailyBudget, applyRolloverIfNeeded, reconcileDerivedState,
  refreshHistoryViews, remove, undoDelete, exportCommitTime, exportCsv,
  csvSafe, show, escapeHtml, escapeAttr, sheetTitle, sheetRowLead, sheetRow,
  freshSaveWallet, haptic, handleHash,
  openDragProgress, closeDragProgress, dragShouldDismiss,
};
`;

  const wrapped = `\n${src}\n${debugExport}\n`;

  const stubs = {
    window: {
      matchMedia() { return { matches: false, addEventListener() {} }; },
      addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); },
      _listeners: {},
      _fire(type, event) {
        for (const fn of this._listeners[type] || []) fn(event || {});
      },
      location: { hash: locationHash },
    },
    document: {
      body: { dataset: {} },
      documentElement: { dataset: {} },
      getElementById() { return makeEl(); },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      createRange() { return { createContextualFragment() { return { firstElementChild: makeEl() }; } }; },
      addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); },
      _listeners: {},
      _fire(type, event) {
        for (const fn of this._listeners[type] || []) fn(Object.assign({ type, target: null }, event || {}));
      },
      visibilityState: 'visible',
      currentScript: null,
    },
    navigator: { serviceWorker: { register() { return { catch() {} }; } } },
    localStorage: makeStorage(seedStorage),
    setInterval() { return 1; },
    setTimeout() { return 1; },
    clearTimeout() {},
    console,
  };

  const factory = new Function(
    'window', 'document', 'navigator', 'localStorage', 'setInterval', 'setTimeout',
    'clearTimeout', 'console', 'Date', 'Intl', 'JSON', 'Math', 'Number', 'String',
    'RegExp', 'Array', 'Object', 'FormData', ...Object.keys(dates),
    wrapped,
  );

  const DateImpl = frozenToday ? fakeDate(frozenToday) : Date;

  const args = [
    stubs.window, stubs.document, stubs.navigator, stubs.localStorage,
    stubs.setInterval, stubs.setTimeout, stubs.clearTimeout, stubs.console,
    DateImpl, Intl, JSON, Math, Number, String, RegExp, Array, Object,
    fakeFormData,
    ...Object.keys(dates).map(k => dates[k]),
  ];

  try {
    const appExport = factory(...args);
    // Expose the recorded-document stubs so tests can dispatch the listeners
    // app.js registers on document/window (visibilitychange, focus, pageshow,
    // and the sheet-dismissal click delegation).
    appExport.__doc = stubs.document;
    appExport.__win = stubs.window;
    return appExport;
  } catch (error) {
    error.message = `LOAD ERROR: ${error.message}`;
    throw error;
  }
}

function makeEl() {
  return {
    innerHTML: null,
    textContent: null,
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    matches() { return false; },
    addEventListener() {},
    appendChild() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; },
    insertAdjacentHTML() {},
  };
}

function makeStorage(seed = null) {
  const store = new Map();
  if (seed) {
    for (const [k, v] of Object.entries(seed)) store.set(k, String(v));
  }
  return {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); },
    clear() { store.clear(); },
    _store: store,
  };
}

function fakeFormData(element) {
  const fields = (element && element._fields) || {};
  return { get(name) { return name in fields ? fields[name] : null; } };
}

/**
 * Build a fake Date implementation whose "today" is pinned to frozenToday,
 * while still behaving like the real Date for arithmetic and formatting.
 */
function fakeDate(frozenIso) {
  const frozen = new Date(`${frozenIso}T12:00:00`);

  class FakeDate extends Date {
    constructor(...args) {
      if (args.length === 0) super(frozen.getTime());
      else super(...args);
    }

    static now() {
      return frozen.getTime();
    }

    toTimeString() {
      // Stable time-of-day so nowTime() is deterministic regardless of TZ.
      return '08:30:00 GMT+0000';
    }
  }
  return FakeDate;
}
