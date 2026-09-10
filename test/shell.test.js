import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(__dirname, '..');

describe('installed shell (status bar)', () => {
  it('installs as standalone so Chrome keeps the status bar icons', () => {
    const manifest = JSON.parse(readFileSync(join(APP_DIR, 'manifest.webmanifest'), 'utf8'));
    assert.equal(manifest.display, 'standalone');
  });

  it('matches the app canvas tone so an opaque status bar blends in', () => {
    const manifest = JSON.parse(readFileSync(join(APP_DIR, 'manifest.webmanifest'), 'utf8'));
    assert.equal(manifest.theme_color, '#f1f5ec');
    assert.equal(manifest.background_color, '#f1f5ec');
  });

  it('keeps the whole shell below a transparent status bar in installed mode', () => {
    const css = readFileSync(join(APP_DIR, 'styles.css'), 'utf8');
    const block = css.match(/@media \(display-mode: standalone\), \(display-mode: fullscreen\) \{[^}]*\}[^}]*\}/s);
    assert.ok(block, 'expected the display-mode standalone edge-to-edge block');
    assert.match(block[0], /margin-top: env\(safe-area-inset-top\)/);
    assert.match(block[0], /height: calc\(100dvh - env\(safe-area-inset-top\)\)/);
  });
});