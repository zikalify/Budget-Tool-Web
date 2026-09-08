const STORAGE_KEY = 'budget-tool-web-state';
const today = () => new Date().toISOString().slice(0, 10);
const nowTime = () => new Date().toTimeString().slice(0, 5);
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const dateValue = value => new Date(`${value}T12:00:00`);
const dateLabel = value => new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(dateValue(value));
const fullDate = value => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(dateValue(value));
const money = (value, currency = state.currency || 'USD') => currency === 'NONE' ? Number(value || 0).toFixed(2) : new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value) || 0);
const daysBetween = (from, to) => Math.max(1, Math.floor((dateValue(to) - dateValue(from)) / 86400000) + 1);
const addDays = (value, amount) => { const result = dateValue(value); result.setDate(result.getDate() + amount); return result.toISOString().slice(0, 10); };
const defaultState = () => ({ budget: 0, dailyBudget: 0, spentFromDailyBudget: 0, startDate: today(), finishDate: addDays(today(), 30), finishPeriodActualDate: null, currency: 'USD', distribution: 'ASK', hideOverspendingWarn: false, transactions: [], theme: 'system' });
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

function haptic(ms = 10) {
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(ms);
    }
  } catch {}
}

function loadState() { try { return { ...defaultState(), ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }; } catch { return defaultState(); } }
function save() {
  // Persist a repairable derived value, never a stale one. This covers every
  // mutation path that writes the ledger, including edits, deletes, and undo.
  state.spentFromDailyBudget = normalize(todaySpent());
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
function spends() { return state.transactions.filter(item => item.type === 'SPENT'); }
function income() { return state.transactions.filter(item => item.type === 'INCOME').reduce((total, item) => total + Number(item.value), 0); }
function totalSpent() { return spends().reduce((total, item) => total + Number(item.value), 0); }
function todaySpent() { return spends().filter(item => item.date === today()).reduce((total, item) => total + Number(item.value), 0); }
// The ledger is the source of truth. Never derive the total remaining budget
// from the persisted daily counter: that counter can be stale after an edit,
// deletion, restore, or a new calendar day.
function remainingBudget() {
  const budget = Math.max(0, Number(state.budget) || 0);
  const calculated = budget - totalSpent();
  return Math.max(0, Math.min(budget, calculated));
}
function daysLeft() { return state.finishDate ? daysBetween(today(), state.finishDate) : 0; }
function restToday() { return Number(state.dailyBudget || 0) - Number(state.spentFromDailyBudget || 0) - (Number(rawValue) || 0); }
function normalize(value) { const parsed = Number.parseFloat(value); return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0; }
function icon(name) { const icons = { settings: '<path d="M9.7 3.5 10.5 2h3l.8 1.5 1.7.7 1.7-.4 2.1 2.1-.4 1.7.7 1.7 1.5.8v3l-1.5.8-.7 1.7.4 1.7-2.1 2.1-1.7-.4-1.7.7-.8 1.5h-3l-.8-1.5-1.7-.7-1.7.4-2.1-2.1.4-1.7-.7-1.7L2 13.1v-3l1.5-.8.7-1.7-.4-1.7 2.1-2.1 1.7.4 1.7-.7Z"/><circle cx="12" cy="11.6" r="2.8"/>', wallet: '<path d="M4 7h16v12H4zM4 7l2-3h12l2 3M16 13h4"/>', back: '<path d="m15 18-6-6 6-6"/>', calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', edit: '<path d="m4 16-1 5 5-1L20 8l-4-4L4 16Z"/>', trash: '<path d="M5 7h14m-9 4v5m4-5v5M8 7l1-3h6l1 3m-9 0 1 14h8l1-14"/>', chart: '<path d="M4 19V5m0 14h16M8 16v-4m4 4V8m4 8v-7"/>', download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4M4 20h16"/>', check: '<path d="M20 6 9 17l-5-5"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>' }; return `<svg viewBox="0 0 24 24">${icons[name] || ''}</svg>`; }

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

function render() {
  // Rendering replaces the app markup. Keep an already-open sheet still during
  // state updates (for example, deleting a spend from History) instead of
  // replaying its entrance animation.
  const preserveSheetMotion = Boolean(sheet && sheet === renderedSheet);
  const effectiveTheme = state.theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : state.theme;
  document.body.dataset.theme = effectiveTheme;
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute('content', effectiveTheme === 'dark' ? '#111410' : '#f7fbf2');
  }
  document.getElementById('app').innerHTML = `<div class="app-root${preserveSheetMotion ? ' preserve-motion' : ''}"><div class="clone-shell">${desktopHistory()}<main class="editor-page">${editor()}${keyboard()}</main></div>${sheet ? sheetView() : ''}<div id="toast" class="toast"></div></div>`;
  renderedSheet = sheet;
  bind();
}

// Sheets sit above the editor. Changing one must not recreate the editor below
// it, otherwise the balance value visibly jumps as the sheet opens.
function renderSheet() {
  const root = document.querySelector('#app > .app-root');
  const toast = document.getElementById('toast');
  if (!root || !toast) {
    render();
    return;
  }
  root.querySelector('.sheet-layer')?.remove();
  if (sheet) {
    toast.insertAdjacentHTML('beforebegin', sheetView());
    bind(toast.previousElementSibling);
  }
  renderedSheet = sheet;
}
function desktopHistory() { return `<aside class="history-pane"><div class="history-top"><div class="mark"><img src="icons/money-bags.svg" alt=""/><span>Budget Tool</span></div><button class="round-button" data-action="settings" aria-label="Settings">${icon('settings')}</button></div>${history(false)}</aside>`; }
function editor() { const mode = editingId ? 'EDIT' : 'ADD'; const active = Boolean(rawValue || editorComment || editingId); return `<section class="editor-shell"><header class="editor-toolbar">${mode === 'EDIT' ? `<button class="round-button" data-action="cancel-edit" aria-label="Cancel edit">${icon('back')}</button>` : `<span class="editor-spacer"></span>`}<button class="budget-pill ${restToday() < 0 ? 'over' : ''}" data-action="wallet"><span class="pill-status">${state.budget ? (restToday() < 0 ? 'over budget' : 'left today') : 'set period'}</span><strong>${state.budget ? money(restToday()) : money(0)}</strong><i style="width:${Math.max(0, Math.min(100, state.dailyBudget ? (restToday() / state.dailyBudget) * 100 : 0))}%"></i></button><button class="round-button" data-action="settings" aria-label="Settings">${icon('settings')}</button></header><section class="amount-area"><span class="amount-label">${mode === 'EDIT' ? 'editing spend' : active ? 'current spend' : 'enter a spend'}</span><strong class="amount-display">${rawValue || '0'}</strong><span class="currency-label">${state.currency === 'NONE' ? '' : state.currency}</span></section>${mode === 'EDIT' ? dateEditor() : tagging()}${historyToggle()}</section>`; }
function tagging() { const tags = [...new Set(spends().map(item => item.comment).filter(Boolean))].reverse(); return `<div class="tagging-wrapper"><div class="tagging"><input id="comment" value="${escapeAttr(editorComment)}" placeholder="Add a note" autocomplete="off"><button class="comment-done" data-action="comment-done">${icon('check')}</button></div>${tags.length ? `<div class="tag-list">${tags.map(tag => `<button data-tag="${escapeAttr(tag)}">${escapeHtml(tag)}</button>`).join('')}</div>` : ''}</div>`; }
function dateEditor() { return `<div class="date-editor"><label>${icon('calendar')}<input id="edit-date" type="date" min="${state.startDate}" max="${today()}" value="${editorDate > today() ? today() : editorDate}"></label><label>${icon('clock')}<input id="edit-time" type="time" value="${editorTime}"></label></div><div class="tagging-wrapper"><div class="tagging"><input id="comment" value="${escapeAttr(editorComment)}" placeholder="Add a note"><button class="comment-done" data-action="comment-done">${icon('check')}</button></div></div>`; }
function historyToggle() { return `<button class="history-handle" data-action="history" aria-label="Open history"><span></span></button>`; }
function keyboard() { return `<section class="keyboard"><div class="key-grid"><button class="key" data-key="7">7</button><button class="key" data-key="8">8</button><button class="key" data-key="9">9</button><button class="key secondary-key" data-key="backspace">⌫</button><button class="key" data-key="4">4</button><button class="key" data-key="5">5</button><button class="key" data-key="6">6</button><span></span><button class="key" data-key="1">1</button><button class="key" data-key="2">2</button><button class="key" data-key="3">3</button><button class="key apply-key" data-action="commit">✓</button><button class="key zero-key" data-key="0">0</button><button class="key" data-key=".">.</button></div></section>`; }
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
        <div class="date-divider"><strong>${dateLabel(date)}</strong><span>${money(items.reduce((sum, item) => sum + Number(item.value), 0))}</span></div>
        ${items.map(item => `
          <div class="spent-row">
            <div class="spent-mark">−</div>
            <div class="spent-copy">
              <strong>${money(item.value)}</strong>
              <span>${item.time || ''}${item.comment ? ` · ${escapeHtml(item.comment)}` : ''}</span>
            </div>
            ${readOnly ? '' : `
              <button class="row-action" data-edit="${item.id}" aria-label="Edit spend">${icon('edit')}</button>
              <button class="row-action danger" data-delete="${item.id}" aria-label="Delete spend">${icon('trash')}</button>
            `}
          </div>
        `).join('')}
      </section>
    `).join('') || `<div class="history-empty">${query ? 'No matching spends found.' : 'Your spends will appear here.'}</div>`}
  </section>`;
}
function sheetView() { if (sheet === 'onboarding') return `<div class="sheet-layer"><section class="sheet onboarding"><span class="sheet-grip"></span><p class="section-label">welcome</p><h2>Hello.</h2><p class="sheet-copy">Budget Tool helps you spend money wisely by giving you a clear amount for each day.</p><ol><li><b>1</b><span><strong>Set a period budget</strong><small>Choose your total and finish date.</small></span></li><li><b>2</b><span><strong>Record spends</strong><small>Write down what leaves your wallet.</small></span></li><li><b>3</b><span><strong>See what remains</strong><small>Keep your daily number visible.</small></span></li></ol><button class="primary full" data-action="wallet">Set period</button></section></div>`;
  if (sheet === 'wallet') return freshWalletSheet();
  if (sheet === 'settings') return freshSettingsSheet();
  if (sheet === 'history') return `<div class="sheet-layer"><section class="sheet history-sheet"><span class="sheet-grip"></span><div class="sheet-title history-sheet-title"><span></span><h2>History</h2><button class="round-button" data-action="close" aria-label="Close history">×</button></div>${history()}</section></div>`;
  if (sheet === 'analytics') return analyticsSheet();
  if (sheet === 'distribution') return distributionSheet();
  if (sheet === 'recalc') return recalcSheet();
  if (sheet === 'theme') return themeSheet();
  return '';
}
function walletSheet() { return `<div class="sheet-layer"><form class="sheet" id="wallet-form"><span class="sheet-grip"></span><div class="sheet-title"><button type="button" class="round-button" data-action="close">${icon('back')}</button><h2>Wallet</h2><button class="text-submit" type="submit">Apply</button></div><p class="section-label">${state.budget ? 'edit period' : 'new period'}</p><label class="field-label">Budget<input name="budget" type="number" min="0.01" step="0.01" value="${state.budget || ''}" required></label><div class="form-grid"><label class="field-label">Starts<input name="startDate" type="date" value="${state.budget ? state.startDate : today()}" required></label><label class="field-label">Finishes<input name="finishDate" type="date" min="${today()}" value="${state.finishDate}" required></label></div><label class="field-label">Currency<select name="currency"><option value="NONE" ${state.currency === 'NONE' ? 'selected' : ''}>No currency symbol</option>${supportedCurrencies().map(code => `<option value="${code}" ${state.currency === code ? 'selected' : ''}>${code} — ${currencyName(code)}</option>`).join('')}</select></label>${state.budget ? `<button type="button" class="sheet-row danger" data-action="finish">Finish period early</button><button type="button" class="sheet-row" data-action="export">${icon('download')} Export spends to CSV</button>` : ''}</form></div>`; }
function settingsSheet() { return `<div class="sheet-layer"><section class="sheet"><span class="sheet-grip"></span><div class="sheet-title"><span></span><h2>Settings</h2><button class="round-button" data-action="close">×</button></div><button class="sheet-row" data-action="wallet">${icon('wallet')}<span><strong>Wallet</strong><small>${state.budget ? money(state.budget) : 'Set a period'}</small></span>${icon('edit')}</button><button class="sheet-row" data-action="theme"><span class="settings-symbol">◐</span><span><strong>Theme</strong><small>${state.theme === 'dark' ? 'Dark' : 'Light'}</small></span></button><button class="sheet-row" data-action="recalc"><span class="settings-symbol">↻</span><span><strong>Unused daily budget</strong><small>${state.distribution === 'REST' ? 'Split to rest days' : state.distribution === 'ADD_TODAY' ? 'Add to today' : 'Always ask'}</small></span></button><button class="sheet-row" data-action="analytics">${icon('chart')}<span><strong>Analytics</strong><small>See spending patterns</small></span></button><button class="sheet-row" data-action="export">${icon('download')}<span><strong>Export CSV</strong><small>Save every spend</small></span></button><div class="about-copy">Budget Tool Web<br><small>Private, local, and offline.</small></div></section></div>`; }
function distributionSheet() { const choices = [['ASK', 'Always ask', 'Choose each time a new day starts.'], ['REST', 'Split to rest days', 'Spread unused money across the remaining days.'], ['ADD_TODAY', 'Add to today', 'Give today the unused money.']]; return `<div class="sheet-layer"><section class="sheet distribution-sheet"><span class="sheet-grip"></span><div class="sheet-title"><button class="round-button" data-action="close" aria-label="Back">${icon('back')}</button><h2>Unused daily budget</h2><span></span></div><p class="sheet-copy">Choose what Buckwheat should do with money left at the end of a day.</p>${choices.map(([value, title, description]) => `<button class="distribution-choice ${state.distribution === value ? 'selected' : ''}" data-distribution="${value}"><span class="choice-radio"></span><span><strong>${title}</strong><small>${description}</small></span></button>`).join('')}</section></div>`; }
function analyticsSheet() { const list = spends(); const amounts = list.map(item => Number(item.value)); const min = list.length ? list.reduce((a, b) => Number(a.value) < Number(b.value) ? a : b) : null; const max = list.length ? list.reduce((a, b) => Number(a.value) > Number(b.value) ? a : b) : null; const tags = {}; list.forEach(item => tags[item.comment || 'without tag'] = (tags[item.comment || 'without tag'] || 0) + Number(item.value)); return `<div class="sheet-layer"><section class="sheet analytics-sheet"><span class="sheet-grip"></span><div class="sheet-title"><button class="round-button" data-action="close">${icon('back')}</button><h2>Analytics</h2><button class="round-button" data-action="export">${icon('download')}</button></div><article class="analytics-budget"><span class="section-label">whole budget</span><strong>${money(state.budget)}</strong><small>${fullDate(state.startDate)} – ${fullDate(state.finishDate)}</small></article><div class="stat-grid"><article><span>remaining</span><strong>${money(remainingBudget())}</strong></article><article><span>spent</span><strong>${money(totalSpent())}</strong></article><article><span>days left</span><strong>${daysLeft()}</strong></article><article><span>spends</span><strong>${list.length}</strong></article></div>${min ? `<div class="minmax"><article><span>minimum spend</span><strong>${money(min.value)}</strong><small>${dateLabel(min.date)}${min.comment ? ` · ${escapeHtml(min.comment)}` : ''}</small></article><article><span>maximum spend</span><strong>${money(max.value)}</strong><small>${dateLabel(max.date)}${max.comment ? ` · ${escapeHtml(max.comment)}` : ''}</small></article></div>` : ''}<div class="analytics-block"><span class="section-label">categories</span>${Object.entries(tags).sort((a, b) => b[1] - a[1]).map(([tag, amount]) => `<div class="category-row"><span>${escapeHtml(tag)}</span><strong>${money(amount)}</strong><i style="width:${amount / Math.max(...Object.values(tags)) * 100}%"></i></div>`).join('') || '<p class="muted">No spends yet.</p>'}</div></section></div>`; }
function recalcSheet() { return `<div class="sheet-layer"><section class="sheet"><span class="sheet-grip"></span><div class="sheet-title"><button class="round-button" data-action="close">${icon('back')}</button><h2>New daily budget</h2><span></span></div><p class="sheet-copy">You have unused money from the previous day. What should happen to it?</p><button class="choice-row" data-recalc="REST"><strong>Split to rest days</strong><small>Spread it across the remaining days.</small></button><button class="choice-row" data-recalc="ADD_TODAY"><strong>Add to today</strong><small>Give today the extra room.</small></button><button class="choice-row" data-recalc="LAST_DAY"><strong>Start the last day</strong><small>Use all remaining money today.</small></button></section></div>`; }
function themeSheet() { const choices = [['system', 'Follow system theme', 'Automatically match your device theme.'], ['light', 'Light theme', 'Always use light mode.'], ['dark', 'Dark theme', 'Always use dark mode.']]; return `<div class="sheet-layer"><section class="sheet distribution-sheet"><span class="sheet-grip"></span><div class="sheet-title"><button class="round-button" data-action="close" aria-label="Back">${icon('back')}</button><h2>Theme</h2><span></span></div><p class="sheet-copy">Choose your preferred appearance.</p>${choices.map(([value, title, description]) => `<button class="distribution-choice ${state.theme === value ? 'selected' : ''}" data-action="set-theme:${value}"><span class="choice-radio"></span><span><strong>${title}</strong><small>${description}</small></span></button>`).join('')}</section></div>`; }

function bind(root = document) {
  root.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('pointerdown', e => {
      createRipple(e);
      haptic(10);
    });
  });

  // Sheet backdrop click to dismiss
  const sheetLayers = [
    ...(root.matches?.('.sheet-layer') ? [root] : []),
    ...root.querySelectorAll('.sheet-layer'),
  ];
  sheetLayers.forEach(layer => {
    layer.addEventListener('click', e => {
      if (e.target === layer) {
        if (sheet !== 'onboarding' || state.budget) {
          sheet = null;
          renderSheet();
        }
      }
    });
  });

  root.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => action(button.dataset.action)));
  root.querySelectorAll('[data-key]').forEach(button => button.addEventListener('click', () => key(button.dataset.key)));
  root.querySelectorAll('[data-tag]').forEach(button => button.addEventListener('click', () => { editorComment = button.dataset.tag; render(); }));
  root.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => beginEdit(button.dataset.edit)));
  root.querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', () => remove(button.dataset.delete)));
  root.querySelectorAll('[data-recalc]').forEach(button => button.addEventListener('click', () => recalc(button.dataset.recalc)));
  root.querySelectorAll('[data-distribution]').forEach(button => button.addEventListener('click', () => { state.distribution = button.dataset.distribution; save(); sheet = null; show('Preference saved'); render(); }));

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
  if (value === 'backspace') rawValue = rawValue.slice(0, -1);
  else if (value === '.' && !rawValue.includes('.')) rawValue += '.';
  else if (value !== '.') rawValue += value;
  if (rawValue.length > 12) rawValue = rawValue.slice(0, 12);
  updateEditorPreview();
}

// Number entry is the hottest interaction in the app. Updating only the values
// that change avoids destroying and recreating the toolbar (and its text) on
// every keypress.
function updateEditorPreview() {
  const active = Boolean(rawValue || editorComment || editingId);
  const amount = rawValue || '0';
  const remaining = restToday();
  const status = state.budget ? (remaining < 0 ? 'over budget' : 'left today') : 'set period';
  const value = state.budget ? money(remaining) : money(0);
  const progress = Math.max(0, Math.min(100, state.dailyBudget ? (remaining / state.dailyBudget) * 100 : 0));

  document.querySelectorAll('.amount-display').forEach(element => { element.textContent = amount; });
  document.querySelectorAll('.amount-label').forEach(element => { element.textContent = editingId ? 'editing spend' : active ? 'current spend' : 'enter a spend'; });
  document.querySelectorAll('.budget-pill').forEach(pill => {
    pill.classList.toggle('over', remaining < 0);
    pill.querySelector('.pill-status').textContent = status;
    pill.querySelector('strong').textContent = value;
    pill.querySelector('i').style.width = `${progress}%`;
  });
}

function action(value) {
  haptic(10);
  const sheetAction = ['settings', 'wallet', 'new-period', 'history', 'analytics', 'recalc', 'theme', 'close'].includes(value);
  if (value === 'settings') sheet = 'settings';
  if (value === 'wallet') sheet = 'wallet';
  if (value === 'new-period') { startingNewPeriod = true; sheet = 'onboarding'; }
  if (value === 'history') sheet = 'history';
  if (value === 'analytics') sheet = 'analytics';
  if (value === 'recalc') sheet = 'distribution';
  if (value === 'theme') sheet = 'theme';
  if (value === 'close') sheet = null;
  if (sheetAction) {
    renderSheet();
    return;
  }
  if (value === 'cancel-edit') resetEditor();
  if (value === 'commit') commit();
  if (value === 'undo') undoDelete();
  if (value === 'clear-search') { historySearch = ''; render(); }
  if (value === 'finish' && confirm('Finish this period now?')) { state = defaultState(); save(); sheet = 'onboarding'; }
  if (value === 'export') exportCsv();
  if (value === 'comment-done') { document.getElementById('comment')?.blur(); }
  if (value.startsWith('set-theme:')) { state.theme = value.replace('set-theme:', ''); save(); sheet = null; show('Theme updated'); }
  render();
}

function beginEdit(id) { const item = spends().find(entry => entry.id === id); if (!item) return; editingId = id; rawValue = String(item.value); editorComment = item.comment || ''; editorDate = item.date; editorTime = item.time || nowTime(); sheet = null; render(); }
function resetEditor() { editingId = null; rawValue = ''; editorComment = ''; editorDate = today(); editorTime = nowTime(); render(); }
function commit() { const value = normalize(rawValue); if (!value) { if (editingId) remove(editingId); return; } if (editingId) { const old = spends().find(item => item.id === editingId); state.transactions = state.transactions.filter(item => item.id !== editingId); accountRemove(old); } const item = { id: uid(), type: 'SPENT', value, date: editingId ? (editorDate > today() ? today() : editorDate) : today(), time: editingId ? editorTime : nowTime(), comment: editorComment.trim() }; state.transactions.push(item); accountAdd(item); save(); show('Spend recorded'); resetEditor(); }
function accountAdd(item) { if (item.date === today()) state.spentFromDailyBudget = normalize(Number(state.spentFromDailyBudget || 0) + item.value); else state.dailyBudget = normalize(Number(state.dailyBudget || 0) - item.value / daysLeft()); }
function accountRemove(item) { if (!item) return; if (item.date === today()) state.spentFromDailyBudget = normalize(Number(state.spentFromDailyBudget || 0) - item.value); else state.dailyBudget = normalize(Number(state.dailyBudget || 0) + item.value / daysLeft()); }

function reconcileDerivedState() {
  // Keep the daily display correct after reopening the app or crossing into a
  // new day. The total remaining budget itself is always derived from spends.
  const actualTodaySpent = normalize(todaySpent());
  if (normalize(state.spentFromDailyBudget) !== actualTodaySpent) {
    state.spentFromDailyBudget = actualTodaySpent;
    save();
  }
}
function saveWallet(event) { event.preventDefault(); const data = new FormData(event.currentTarget); const nextBudget = normalize(data.get('budget')); const start = data.get('startDate'); const finish = data.get('finishDate'); if (!nextBudget || finish < today()) return; const isNew = !state.budget; if (isNew) { state.transactions = [{ id: uid(), type: 'INCOME', value: nextBudget, date: start, time: '00:00', comment: '' }]; state.spentFromDailyBudget = 0; state.dailyBudget = normalize(nextBudget / daysBetween(start, finish)); state.startDate = start; } else { const oldIncome = state.transactions.find(item => item.type === 'INCOME'); if (oldIncome) oldIncome.value = nextBudget; const budgetChanged = nextBudget !== state.budget; const dateChanged = start !== state.startDate || finish !== state.finishDate; if (budgetChanged || dateChanged) { const totalSpent = spends().reduce((total, item) => total + Number(item.value), 0); const remaining = Math.max(0, nextBudget - totalSpent); state.dailyBudget = normalize(remaining / daysLeft()); state.spentFromDailyBudget = 0; } state.startDate = start; } state.budget = nextBudget; state.finishDate = finish; state.currency = data.get('currency'); state.finishPeriodActualDate = null; save(); sheet = null; show('Wallet saved'); render(); }
function recalc(method) { const remaining = remainingBudget(); state.dailyBudget = normalize(method === 'LAST_DAY' ? remaining : remaining / Math.max(1, daysLeft())); state.spentFromDailyBudget = 0; state.distribution = method === 'REST' ? 'REST' : method === 'ADD_TODAY' ? 'ADD_TODAY' : 'ASK'; state.transactions.push({ id: uid(), type: 'SET_DAILY_BUDGET', value: state.dailyBudget, date: today(), time: nowTime(), comment: '' }); save(); sheet = null; show('Daily budget updated'); render(); }

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

function exportCommitTime(item) { const timestamp = new Date(`${item.date}T${item.time || '00:00'}:00`); if (Number.isNaN(timestamp.getTime())) return fullDate(item.date); return new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(timestamp); }
function exportCsv() { const rows = [['amount', 'comment', 'commit_time'], ...spends().sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)).map(item => [item.value, item.comment || '', exportCommitTime(item)].map(value => `"${String(value).replaceAll('"', '""')}"`))]; const blob = new Blob([rows.map(row => row.join(',')).join('\n')], { type: 'text/csv;charset=utf-8' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `budget-tool-${state.startDate}-${state.finishDate}.csv`; link.click(); URL.revokeObjectURL(link.href); show('CSV exported'); }

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

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character])); }
function escapeAttr(value) { return escapeHtml(value); }

function freshSettingsSheet() { return `<div class="sheet-layer"><section class="sheet"><span class="sheet-grip"></span><div class="sheet-title"><span></span><h2>Settings</h2><button class="round-button" data-action="close">×</button></div><button class="sheet-row" data-action="wallet">${icon('wallet')}<span><strong>Wallet</strong><small>${state.budget ? money(state.budget) : 'Set a period'}</small></span>${icon('edit')}</button><button class="sheet-row" data-action="new-period"><span class="settings-symbol">＋</span><span><strong>New period</strong><small>Start with the intro and create a fresh budget</small></span></button><button class="sheet-row" data-action="theme"><span class="settings-symbol">◐</span><span><strong>Theme</strong><small>${state.theme === 'system' ? 'Follow system' : state.theme === 'dark' ? 'Dark' : 'Light'}</small></span></button><button class="sheet-row" data-action="recalc"><span class="settings-symbol">↻</span><span><strong>Unused daily budget</strong><small>${state.distribution === 'REST' ? 'Split to rest days' : state.distribution === 'ADD_TODAY' ? 'Add to today' : 'Always ask'}</small></span></button><button class="sheet-row" data-action="analytics">${icon('chart')}<span><strong>Analytics</strong><small>See spending patterns</small></span></button><button class="sheet-row" data-action="export">${icon('download')}<span><strong>Export CSV</strong><small>Save every spend</small></span></button><div class="about-copy">Budget Tool Web<br><small>Private, local, and offline.</small></div></section></div>`; }

function freshWalletSheet() { const fresh = !state.budget || startingNewPeriod; return `<div class="sheet-layer"><form class="sheet" id="wallet-form"><span class="sheet-grip"></span><div class="sheet-title"><button type="button" class="round-button" data-action="close">${icon('back')}</button><h2>Wallet</h2><button class="text-submit" type="submit">Apply</button></div><p class="section-label">${fresh ? 'new period' : 'edit period'}</p><label class="field-label">Budget<input name="budget" type="number" min="0.01" step="0.01" value="${fresh ? '' : state.budget}" required></label><div class="form-grid"><label class="field-label">Starts<input name="startDate" type="date" value="${fresh ? today() : state.startDate}" required></label><label class="field-label">Finishes<input name="finishDate" type="date" min="${today()}" value="${state.finishDate}" required></label></div><label class="field-label">Currency<select name="currency"><option value="NONE" ${state.currency === 'NONE' ? 'selected' : ''}>No currency symbol</option>${supportedCurrencies().map(code => `<option value="${code}" ${state.currency === code ? 'selected' : ''}>${code} — ${currencyName(code)}</option>`).join('')}</select></label>${fresh ? '' : `<button type="button" class="sheet-row danger" data-action="finish">Finish period early</button><button type="button" class="sheet-row" data-action="export">${icon('download')} Export spends to CSV</button>`}</form></div>`; }

function freshSaveWallet(event) { event.preventDefault(); const data = new FormData(event.currentTarget); const nextBudget = normalize(data.get('budget')); const start = data.get('startDate'); const finish = data.get('finishDate'); if (!nextBudget || finish < today() || finish < start) return; const isNew = !state.budget || startingNewPeriod; if (isNew) { state.transactions = [{ id: uid(), type: 'INCOME', value: nextBudget, date: start, time: '00:00', comment: '' }]; state.spentFromDailyBudget = 0; state.dailyBudget = normalize(nextBudget / daysBetween(start, finish)); state.startDate = start; } else { const oldIncome = state.transactions.find(item => item.type === 'INCOME'); if (oldIncome) oldIncome.value = nextBudget; const budgetChanged = nextBudget !== state.budget; const dateChanged = start !== state.startDate || finish !== state.finishDate; if (budgetChanged || dateChanged) { const totalSpent = spends().reduce((total, item) => total + Number(item.value), 0); const remaining = Math.max(0, nextBudget - totalSpent); state.dailyBudget = normalize(remaining / daysLeft()); state.spentFromDailyBudget = 0; } state.startDate = start; } state.budget = nextBudget; state.finishDate = finish; state.currency = data.get('currency'); state.finishPeriodActualDate = null; startingNewPeriod = false; save(); sheet = null; show('Wallet saved'); render(); }
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (state.theme === 'system') render(); });

// Global physical keyboard support & Escape to dismiss
window.addEventListener('keydown', e => {
  const activeEl = document.activeElement;
  const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT');

  if (e.key === 'Escape') {
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

reconcileDerivedState();

render();
