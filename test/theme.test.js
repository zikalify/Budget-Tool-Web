import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers/setup.js';

// render() mirrors the effective theme onto <body> so the CSS variables switch
// between the light and dark M3 palettes.
describe('effective theme', () => {
  let t;
  let app;
  beforeEach(() => {
    t = setup({ frozenToday: '2026-09-09' });
    app = t.app;
  });

  it('sets an explicit dark theme on the body', () => {
    t.setState({ theme: 'dark' });
    app.render();
    assert.equal(app.__doc.body.dataset.theme, 'dark');
  });

  it('sets an explicit light theme on the body', () => {
    t.setState({ theme: 'light' });
    app.render();
    assert.equal(app.__doc.body.dataset.theme, 'light');
  });

  it('resolves the system theme onto the body', () => {
    t.setState({ theme: 'system' });
    app.render();
    // The test stub reports prefers-color-scheme: dark as unmatched.
    assert.equal(app.__doc.body.dataset.theme, 'light');
  });
});