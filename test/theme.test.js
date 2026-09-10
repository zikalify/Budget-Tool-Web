import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers/setup.js';

// render() mirrors the effective theme onto <html> (as well as <body>) so the
// CSS `color-scheme` binding can tell Android to flip the status bar icons to
// match the theme the app is actually showing.
describe('effective theme mirror', () => {
  let t;
  let app;
  beforeEach(() => {
    t = setup({ frozenToday: '2026-09-09' });
    app = t.app;
  });

  it('mirrors an explicit dark theme onto the document root', () => {
    t.setState({ theme: 'dark' });
    app.render();
    assert.equal(app.__doc.documentElement.dataset.theme, 'dark');
    assert.equal(app.__doc.body.dataset.theme, 'dark');
  });

  it('mirrors an explicit light theme onto the document root', () => {
    t.setState({ theme: 'light' });
    app.render();
    assert.equal(app.__doc.documentElement.dataset.theme, 'light');
  });

  it('resolves the system theme onto the document root', () => {
    t.setState({ theme: 'system' });
    app.render();
    // The test stub reports prefers-color-scheme: dark as unmatched.
    assert.equal(app.__doc.documentElement.dataset.theme, 'light');
  });
});