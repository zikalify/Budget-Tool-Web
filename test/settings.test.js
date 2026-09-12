import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup, activeBudgetState } from './helpers/setup.js';

describe('settings sheet footer', () => {
  let t;
  let app;
  beforeEach(() => {
    t = setup({ frozenToday: '2026-09-09' });
    app = t.app;
    activeBudgetState(t);
    app.render();
  });

  it('sits at the bottom of the settings list', () => {
    const html = app.freshSettingsSheet();
    const listTail = html.indexOf('Export CSV');
    const koFi = html.indexOf('class="ko-fi"');
    assert.ok(koFi > -1 && koFi > listTail, 'expected the Ko-fi block after the settings rows');
  });

  it('links to the project Ko-fi page in a new tab', () => {
    const html = app.freshSettingsSheet();
    assert.ok(html.includes('href="https://ko-fi.com/V7U426QKAR"'));
    assert.ok(html.includes('target="_blank"'));
    assert.ok(html.includes('src="https://storage.ko-fi.com/cdn/kofi6.png'));
  });

  it('links to the public source repository in a new tab', () => {
    const html = app.freshSettingsSheet();
    assert.ok(html.includes('href="https://github.com/zikalify/Budget-Tool-Web"'));
    assert.ok(html.includes('>View source code</a>'));
    assert.ok(html.includes('rel="noopener"'));
  });
});