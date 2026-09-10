const STORAGE_KEY = 'budget-tool-web-state';
const dateKey = value => {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const today = () => dateKey(new Date());
const nowTime = () => new Date().toTimeString().slice(0, 5);
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const dateValue = value => new Date(`${value}T12:00:00`);
const dateLabel = value => new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(dateValue(value));
const fullDate = value => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(dateValue(value));
const money = (value, currency = state.currency || 'USD') => currency === 'NONE' ? (Number(value) || 0).toFixed(2) : new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value) || 0);
const daysBetween = (from, to) => Math.max(1, Math.floor((dateValue(to) - dateValue(from)) / 86400000) + 1);
const addDays = (value, amount) => { const result = dateValue(value); result.setDate(result.getDate() + amount); return dateKey(result); };
const defaultState = () => ({ budget: 0, dailyBudget: 0, spentFromDailyBudget: 0, appliedDailyDate: null, startDate: today(), finishDate: addDays(today(), 30), finishPeriodActualDate: null, currency: 'USD', hideOverspendingWarn: false, transactions: [], theme: 'system' });
const supportedCurrencies = () => {
  const fallback = ['AED','AFN','ALL','AMD','ANG','AOA','ARS','AUD','AWG','AZN','BAM','BBD','BDT','BGN','BHD','BIF','BMD','BND','BOB','BRL','BSD','BTN','BWP','BYN','BZD','CAD','CDF','CHF','CLP','CNY','COP','CRC','CUP','CVE','CZK','DJF','DKK','DOP','DZD','EGP','ERN','ETB','EUR','FJD','FKP','GBP','GEL','GHS','GIP','GMD','GNF','GTQ','GYD','HKD','HNL','HRK','HTG','HUF','IDR','ILS','INR','IQD','IRR','ISK','JMD','JOD','JPY','KES','KGS','KHR','KMF','KPW','KRW','KWD','KYD','KZT','LAK','LBP','LKR','LRD','LSL','LYD','MAD','MDL','MGA','MKD','MMK','MNT','MOP','MRU','MUR','MVR','MWK','MXN','MYR','MZN','NAD','NGN','NIO','NOK','NPR','NZD','OMR','PAB','PEN','PGK','PHP','PKR','PLN','PYG','QAR','RON','RSD','RUB','RWF','SAR','SBD','SCR','SDG','SEK','SGD','SHP','SLE','SLL','SOS','SRD','SSP','STN','SYP','SZL','THB','TJS','TMT','TND','TOP','TRY','TTD','TWD','TZS','UAH','UGX','USD','UYU','UZS','VES','VND','VUV','WST','XAF','XCD','XOF','XPF','YER','ZAR','ZMW','ZWL'];
  const browserCurrencies = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('currency') : [];
  return [...new Set([...browserCurrencies, ...fallback, 'XAG','XAU','XBA','XBB','XBC','XBD','XDR','XPD','XPT','XSU','XTS','XUA','XXX'])].sort();
};
const currencyName = code => code === 'NONE' ? 'No currency symbol' : (typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(undefined, { type: 'currency' }).of(code) || code : code);
let state = loadState();
let sheet = state.budget ? null : 'onboarding';
let startingNewPeriod = false;
let editingId = null;
let rawValue = '';
let editorComment = '';
let editorDate = today();
let editorTime = nowTime();
let historySearch = '';
let lastDeleted = null;
let toastTimer;
let renderedSheet = null;
let pendingConfirm = null;

// Sheet drag gestures: the history handle opens by pulling up, the sheet grip
// dismisses by pulling down. A gesture is only tracked past a slop distance so
// plain taps keep their normal behavior.
let dragState = null;
let dragConsumedClick = false;
let wasBackgrounded = false;
const DRAG_SLOP = 6;
const DRAG_DISMISS_FRACTION = 0.35;

function haptic(ms = 10) {
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(ms);
    }
  } catch {}
}

// On-screen diagnostic overlay (hold the settings gear ~0.8s to toggle). It
// records which browser events actually reach the page so a reported "nothing
// responds" state can be diagnosed on the device instead of by guesswork. The
// overlay never intercepts taps (pointer-events: none) and stays off by default.
const DIAG = { on: false, log: [] };
function diag(kind, target) {
  if (!DIAG.on) return;
  const where = !target ? '' : target.tagName ? `${target.tagName}${target.classList && target.classList.value ? '.' + target.classList.value : ''}${target.dataset && target.dataset.action ? '[data-action=' + target.dataset.action + ']' : ''}` : String(target);
  DIAG.log.push(`${new Date().toLocaleTimeString()} ${kind}${where ? ' ' + where : ''} sheet=${sheet || '·'}`);
  if (DIAG.log.length > 40) DIAG.log.shift();
  let box = document.getElementById('diag-box');
  if (!box) {
    box = document.createElement('pre');
    box.id = 'diag-box';
    box.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:rgba(0,0,0,.88);color:#9f9;font:9px/1.45 "SF Mono",Menlo,monospace;padding:6px 8px;max-height:50vh;overflow:auto;white-space:pre-wrap;pointer-events:none;margin:0;';
    document.body.appendChild(box);
  }
  box.textContent = DIAG.log.join('\n');
}

function loadState() {
  try {
    return { ...defaultState(), ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') };
  } catch {
    return defaultState();
  }
}
function save() {
  // Persist a repairable derived value, never a stale one. This covers every
  // mutation path that writes the ledger, including edits, deletes, and undo.
  state.spentFromDailyBudget = normalize(todaySpent());
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
function spends() { return state.transactions.filter(item => item.type === 'SPENT'); }
function income() {
  return state.transactions
    .filter(item => item.type === 'INCOME')
    .reduce((total, item) => total + Number(item.value), 0);
}
function totalSpent() { return spends().reduce((total, item) => total + Number(item.value), 0); }
function todaySpent() {
  return spends()
    .filter(item => item.date === today())
    .reduce((total, item) => total + Number(item.value), 0);
}
// The ledger is the source of truth. Never derive the total remaining budget
// from the persisted daily counter: that counter can be stale after an edit,
// deletion, restore, or a new calendar day.
function remainingBudget() {
  const budget = Math.max(0, Number(state.budget) || 0);
  const calculated = budget - totalSpent();
  return Math.max(0, Math.min(budget, calculated));
}
function daysLeft() { return state.finishDate ? daysBetween(today(), state.finishDate) : 0; }
function restToday() {
  return Number(state.dailyBudget || 0)
    - Number(state.spentFromDailyBudget || 0)
    - (Number(rawValue) || 0);
}
function newDailyBudget() {
  // When today is overspent, spread what remains (including the currently
  // typed, uncommitted spend) across the following days.
  const pendingSpend = Number(rawValue) || 0;
  return normalize(Math.max(0, remainingBudget() - pendingSpend) / Math.max(1, daysLeft() - 1));
}
function pillDisplay() {
  const todayRemaining = restToday();
  const isOverdraft = todayRemaining < 0;
  const daily = isOverdraft ? newDailyBudget() : todayRemaining;
  return {
    isOverdraft,
    status: state.budget ? (isOverdraft ? 'new daily' : 'left today') : 'set period',
    value: state.budget ? money(daily) : money(0),
    progress: Math.max(0, Math.min(100, state.dailyBudget ? (daily / state.dailyBudget) * 100 : 0)),
  };
}
function normalize(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}
const ICONS = {
  settings: '<path d="M9.7 3.5 10.5 2h3l.8 1.5 1.7.7 1.7-.4 2.1 2.1-.4 1.7.7 1.7 1.5.8v3l-1.5.8-.7 1.7.4 1.7-2.1 2.1-1.7-.4-1.7.7-.8 1.5h-3l-.8-1.5-1.7-.7-1.7.4-2.1-2.1.4-1.7-.7-1.7L2 13.1v-3l1.5-.8.7-1.7-.4-1.7 2.1-2.1 1.7.4 1.7-.7Z"/><circle cx="12" cy="11.6" r="2.8"/>',
  wallet: '<path d="M4 7h16v12H4zM4 7l2-3h12l2 3M16 13h4"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  edit: '<path d="m4 16-1 5 5-1L20 8l-4-4L4 16Z"/>',
  trash: '<path d="M5 7h14m-9 4v5m4-5v5M8 7l1-3h6l1 3m-9 0 1 14h8l1-14"/>',
  chart: '<path d="M4 19V5m0 14h16M8 16v-4m4 4V8m4 8v-7"/>',
  download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4M4 20h16"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
};
function icon(name) { return `<svg viewBox="0 0 24 24">${ICONS[name] || ''}</svg>`; }

function createRipple(event) {
  const button = event.currentTarget;
  const circle = document.createElement('span');
  const diameter = Math.max(button.clientWidth, button.clientHeight);
  const radius = diameter / 2;
  const rect = button.getBoundingClientRect();
  circle.style.width = circle.style.height = `${diameter}px`;
  circle.style.left = `${(event.clientX || (event.touches && event.touches[0] ? event.touches[0].clientX : rect.left + radius)) - rect.left - radius}px`;
  circle.style.top = `${(event.clientY || (event.touches && event.touches[0] ? event.touches[0].clientY : rect.top + radius)) - rect.top - radius}px`;
  circle.classList.add('ripple');
  const existingRipple = button.querySelector('.ripple');
  if (existingRipple) existingRipple.remove();
  button.appendChild(circle);
  setTimeout(() => circle.remove(), 600);
}

// Destructive actions never fire on first tap: a confirmation dialog explains
// the consequence and waits for an explicit "Confirm" (or Escape / backdrop
// click / Cancel). No browser confirm() popups are used.
const CONFIRM_CONTEXTS = {
  'new-period': {
    title: 'Start a new period?',
    message: 'This clears the current budget and every recorded spend before you begin a fresh one. There is no undo.',
    confirmLabel: 'Start new',
  },
  'finish': {
    title: 'Finish this period early?',
    message: 'The period ends now and the budget with all of its spends is cleared. There is no undo.',
    confirmLabel: 'Finish now',
  },
};
function confirmDialog() {
  const context = CONFIRM_CONTEXTS[pendingConfirm.value] || {};
  return '<div class="sheet-layer dialog-layer" role="dialog" aria-modal="true" aria-label="Confirmation">'
    + '<section class="sheet confirm-sheet">'
    + `<h2>${context.title || 'Are you sure?'}</h2>`
    + `<p class="confirm-message">${context.message || ''}</p>`
    + '<div class="confirm-actions">'
    + '<button type="button" class="confirm-neutral" data-action="cancel-confirm">Cancel</button>'
    + `<button type="button" class="confirm-danger" data-action="confirm-dialog">${context.confirmLabel || 'Confirm'}</button>`
    + '</div>'
    + '</section></div>';
}

function render() {
  // Rendering replaces the app markup. Keep an already-open sheet still during
  // state updates (for example, deleting a spend from History) instead of
  // replaying its entrance animation.
  diag('render');
  applyRolloverIfNeeded();
  const preserveSheetMotion = Boolean(sheet && sheet === renderedSheet);
  const effectiveTheme = state.theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : state.theme;
  document.body.dataset.theme = effectiveTheme;
  // The status bar color is intentionally NOT updated at runtime. Changing
  // <meta name="theme-color"> dynamically makes Chrome for Android re-composite
  // the status bar, which leaves a permanent 1px seam under it (a bright
  // hairline against a dimmed open pane in light mode) that only a full reload
  // clears. The static media-query <meta> tags in index.html paint it once, so
  // in-app theme toggles never repaint the status bar.
  document.getElementById('app').innerHTML = `<div class="app-root${preserveSheetMotion ? ' preserve-motion' : ''}"><div class="clone-shell">${desktopHistory()}<main class="editor-page">${editor()}${keyboard()}</main></div>${sheet ? sheetView() : ''}${pendingConfirm ? confirmDialog() : ''}<div id="toast" class="toast"></div></div>`;
  renderedSheet = sheet;
  bind();
}

// Sheets sit above the editor. Changing one must not recreate the editor below
// it, otherwise the balance value visibly jumps as the sheet opens. A sheet and
// an open confirmation dialog travel together inside a shared stack element.
function renderSheet() {
  const root = document.querySelector('#app > .app-root');
  const toast = document.getElementById('toast');
  if (!root || !toast) {
    render();
    return;
  }
  root.querySelector('.sheet-stack')?.remove();
  const stackHtml = (sheet ? sheetView() : '') + (pendingConfirm ? confirmDialog() : '');
  if (stackHtml) {
    toast.insertAdjacentHTML('beforebegin', `<div class="sheet-stack">${stackHtml}</div>`);
    bind(toast.previousElementSibling);
  } else {
    // A full render() (background return, rollover, theme change) leaves the open
    // pane as a direct child of `.app-root` with no `.sheet-stack` wrapper. When
    // nothing is open, that stray pane must be removed or it stays stuck on
    // screen even though `sheet` is already null.
    root.querySelector(':scope > .sheet-layer')?.remove();
  }
  renderedSheet = sheet;
}
function desktopHistory() {
  return '<aside class="history-pane"><div class="history-top">'
    + '<div class="mark"><img src="icons/money-bags.svg" alt=""/><span>Budget Tool</span></div>'
    + `<button class="round-button" data-action="settings" aria-label="Settings">${icon('settings')}</button>`
    + `</div>${history(false)}</aside>`;
}
function editor() {
  const mode = editingId ? 'EDIT' : 'ADD';
  const active = Boolean(rawValue || editorComment || editingId);
  const pill = pillDisplay();
  const toolbarLeft = mode === 'EDIT'
    ? `<button class="round-button" data-action="cancel-edit" aria-label="Cancel edit">${icon('back')}</button>`
    : '<span class="editor-spacer"></span>';
  const amountLabel = mode === 'EDIT' ? 'editing spend' : active ? 'current spend' : 'enter a spend';
  const currencyLabel = state.currency === 'NONE' ? '' : state.currency;
  return '<section class="editor-shell">'
    + '<header class="editor-toolbar">'
    + toolbarLeft
    + `<button class="budget-pill ${pill.isOverdraft ? 'over' : ''}" data-action="wallet"><span class="pill-status">${pill.status}</span><strong>${pill.value}</strong><i style="width:${pill.progress}%"></i></button>`
    + `<button class="round-button" data-action="settings" aria-label="Settings">${icon('settings')}</button>`
    + '</header>'
    + '<section class="amount-area">'
    + `<span class="amount-label">${amountLabel}</span>`
    + `<strong class="amount-display">${escapeHtml(rawValue) || '0'}</strong>`
    + `<span class="currency-label">${currencyLabel}</span>`
    + '</section>'
    + (mode === 'EDIT' ? dateEditor() : tagging())
    + historyToggle()
    + '</section>';
}
function tagChip(tag) { return `<button data-tag="${escapeAttr(tag)}">${escapeHtml(tag)}</button>`; }
function tagging() {
  const tags = [...new Set(spends().map(item => item.comment).filter(Boolean))].reverse();
  const list = tags.length ? `<div class="tag-list">${tags.map(tagChip).join('')}</div>` : '';
  return '<div class="tagging-wrapper"><div class="tagging">'
    + `<input id="comment" value="${escapeAttr(editorComment)}" placeholder="Add a note" autocomplete="off">`
    + `<button class="comment-done" data-action="comment-done">${icon('check')}</button>`
    + '</div>'
    + list
    + '</div>';
}
function dateEditor() {
  const safeDate = editorDate > today() ? today() : editorDate;
  return '<div class="date-editor">'
    + `<label>${icon('calendar')}<input id="edit-date" type="date" min="${escapeAttr(state.startDate)}" max="${escapeAttr(today())}" value="${escapeAttr(safeDate)}"></label>`
    + `<label>${icon('clock')}<input id="edit-time" type="time" value="${escapeAttr(editorTime)}"></label>`
    + '</div><div class="tagging-wrapper"><div class="tagging">'
    + `<input id="comment" value="${escapeAttr(editorComment)}" placeholder="Add a note">`
    + `<button class="comment-done" data-action="comment-done">${icon('check')}</button>`
    + '</div></div>';
}
function historyToggle() { return '<button class="history-handle" data-action="history" aria-label="Open history"><span></span></button>'; }
function keyButton({ key, className = '', action, label }) {
  const attribute = action ? `data-action="${action}"` : `data-key="${key}"`;
  const classes = ['key', className].filter(Boolean).join(' ');
  return `<button class="${classes}" ${attribute}>${label}</button>`;
}
function keyboard() {
  return '<section class="keyboard"><div class="key-grid">'
    + keyButton({ key: '7', label: '7' })
    + keyButton({ key: '8', label: '8' })
    + keyButton({ key: '9', label: '9' })
    + keyButton({ key: 'backspace', className: 'secondary-key', label: '⌫' })
    + keyButton({ key: '4', label: '4' })
    + keyButton({ key: '5', label: '5' })
    + keyButton({ key: '6', label: '6' })
    + '<span></span>'
    + keyButton({ key: '1', label: '1' })
    + keyButton({ key: '2', label: '2' })
    + keyButton({ key: '3', label: '3' })
    + keyButton({ key: '', action: 'commit', className: 'apply-key', label: '✓' })
    + keyButton({ key: '0', className: 'zero-key', label: '0' })
    + keyButton({ key: '.', label: '.' })
    + '</div></section>';
}
function spentRow(item, readOnly) {
  const actions = readOnly ? '' : `
              <button class="row-action" data-edit="${item.id}" aria-label="Edit spend">${icon('edit')}</button>
              <button class="row-action danger" data-delete="${item.id}" aria-label="Delete spend">${icon('trash')}</button>
            `;
  return `
          <div class="spent-row">
            <div class="spent-mark">−</div>
            <div class="spent-copy">
              <strong>${money(item.value)}</strong>
              <span>${item.time || ''}${item.comment ? ` · ${escapeHtml(item.comment)}` : ''}</span>
            </div>
            ${actions}
          </div>
        `;
}
function history(readOnly = false) {
  const allSpends = spends().sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));
  const query = historySearch.trim().toLowerCase();
  const filtered = query
    ? allSpends.filter(item => (item.comment || '').toLowerCase().includes(query) || String(item.value).includes(query) || dateLabel(item.date).toLowerCase().includes(query))
    : allSpends;

  const grouped = {};
  filtered.forEach(item => (grouped[item.date] ||= []).push(item));
  const remaining = Math.max(0, remainingBudget());
  const progress = state.budget ? Math.max(0, Math.min(100, remaining / Number(state.budget) * 100)) : 0;

  return `<section class="history-content">
    <div class="history-heading">
      <div><span class="section-label">ledger</span><h1>History</h1></div>
      <button class="plain-button" data-action="analytics">${icon('chart')} analytics</button>
    </div>
    <div class="budget-summary">
      <div class="summary-line"><span>remaining budget</span><strong>${money(remaining)}</strong></div>
      <div class="summary-progress"><i style="width:${progress}%"></i></div>
      <small>${state.budget ? `${money(state.budget)} planned · ${fullDate(state.startDate)} – ${fullDate(state.finishDate)}` : 'No active period'}</small>
    </div>
    ${allSpends.length ? `
    <div class="history-search-wrapper">
      <div class="history-search">
        ${icon('search')}
        <input type="search" id="history-search-input" placeholder="Search spends..." value="${escapeAttr(historySearch)}" autocomplete="off">
        ${historySearch ? `<button class="history-search-clear" data-action="clear-search" aria-label="Clear search">×</button>` : ''}
      </div>
    </div>` : ''}
    ${Object.entries(grouped).map(([date, items]) => `
      <section class="date-group">
        <div class="date-divider"><strong>${dateLabel(date)}${date === today() ? ' <i class="today-chip">today</i>' : ''}</strong><span>${money(items.reduce((sum, item) => sum + Number(item.value), 0))}</span></div>
        ${items.map(item => spentRow(item, readOnly)).join('')}
      </section>
    `).join('') || `<div class="history-empty">${query ? 'No matching spends found.' : 'Your spends will appear here.'}</div>`}
  </section>`;
}
function sheetView() {
  if (sheet === 'onboarding') {
    return '<div class="sheet-layer"><section class="sheet onboarding"><span class="sheet-grip"></span>'
      + '<p class="section-label">welcome</p><h2>Hello.</h2>'
      + '<p class="sheet-copy">Budget Tool helps you spend money wisely by giving you a clear amount for each day.</p>'
      + '<ol>'
      + '<li><b>1</b><span><strong>Set a period budget</strong><small>Choose your total and finish date.</small></span></li>'
      + '<li><b>2</b><span><strong>Record spends</strong><small>Write down what leaves your wallet.</small></span></li>'
      + '<li><b>3</b><span><strong>See what remains</strong><small>Keep your daily number visible.</small></span></li>'
      + '</ol>'
      + '<button class="primary full" data-action="wallet">Set period</button>'
      + '</section></div>';
  }
  if (sheet === 'wallet') return freshWalletSheet();
  if (sheet === 'settings') return freshSettingsSheet();
  if (sheet === 'history') {
    return '<div class="sheet-layer"><section class="sheet history-sheet"><span class="sheet-grip"></span>'
      + sheetTitle('History', { className: 'history-sheet-title', lead: `<button class="round-button" data-action="close" aria-label="Close">${icon('back')}</button>` })
      + `${history()}</section></div>`;
  }
  if (sheet === 'analytics') return analyticsSheet();
  if (sheet === 'theme') return themeSheet();
  return '';
}
function analyticsSheet() {
  const list = spends();
  const min = list.length ? list.reduce((a, b) => Number(a.value) < Number(b.value) ? a : b) : null;
  const max = list.length ? list.reduce((a, b) => Number(a.value) > Number(b.value) ? a : b) : null;
  const byTag = {};
  list.forEach(item => {
    const tag = item.comment || 'without tag';
    byTag[tag] = (byTag[tag] || 0) + Number(item.value);
  });
  const backButton = `<button class="round-button" data-action="close" aria-label="Close">${icon('back')}</button>`;
  const exportButton = `<button class="round-button" data-action="export">${icon('download')}</button>`;
  const minMax = min ? '<div class="minmax">'
    + `<article><span>minimum spend</span><strong>${money(min.value)}</strong><small>${dateLabel(min.date)}${min.comment ? ` · ${escapeHtml(min.comment)}` : ''}</small></article>`
    + `<article><span>maximum spend</span><strong>${money(max.value)}</strong><small>${dateLabel(max.date)}${max.comment ? ` · ${escapeHtml(max.comment)}` : ''}</small></article>`
    + '</div>' : '';
  const categoryMax = Math.max(0, ...Object.values(byTag));
  const categories = Object.entries(byTag).sort((a, b) => b[1] - a[1])
    .map(([tag, amount]) => `<div class="category-row"><span>${escapeHtml(tag)}</span><strong>${money(amount)}</strong><i style="width:${amount / categoryMax * 100}%"></i></div>`)
    .join('') || '<p class="muted">No spends yet.</p>';
  return '<div class="sheet-layer"><section class="sheet analytics-sheet">'
    + '<span class="sheet-grip"></span>'
    + sheetTitle('Analytics', { lead: backButton, trailing: exportButton })
    + `<article class="analytics-budget"><span class="section-label">whole budget</span><strong>${money(state.budget)}</strong><small>${fullDate(state.startDate)} – ${fullDate(state.finishDate)}</small></article>`
    + '<div class="stat-grid">'
    + `<article><span>remaining</span><strong>${money(remainingBudget())}</strong></article>`
    + `<article><span>spent</span><strong>${money(totalSpent())}</strong></article>`
    + `<article><span>days left</span><strong>${daysLeft()}</strong></article>`
    + `<article><span>spends</span><strong>${list.length}</strong></article>`
    + '</div>'
    + minMax
    + '<div class="analytics-block">'
    + '<span class="section-label">categories</span>'
    + categories
    + '</div>'
    + '</section></div>';
}
function themeSheet() {
  const choices = [
    { value: 'system', title: 'Follow system theme', detail: 'Automatically match your device theme.' },
    { value: 'light', title: 'Light theme', detail: 'Always use light mode.' },
    { value: 'dark', title: 'Dark theme', detail: 'Always use dark mode.' },
  ];
  const backButton = `<button class="round-button" data-action="close" aria-label="Close">${icon('back')}</button>`;
  return '<div class="sheet-layer"><section class="sheet distribution-sheet">'
    + '<span class="sheet-grip"></span>'
    + sheetTitle('Theme', { lead: backButton, trailing: '<span></span>' })
    + '<p class="sheet-copy">Choose your preferred appearance.</p>'
    + choices.map(({ value, title, detail }) => {
        const cls = `distribution-choice ${state.theme === value ? 'selected' : ''}`;
        return `<button class="${cls}" data-action="set-theme:${value}"><span class="choice-radio"></span><span><strong>${title}</strong><small>${detail}</small></span></button>`;
      }).join('')
    + '</section></div>';
}

// Sheet drag gestures. Pulling the history handle upward reveals the history
// sheet; pulling a sheet grip downward dismisses it. Progress is a pure ratio
// of the finger travel to a tuned distance so threshold logic is testable.
const DRAG_OPEN_DISTANCE = () => window.innerHeight * 0.45;
const DRAG_CLOSE_DISTANCE = () => window.innerHeight * 0.3;
const pointerY = event => event.touches && event.touches[0] ? event.touches[0].clientY : event.clientY;
const openDragProgress = (dy, distance) => Math.max(0, Math.min(1, -dy / Math.max(1, distance)));
const closeDragProgress = (dy, distance) => Math.max(0, Math.min(1, dy / Math.max(1, distance)));
const dragShouldDismiss = (progress, fraction = DRAG_DISMISS_FRACTION) => progress >= fraction;

function startHandleDrag(event, handle) {
  if (dragState || sheet) return;
  dragState = {
    mode: 'open',
    startY: pointerY(event),
    moved: false,
    progress: 0,
    pointerId: event.pointerId,
    handle,
    sheetEl: null,
    backdrop: null,
  };
  handle.addEventListener('pointermove', dragPointerMove);
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
}

function startGripDrag(event, grip) {
  if (dragState || pendingConfirm || !sheet) return;
  if (sheet === 'onboarding' && !state.budget) return;
  const stackEl = grip.closest ? grip.closest('.sheet-stack') : null;
  dragState = {
    mode: 'close',
    startY: pointerY(event),
    moved: false,
    progress: 0,
    pointerId: event.pointerId,
    handle: grip,
    sheetEl: stackEl ? stackEl.querySelector('.sheet') : null,
    backdrop: stackEl ? stackEl.querySelector('.sheet-layer') : null,
  };
  grip.addEventListener('pointermove', dragPointerMove);
  grip.addEventListener('pointerup', endDrag);
  grip.addEventListener('pointercancel', endDrag);
}

function dragPointerMove(event) {
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  const dy = pointerY(event) - dragState.startY;
  if (!dragState.moved && Math.abs(dy) > DRAG_SLOP) {
    // Capture only once a real drag begins. Grabbing the pointer on a plain
    // pointerdown leaves an element capturing on iOS; if the app is sent to
    // the background before the pointer is released, WebKit can keep that
    // stale capture and every later tap lands on the dead element until the
    // app is killed.
    dragState.moved = true;
    try { dragState.handle.setPointerCapture?.(event.pointerId); } catch {}
    if (dragState.mode === 'open') prepareOpenDrag();
    frameDrag(dragState, 0);
  }
  if (!dragState.moved) return;
  const distance = dragState.mode === 'open' ? DRAG_OPEN_DISTANCE() : DRAG_CLOSE_DISTANCE();
  dragState.progress = dragState.mode === 'open'
    ? openDragProgress(dy, distance)
    : closeDragProgress(dy, distance);
  frameDrag(dragState, dragState.progress);
  event.preventDefault();
}

function resetGestureState() {
  if (dragState) {
    try { dragState.handle?.releasePointerCapture?.(dragState.pointerId); } catch {}
  }
  dragState = null;
  dragConsumedClick = false;
}

function prepareOpenDrag() {
  sheet = 'history';
  renderSheet();
  const stackEl = document.querySelector('.sheet-stack');
  dragState.sheetEl = stackEl ? stackEl.querySelector('.sheet') : null;
  dragState.backdrop = stackEl ? stackEl.querySelector('.sheet-layer') : null;
  frameDrag(dragState, 0);
}

function frameDrag(state, progress) {
  const { sheetEl, backdrop, mode } = state;
  if (!sheetEl || !backdrop) return;
  sheetEl.classList.add('dragging');
  backdrop.classList.add('dragging');
  const delta = mode === 'open' ? 1 - progress : progress;
  sheetEl.style.transform = `translateY(${delta * 100}%)`;
  backdrop.style.opacity = mode === 'open' ? progress : 1 - progress * 0.85;
}

function endDrag(event) {
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  const held = dragState;
  const { handle, mode, moved } = held;
  handle.removeEventListener('pointermove', dragPointerMove);
  handle.removeEventListener('pointerup', endDrag);
  handle.removeEventListener('pointercancel', endDrag);
  try { handle.releasePointerCapture?.(event.pointerId); } catch {}
  dragState = null;
  if (!moved) return;
  const progress = held.progress;
  dragConsumedClick = true;
  if (mode === 'open' && dragShouldDismiss(progress)) {
    // Fully opened: the sheet stays, the torn-off click is swallowed.
    haptic(12);
    settleDrag(held);
  } else if (mode === 'open') {
    haptic(4);
    revertOpenDrag(held);
  } else if (dragShouldDismiss(progress)) {
    haptic(12);
    dismissSheet(held);
  } else {
    haptic(4);
    settleDrag(held);
  }
  // The torn-off click lands immediately after pointerup. If a browser ever
  // suppresses it, expire the guard so the next tap is not lost.
  setTimeout(() => { dragConsumedClick = false; }, 120);
}

function dismissGripTap(grip) {
  if (pendingConfirm || !sheet) return;
  if (sheet === 'onboarding' && !state.budget) return;
  haptic(8);
  const stackEl = grip.closest ? grip.closest('.sheet-stack') : null;
  dismissSheet({
    sheetEl: stackEl ? stackEl.querySelector('.sheet') : null,
    backdrop: stackEl ? stackEl.querySelector('.sheet-layer') : null,
  });
}

function settleDrag(state) {
  const { sheetEl, backdrop } = state;
  if (!sheetEl || !backdrop) return;
  sheetEl.classList.add('dragging');
  backdrop.classList.add('dragging');
  sheetEl.style.transition = 'transform 0.24s var(--md-sys-motion-easing-emphasized)';
  backdrop.style.transition = 'opacity 0.24s ease';
  sheetEl.style.transform = 'translateY(0)';
  backdrop.style.opacity = '1';
  clearDragFrame(sheetEl, backdrop, 240);
}

function revertOpenDrag(state) {
  const { sheetEl, backdrop } = state;
  if (sheetEl && backdrop) {
    sheetEl.classList.add('dragging');
    backdrop.classList.add('dragging');
    sheetEl.style.transition = 'transform 0.24s var(--md-sys-motion-easing-emphasized)';
    backdrop.style.transition = 'opacity 0.24s ease';
    sheetEl.style.transform = 'translateY(100%)';
    backdrop.style.opacity = '0';
  }
  sheet = null;
  renderedSheet = null;
  removeDragStack(240);
}

function dismissSheet(state) {
  const { sheetEl, backdrop } = state;
  if (sheetEl && backdrop) {
    sheetEl.classList.add('dragging');
    backdrop.classList.add('dragging');
    sheetEl.style.transition = 'transform 0.22s var(--md-sys-motion-easing-emphasized)';
    backdrop.style.transition = 'opacity 0.22s ease';
    sheetEl.style.transform = 'translateY(100%)';
    backdrop.style.opacity = '0';
  }
  sheet = null;
  renderedSheet = null;
  removeDragStack(220);
}

function clearDragFrame(sheetEl, backdrop, delay) {
  // The inline transform/opacity return to resting values after the settle
  // transition. The `.dragging` class is intentionally kept: without it the
  // entrance animation would re-run and the sheet would visibly dip/fade.
  setTimeout(() => {
    for (const element of [sheetEl, backdrop]) {
      if (!element) continue;
      element.style.removeProperty('transition');
      element.style.removeProperty('transform');
      element.style.removeProperty('opacity');
    }
  }, delay);
}

function removeDragStack(delay) {
  setTimeout(() => {
    if (!sheet && !pendingConfirm) renderSheet();
  }, delay);
}

function bind(root = document) {
  root.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('pointerdown', e => {
      createRipple(e);
      haptic(10);
    });
  });

  // Hold the settings gear for ~0.8s to toggle the diagnostic overlay.
  root.querySelectorAll('button[data-action="settings"]').forEach(btn => {
    let holdTimer = null;
    const clearHold = () => { if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } };
    btn.addEventListener('pointerdown', () => {
      if (holdTimer) return;
      holdTimer = setTimeout(() => {
        holdTimer = null;
        DIAG.on = !DIAG.on;
        haptic(30);
        if (DIAG.on) diag('diagnostics on');
        else document.getElementById('diag-box')?.remove();
      }, 800);
    });
    btn.addEventListener('pointerup', clearHold);
    btn.addEventListener('pointercancel', clearHold);
    btn.addEventListener('pointerleave', clearHold);
  });

  // Drag gestures. The click guard must be registered before the data-action
  // dispatch below so a torn-off drag never also taps the button open.
  const historyHandle = root.querySelector('.history-handle');
  if (historyHandle) {
    historyHandle.addEventListener('click', e => {
      if (dragConsumedClick) {
        dragConsumedClick = false;
        e.preventDefault();
        e.stopPropagation();
      }
    });
    historyHandle.addEventListener('pointerdown', e => startHandleDrag(e, historyHandle));
  }
  const grip = root.querySelector('.sheet-grip');
  if (grip) {
    // A plain tap on the grip lowers the pane (same animated dismissal as a
    // pull-down swipe); a tap that was actually the end of a drag is absorbed.
    grip.addEventListener('click', e => {
      if (dragConsumedClick) {
        dragConsumedClick = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      dismissGripTap(grip);
    });
    grip.addEventListener('pointerdown', e => startGripDrag(e, grip));
  }

  // Sheet backdrop click to dismiss. Confirmation dialogs dismiss = cancel.
  const sheetLayers = [
    ...(root.matches?.('.sheet-layer') ? [root] : []),
    ...root.querySelectorAll('.sheet-layer'),
  ];
  sheetLayers.forEach(layer => {
    layer.addEventListener('click', e => {
      if (e.target !== layer) return;
      if (layer.classList.contains('dialog-layer')) {
        pendingConfirm = null;
        renderSheet();
        return;
      }
      if (sheet !== 'onboarding' || state.budget) {
        sheet = null;
        renderSheet();
      }
    });
  });

  // Keyboard users land on the safe choice when a confirmation opens.
  const neutralButton = root.querySelector('.confirm-neutral');
  if (neutralButton && document.activeElement && document.activeElement.tagName !== 'BUTTON') {
    neutralButton.focus();
  }

  root.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => action(button.dataset.action)));
  root.querySelectorAll('[data-key]').forEach(button => button.addEventListener('click', () => key(button.dataset.key)));
  root.querySelectorAll('[data-tag]').forEach(button => button.addEventListener('click', () => { editorComment = button.dataset.tag; render(); }));
  root.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => beginEdit(button.dataset.edit)));
  root.querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', () => remove(button.dataset.delete)));
  const currencySelect = root.querySelector('#wallet-form [name="currency"]');
  currencySelect?.addEventListener('change', () => {
    const hint = root.querySelector('.currency-name-hint');
    if (hint) hint.textContent = currencyName(currencySelect.value);
  });

  // History search input
  const searchInput = root.querySelector('#history-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', e => {
      historySearch = e.target.value;
      const historyContent = searchInput.closest('.history-content');
      if (historyContent) {
        const parent = historyContent.parentElement;
        if (parent) {
          const isPane = parent.classList.contains('history-pane');
          parent.innerHTML = isPane ? `<div class="history-top"><div class="mark"><img src="icons/money-bags.svg" alt=""/><span>Budget Tool</span></div><button class="round-button" data-action="settings" aria-label="Settings">${icon('settings')}</button></div>${history(false)}` : history();
          bind(parent);
          const nextInput = document.getElementById('history-search-input');
          if (nextInput) {
            nextInput.focus();
            nextInput.setSelectionRange(historySearch.length, historySearch.length);
          }
        }
      }
    });
  }

  root.querySelectorAll('input').forEach(input => {
    input.addEventListener('input', () => {
      if (input.id === 'comment') editorComment = input.value;
      if (input.id === 'edit-date') {
        editorDate = input.value > today() ? today() : input.value;
        input.value = editorDate;
      }
      if (input.id === 'edit-time') editorTime = input.value;
    });
    if (input.id === 'comment') {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          input.blur();
        }
      });
    }
  });
  root.querySelector('#wallet-form')?.addEventListener('submit', freshSaveWallet);
}

function key(value) {
  haptic(8);
  let changed = true;
  if (value === 'backspace') {
    rawValue = rawValue.slice(0, -1);
  } else if (value === '.' && !rawValue.includes('.')) {
    rawValue += '.';
  } else if (value !== '.') {
    rawValue += value;
  } else {
    changed = false;
  }
  if (rawValue.length > 12) rawValue = rawValue.slice(0, 12);
  if (changed) {
    updateEditorPreview();
    // Subtle scale "pop" on entry (not on backspace) so the number feels alive.
    if (value !== 'backspace') popAmount();
  }
}

function popAmount() {
  document.querySelectorAll('.amount-display').forEach(element => {
    element.classList.remove('amount-in');
    void element.offsetWidth;
    element.classList.add('amount-in');
  });
}

// Number entry is the hottest interaction in the app. Updating only the values
// that change avoids destroying and recreating the toolbar (and its text) on
// every keypress.
function updateEditorPreview() {
  const active = Boolean(rawValue || editorComment || editingId);
  const amount = rawValue || '0';
  const pillDisplayValue = pillDisplay();

  document.querySelectorAll('.amount-display').forEach(element => { element.textContent = amount; });
  document.querySelectorAll('.amount-label').forEach(element => { element.textContent = editingId ? 'editing spend' : active ? 'current spend' : 'enter a spend'; });
  document.querySelectorAll('.budget-pill').forEach(pill => {
    pill.classList.toggle('over', pillDisplayValue.isOverdraft);
    pill.querySelector('.pill-status').textContent = pillDisplayValue.status;
    pill.querySelector('strong').textContent = pillDisplayValue.value;
    pill.querySelector('i').style.width = `${pillDisplayValue.progress}%`;
  });
}

function action(value) {
  haptic(10);
  if (value === 'new-period') {
    if (state.budget) {
      pendingConfirm = { value: 'new-period' };
      renderSheet();
    } else {
      startingNewPeriod = true;
      sheet = 'onboarding';
      render();
    }
    return;
  }
  if (value === 'finish') {
    pendingConfirm = { value: 'finish' };
    renderSheet();
    return;
  }
  if (value === 'cancel-confirm') {
    pendingConfirm = null;
    renderSheet();
    return;
  }
  if (value === 'confirm-dialog') {
    const confirmed = pendingConfirm ? pendingConfirm.value : null;
    pendingConfirm = null;
    if (confirmed === 'new-period') {
      startingNewPeriod = true;
      sheet = 'onboarding';
    } else if (confirmed === 'finish') {
      state = defaultState();
      save();
      sheet = 'onboarding';
    }
  }
  const sheetAction = ['settings', 'wallet', 'history', 'analytics', 'theme', 'close'].includes(value);
  if (value === 'settings') sheet = 'settings';
  if (value === 'wallet') sheet = 'wallet';
  if (value === 'history') sheet = 'history';
  if (value === 'analytics') sheet = 'analytics';
  if (value === 'theme') sheet = 'theme';
  if (value === 'close') { sheet = null; pendingConfirm = null; }
  if (sheetAction) {
    renderSheet();
    return;
  }
  if (value === 'cancel-edit') resetEditor();
  if (value === 'commit') commit();
  if (value === 'undo') undoDelete();
  if (value === 'clear-search') { historySearch = ''; render(); }
  if (value === 'export') exportCsv();
  if (value === 'comment-done') { document.getElementById('comment')?.blur(); }
  if (value.startsWith('set-theme:')) { state.theme = value.replace('set-theme:', ''); save(); sheet = null; show('Theme updated'); }
  render();
}

function beginEdit(id) {
  const item = spends().find(entry => entry.id === id);
  if (!item) return;
  editingId = id;
  rawValue = String(item.value);
  editorComment = item.comment || '';
  editorDate = item.date;
  editorTime = item.time || nowTime();
  sheet = null;
  render();
}
function resetEditor() {
  editingId = null;
  rawValue = '';
  editorComment = '';
  editorDate = today();
  editorTime = nowTime();
  render();
}
function commit() {
  const value = normalize(rawValue);
  if (!value) {
    if (editingId) remove(editingId);
    return;
  }
  if (editingId) {
    const old = spends().find(item => item.id === editingId);
    state.transactions = state.transactions.filter(item => item.id !== editingId);
    accountRemove(old);
  }
  const item = {
    id: uid(),
    type: 'SPENT',
    value,
    date: editingId ? (editorDate > today() ? today() : editorDate) : today(),
    time: editingId ? editorTime : nowTime(),
    comment: editorComment.trim(),
  };
  state.transactions.push(item);
  accountAdd(item);
  save();
  show('Spend recorded');
  resetEditor();
}
function accountAdd(item) {
  if (item.date === today()) {
    state.spentFromDailyBudget = normalize(Number(state.spentFromDailyBudget || 0) + item.value);
  } else {
    state.dailyBudget = normalize(Number(state.dailyBudget || 0) - item.value / daysLeft());
  }
}
function accountRemove(item) {
  if (!item) return;
  if (item.date === today()) {
    state.spentFromDailyBudget = normalize(Number(state.spentFromDailyBudget || 0) - item.value);
  } else {
    state.dailyBudget = normalize(Number(state.dailyBudget || 0) + item.value / daysLeft());
  }
}

function redistributeDailyBudget() {
  // Spare or overspent money is always spread across the remaining days,
  // including today. Use remaining + today's spends so a late first-open of
  // the day still yields the same daily allowance the pill previewed yesterday.
  const days = Math.max(1, daysLeft());
  state.dailyBudget = normalize((remainingBudget() + todaySpent()) / days);
  state.spentFromDailyBudget = normalize(todaySpent());
  state.appliedDailyDate = today();
}

function applyRolloverIfNeeded() {
  if (!state.budget || daysLeft() <= 0) return false;
  if (!state.appliedDailyDate || state.appliedDailyDate === today()) return false;
  redistributeDailyBudget();
  save();
  return true;
}

function reconcileDerivedState() {
  // Keep the daily display correct after reopening the app or crossing into a
  // new day. The total remaining budget itself is always derived from spends.
  const actualTodaySpent = normalize(todaySpent());
  const previousSpent = normalize(state.spentFromDailyBudget);
  const previousDay = state.appliedDailyDate;
  const newCalendarDay = previousDay ? previousDay !== today() : previousSpent !== actualTodaySpent && actualTodaySpent === 0;

  state.spentFromDailyBudget = actualTodaySpent;
  if (!previousDay) state.appliedDailyDate = today();

  if (newCalendarDay && state.budget && daysLeft() > 0) {
    redistributeDailyBudget();
    save();
    return;
  }

  if (previousSpent !== actualTodaySpent || !previousDay) {
    save();
  }
}

function refreshHistoryViews() {
  document.querySelectorAll('.history-content').forEach(content => {
    const replacement = document.createRange().createContextualFragment(history(false)).firstElementChild;
    content.replaceWith(replacement);
    bind(replacement);
  });
  document.querySelectorAll('.history-handle').forEach(handle => {
    handle.innerHTML = '<span></span>';
  });
}

function remove(id) {
  const item = spends().find(entry => entry.id === id);
  if (!item) return;
  lastDeleted = item;
  accountRemove(item);
  state.transactions = state.transactions.filter(entry => entry.id !== id);
  save();
  show('Spend deleted', true);
  refreshHistoryViews();
  updateEditorPreview();
}

function undoDelete() {
  if (!lastDeleted) return;
  state.transactions.push(lastDeleted);
  accountAdd(lastDeleted);
  save();
  const restored = lastDeleted;
  lastDeleted = null;
  show('Spend restored');
  render();
}

function csvSafe(value) {
  // Prevent spreadsheet formula injection: cells that begin with a formula
  // operator are neutralized so they are not evaluated when the CSV is opened
  // in a spreadsheet application.
  const str = String(value);
  return /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
}
function exportCommitTime(item) {
  const timestamp = new Date(`${item.date}T${item.time || '00:00'}:00`);
  if (Number.isNaN(timestamp.getTime())) return fullDate(item.date);
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(timestamp);
}
function exportCsv() {
  const rows = [
    ['amount', 'comment', 'commit_time'],
    ...spends()
      .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))
      .map(item => [item.value, item.comment || '', exportCommitTime(item)]
        .map(value => `"${csvSafe(String(value)).replaceAll('"', '""')}"`)),
  ];
  const blob = new Blob([rows.map(row => row.join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `budget-tool-${state.startDate}-${state.finishDate}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  show('CSV exported');
}

function show(message, hasUndo = false) {
  clearTimeout(toastTimer);
  const toast = document.getElementById('toast');
  if (toast) {
    toast.innerHTML = `<span>${escapeHtml(message)}</span>${hasUndo ? `<button class="toast-action" data-action="undo">Undo</button>` : ''}`;
    toast.classList.add('show');
    const undoBtn = toast.querySelector('[data-action="undo"]');
    if (undoBtn) undoBtn.addEventListener('click', () => action('undo'));
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
      if (hasUndo) lastDeleted = null;
    }, hasUndo ? 4500 : 2400);
  }
}

function escapeHtml(value) {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(value).replace(/[&<>"']/g, character => entities[character]);
}
function escapeAttr(value) {
  return escapeHtml(value);
}

function sheetTitle(title, { lead = '<span></span>', trailing = '', className = '' } = {}) {
  const cls = className ? `sheet-title ${className}` : 'sheet-title';
  return `<div class="${cls}">${lead}<h2>${title}</h2>${trailing}</div>`;
}
function sheetRowLead(symbol) {
  return ICONS[symbol] ? icon(symbol) : `<span class="settings-symbol">${symbol}</span>`;
}
function sheetRow({ action, symbol, title, detail, trailing = '', danger = false }) {
  const cls = danger ? 'sheet-row danger' : 'sheet-row';
  return `<button class="${cls}" data-action="${action}">${sheetRowLead(symbol)}<span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></span>${trailing}</button>`;
}
function freshSettingsSheet() {
  const walletDetail = state.budget ? money(state.budget) : 'Set a period';
  const themeDetail = state.theme === 'system' ? 'Follow system' : state.theme === 'dark' ? 'Dark' : 'Light';
  return '<div class="sheet-layer"><section class="sheet">'
    + '<span class="sheet-grip"></span>'
    + sheetTitle('Settings', { lead: `<button class="round-button" data-action="close" aria-label="Close">${icon('back')}</button>` })
    + sheetRow({ action: 'wallet', symbol: 'wallet', title: 'Wallet', detail: walletDetail, trailing: icon('edit') })
    + sheetRow({ action: 'new-period', symbol: '＋', title: 'New period', detail: 'Start over with a fresh budget', danger: true })
    + sheetRow({ action: 'theme', symbol: '◐', title: 'Theme', detail: themeDetail })
    + sheetRow({ action: 'analytics', symbol: 'chart', title: 'Analytics', detail: 'See spending patterns' })
    + sheetRow({ action: 'export', symbol: 'download', title: 'Export CSV', detail: 'Save every spend' })
    + '<div class="about-copy">Budget Tool Web<br><small>Private, local, and offline.</small></div>'
    + '</section></div>';
}

function currencyOption(code, selected) {
  const label = `${code} — ${currencyName(code)}`;
  return `<option value="${escapeAttr(code)}" ${selected === code ? 'selected' : ''}>${escapeHtml(label)}</option>`;
}
function currencyOptions() {
  const selected = state.currency || 'USD';
  return currencyOption('NONE', selected) + supportedCurrencies().map(code => currencyOption(code, selected)).join('');
}

function freshWalletSheet() {
  const fresh = !state.budget || startingNewPeriod;
  const backButton = `<button type="button" class="round-button" data-action="close" aria-label="Close">${icon('back')}</button>`;
  const applyButton = '<button class="text-submit" type="submit">Apply</button>';
  const periodLabel = fresh ? 'new period' : 'edit period';
  const budgetValue = fresh ? '' : state.budget;
  const startValue = fresh ? today() : state.startDate;
  const extraActions = fresh ? '' : '<button type="button" class="sheet-row danger" data-action="finish">Finish period early</button>'
    + `<button type="button" class="sheet-row" data-action="export">${icon('download')} Export spends to CSV</button>`;
  return '<div class="sheet-layer"><form class="sheet" id="wallet-form">'
    + '<span class="sheet-grip"></span>'
    + sheetTitle('Wallet', { lead: backButton, trailing: applyButton })
    + `<p class="section-label">${periodLabel}</p>`
    + `<label class="field-label">Budget<input name="budget" type="number" min="0.01" step="0.01" value="${escapeAttr(budgetValue)}" required></label>`
    + '<div class="form-grid">'
    + `<label class="field-label">Starts<input name="startDate" type="date" value="${escapeAttr(startValue)}" required></label>`
    + `<label class="field-label">Finishes<input name="finishDate" type="date" min="${escapeAttr(today())}" value="${escapeAttr(state.finishDate)}" required></label>`
    + '</div>'
    + '<div class="form-grid">'
    + `<label class="field-label">Currency<select name="currency" class="currency-select">${currencyOptions()}</select><span class="currency-name-hint">${escapeHtml(currencyName(state.currency || 'USD'))}</span></label>`
    + '</div>'
    + extraActions
    + '</form></div>';
}

function freshSaveWallet(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const nextBudget = normalize(data.get('budget'));
  const start = data.get('startDate');
  const finish = data.get('finishDate');
  if (!nextBudget || finish < today() || finish < start) return;
  const isNew = !state.budget || startingNewPeriod;
  if (isNew) {
    state.transactions = [{ id: uid(), type: 'INCOME', value: nextBudget, date: start, time: '00:00', comment: '' }];
    state.spentFromDailyBudget = 0;
    state.dailyBudget = normalize(nextBudget / daysBetween(start, finish));
    state.startDate = start;
  } else {
    const oldIncome = state.transactions.find(item => item.type === 'INCOME');
    if (oldIncome) oldIncome.value = nextBudget;
    const budgetChanged = nextBudget !== state.budget;
    const dateChanged = start !== state.startDate || finish !== state.finishDate;
    if (budgetChanged || dateChanged) {
      // Redistribute over the remaining days. Today's own spend stays out of the
      // pool because the "left today" figure subtracts it again — keeping it in
      // would shrink today's allowance whenever the change is smaller than what
      // has already been spent today (double-subtraction). This mirrors
      // redistributeDailyBudget(), which adds todaySpent() back for the same reason.
      const totalSpent = spends().reduce((total, item) => total + Number(item.value), 0);
      const spentToday = todaySpent();
      const remaining = Math.max(0, nextBudget - (totalSpent - spentToday));
      const days = Math.max(1, daysBetween(today(), finish));
      state.dailyBudget = normalize(remaining / days);
      state.spentFromDailyBudget = 0;
    }
    state.startDate = start;
  }
  state.budget = nextBudget;
  state.finishDate = finish;
  state.currency = data.get('currency');
  state.appliedDailyDate = today();
  state.finishPeriodActualDate = null;
  startingNewPeriod = false;
  save();
  sheet = null;
  show('Wallet saved');
  render();
}
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (state.theme === 'system') render(); });

// Global physical keyboard support & Escape to dismiss
window.addEventListener('keydown', e => {
  const activeEl = document.activeElement;
  const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT');

  if (e.key === 'Escape') {
    if (pendingConfirm) {
      pendingConfirm = null;
      render();
      return;
    }
    if (sheet) {
      if (sheet !== 'onboarding' || state.budget) {
        sheet = null;
        render();
      }
    } else if (editingId) {
      resetEditor();
    }
    return;
  }

  if (isInput) return;

  if (e.key >= '0' && e.key <= '9') {
    e.preventDefault();
    key(e.key);
  } else if (e.key === '.' || e.key === ',') {
    e.preventDefault();
    key('.');
  } else if (e.key === 'Backspace') {
    e.preventDefault();
    key('backspace');
  } else if (e.key === 'Enter') {
    e.preventDefault();
    commit();
  }
});

// App Shortcut Hash Handling
function handleHash() {
  const hash = window.location.hash;
  if (hash === '#history') {
    sheet = 'history';
  } else if (hash === '#analytics') {
    sheet = 'analytics';
  }
}
window.addEventListener('hashchange', () => { handleHash(); render(); });
handleHash();
document.addEventListener('visibilitychange', () => {
  diag(`visibilitychange:${document.visibilityState}`);
  if (document.visibilityState === 'hidden') {
    resetGestureState();
    wasBackgrounded = true;
  } else if (document.visibilityState === 'visible') {
    resetGestureState();
    render();
    wasBackgrounded = false;
  }
});
// iOS does not always fire `visibilitychange` when a PWA is restored after
// backgrounding (page restored from the back/forward cache, or the app is
// recalled directly). Rebuild bindings on those return paths too so the sheet
// never sits with dead controls.
window.addEventListener('focus', () => {
  diag('window-focus');
  if (wasBackgrounded) {
    resetGestureState();
    render();
    wasBackgrounded = false;
  }
});
window.addEventListener('pageshow', (event) => {
  diag(`pageshow:persisted=${event.persisted}`);
  if (event.persisted) {
    resetGestureState();
    render();
  }
});
// Page-wide event watch for the diagnostic overlay (capture phase so it runs
// before any consumer): proves whether the page still receives input at all.
document.addEventListener('pointerdown', (e) => diag('pointerdown', e.target), true);
document.addEventListener('click', (e) => diag('click', e.target), true);
// Document-level delegation for dismissing sheets, registered once at startup
// so it survives every re-render and rebind (iOS can return from the
// background with per-element listeners misbehaving while the page itself is
// still running, e.g. the wallet "Apply" submit keeps working but the pane's
// close button stops responding). A single bubble-phase listener on document
// catches grip taps, back-arrow taps, and backdrop taps no matter what state
// the per-element bindings are in. Back arrows are matched directly, not only
// inside `.sheet-stack`, because a pane rebuilt by a full render() (as happens
// when returning from the background) has no stack wrapper.
document.addEventListener('click', (event) => {
  if (!sheet && !pendingConfirm) return;
  const target = event.target;
  if (!target || typeof target.closest !== 'function') return;
  diag('delegate click', target);
  const grip = target.closest('.sheet-grip');
  if (grip) {
    diag('delegate grip');
    if (dragConsumedClick) {
      dragConsumedClick = false;
      return;
    }
    if (pendingConfirm || sheet === 'onboarding' && !state.budget) return;
    dismissGripTap(grip);
    return;
  }
  const closeButton = target.closest('[data-action="close"]');
  if (closeButton) {
    diag('delegate close', closeButton);
    action('close');
    return;
  }
  const layer = target.closest('.sheet-layer');
  if (layer && target === layer) {
    diag('delegate backdrop');
    if (layer.classList.contains('dialog-layer')) {
      pendingConfirm = null;
      renderSheet();
      return;
    }
    if (sheet !== 'onboarding' || state.budget) {
      sheet = null;
      renderSheet();
    }
  }
});
setInterval(() => {
  if (state.appliedDailyDate && state.appliedDailyDate !== today()) render();
}, 60000);

reconcileDerivedState();

render();
