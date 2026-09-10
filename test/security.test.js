import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setup, activeBudgetState } from './helpers/setup.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(__dirname, '..');

describe('security', () => {
  let t;
  let app;
  let s;
  beforeEach(() => {
    t = setup({ frozenToday: '2026-09-09' });
    app = t.app;
    s = activeBudgetState(t);
  });

  describe('escapeHtml / escapeAttr', () => {
    it('escapes all five dangerous characters', () => {
      assert.equal(app.escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#039;');
      assert.equal(app.escapeAttr(`&<>"'`), '&amp;&lt;&gt;&quot;&#039;');
    });

    it('returns empty string for null/undefined input', () => {
      assert.equal(app.escapeHtml(null), 'null');
      assert.equal(app.escapeHtml(undefined), 'undefined');
    });

    it('coerces numbers and is a no-op on safe text', () => {
      assert.equal(app.escapeHtml(123), '123');
      assert.equal(app.escapeHtml('coffee'), 'coffee');
    });
  });

  describe('XSS not reachable through user comments', () => {
    function withMaliciousComment(comment) {
      s.transactions = [
        { id: 'i', type: 'INCOME', value: 100, date: app.today(), time: '00:00', comment: '' },
        { id: 'a', type: 'SPENT', value: 5, date: app.today(), time: '10:00', comment },
      ];
    }

    it('history escapes a comment with a script tag', () => {
      withMaliciousComment('<script>alert(1)</script>');
      const html = app.history();
      assert.doesNotMatch(html, /<script>/);
      assert.match(html, /&lt;script&gt;/);
    });

    it('history escapes quote-based attribute injection', () => {
      // The quotes are the injectable boundary; they must be neutralized so the
      // payload remains inert text (the literal string "onmouseover=" may still
      // appear inside escaped text, but it can never become an attribute).
      withMaliciousComment('x" onmouseover="alert(1)');
      const html = app.history(true);
      assert.doesNotMatch(html, /x" onmouseover="alert\(1\)/); // raw quotes gone
      assert.match(html, /&quot;/);
      // No unescaped quote boundary between text and a real attribute exists:
      assert.doesNotMatch(html, />[^<]*"[^>]*onmouseover=/); // quotes-as-text are escaped
    });

    it('analytics escapes tag names', () => {
      withMaliciousComment('<img src=x onerror=alert(1)>');
      const html = app.analyticsSheet();
      assert.doesNotMatch(html, /<img/);
      assert.match(html, /&lt;img/);
    });

    it('tagChip escapes the tag in data-tag attribute', () => {
      // Use tagging() with a malicious comment
      s.transactions = [
        { id: 'i', type: 'INCOME', value: 100, date: app.today(), time: '00:00', comment: '' },
        { id: 'a', type: 'SPENT', value: 5, date: app.today(), time: '10:00', comment: 'x" onclick="x' },
      ];
      const html = app.tagging();
      // The quote inside data-tag is escaped to &quot; so no attribute breaks out
      assert.doesNotMatch(html, /data-tag="[^"]*"[^=>]*onclick=/) // no clean quote boundary
      ;
      assert.match(html, /&quot;/);
      assert.match(html, /data-tag="x&quot; onclick=&quot;x"/);
    });
  });

  describe('CSV export', () => {
    it('csvSafe neutralizes formula injection starts', () => {
      assert.equal(app.csvSafe('=1+1'), "'=1+1");
      assert.equal(app.csvSafe('+cmd'), "'+cmd");
      assert.equal(app.csvSafe('-5'), "'-5");
      assert.equal(app.csvSafe('@foo'), "'@foo");
    });

    it('csvSafe leaves benign values unchanged', () => {
      assert.equal(app.csvSafe('coffee'), 'coffee');
      assert.equal(app.csvSafe('10.50'), '10.50');
      assert.equal(app.csvSafe(''), '');
    });
  });

  describe('attribute escaping in rendered inputs', () => {
    it('wallet form date inputs escape their values', () => {
      t.dbg.setSheet('wallet');
      const html = app.freshWalletSheet();
      assert.match(html, /name="startDate"/);
    });

    it('dateEditor escapes min/max/value attributes', () => {
      t.dbg.setEditor({ editingId: 'x', rawValue: '5', editorComment: '', editorDate: app.today(), editorTime: '08:30' });
      const html = app.dateEditor();
      assert.match(html, /type="date"/);
      assert.match(html, /type="time"/);
    });

    it('history search input escapes its value attribute', () => {
      s.transactions = [
        { id: 'i', type: 'INCOME', value: 100, date: app.today(), time: '00:00', comment: '' },
        { id: 'a', type: 'SPENT', value: 3, date: app.today(), time: '10:00', comment: 'x' },
      ];
      t.dbg.setHistorySearch('" autofocus onfocus="alert(1)');
      const html = app.history();
      assert.doesNotMatch(html, /autofocus onfocus="alert/);
      assert.match(html, /&quot;/);
      t.dbg.setHistorySearch('');
    });
  });

  describe('service worker', () => {
    it('restricts caching to same-origin requests (defense in depth)', () => {
      const sw = readFileSync(join(APP_DIR, 'sw.js'), 'utf8');
      assert.match(sw, /url\.origin !== self\.location\.origin/);
      // cross-origin requests must not be written to the cache
      assert.match(sw, /return fetch\(event\.request\)/);
    });

    it('never loads third-party scripts and only permits the Ko-fi logo host', () => {
      const idx = readFileSync(join(APP_DIR, 'index.html'), 'utf8');
      // No external script element may exist (the bundled module is fine).
      assert.doesNotMatch(idx, /<script\b[^>]*\bsrc\s*=\s*["']?https?:/i);
      // Every external origin referenced in the document must be the exempted
      // Ko-fi image host (none, or any other host, is a failure).
      const external = [...idx.matchAll(/https:\/\/([^/\"';\s>]+)/g)].map(m => m[1]);
      assert.ok(external.length > 0, 'expected a Ko-fi logo host in the CSP');
      for (const host of external) assert.equal(host, 'storage.ko-fi.com');
    });
  });

  describe('money robustness', () => {
    it('never renders NaN for non-numeric input in NONE currency', () => {
      assert.equal(app.money('bad', 'NONE'), '0.00');
      assert.equal(app.money(NaN, 'NONE'), '0.00');
      assert.equal(app.money(null, 'NONE'), '0.00');
    });
  });
});