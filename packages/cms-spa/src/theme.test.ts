import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyTheme,
  getStoredTheme,
  getSystemTheme,
  resolveTheme,
  THEME_CHANGED_EVENT,
  THEME_STORAGE_KEY,
} from './theme.js';

/**
 * `theme.ts` is the non-React half of the admin theme: the storage key, the
 * change-event name, preference resolution and the `<html>` write. It exists
 * as a plain module because a host app that embeds the editor may render
 * screens BEFORE the editor's `ThemeProvider` mounts and needs the same three
 * things without a React tree. These cases pin the contract both sides depend on.
 */

// Bun runs every test file in one process sharing one happy-dom window, so
// capture the real `matchMedia` before the stub below shadows it.
const ORIGINAL_MATCH_MEDIA = Object.getOwnPropertyDescriptor(window, 'matchMedia');

function stubMatchMedia(dark: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: query.includes('dark') ? dark : false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    }),
  });
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
  stubMatchMedia(false);
});

// Undo the stub and the `<html>` writes once this file is done — sibling test
// files share the window and must see the real `matchMedia` and a clean root.
afterAll(() => {
  if (ORIGINAL_MATCH_MEDIA) {
    Object.defineProperty(window, 'matchMedia', ORIGINAL_MATCH_MEDIA);
  } else {
    Reflect.deleteProperty(window, 'matchMedia');
  }
  document.documentElement.className = '';
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
  localStorage.clear();
});

describe('theme storage contract', () => {
  it('pins the key and event name every writer shares', () => {
    // The pre-paint script, a host app's bootstrap and ThemeProvider all
    // coordinate through these two strings. Changing either is a breaking
    // change for any host app, not an internal rename.
    expect(THEME_STORAGE_KEY).toBe('conloca-theme');
    expect(THEME_CHANGED_EVENT).toBe('conloca-theme-changed');
  });

  it('reads a stored preference back', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(getStoredTheme()).toBe('dark');
  });

  it('falls back to system for an absent or unrecognized value', () => {
    expect(getStoredTheme()).toBe('system');
    localStorage.setItem(THEME_STORAGE_KEY, 'aubergine');
    expect(getStoredTheme()).toBe('system');
  });
});

describe('theme resolution', () => {
  it('reports the OS preference', () => {
    expect(getSystemTheme()).toBe('light');
    stubMatchMedia(true);
    expect(getSystemTheme()).toBe('dark');
  });

  it('resolves system through the OS and passes explicit choices through', () => {
    stubMatchMedia(true);
    expect(resolveTheme('system')).toBe('dark');
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });
});

describe('applyTheme writes the whole scheme to <html>', () => {
  it('sets the dark class, data-theme and color-scheme for dark', () => {
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('clears the dark class and flips the attributes for light', () => {
    applyTheme('dark');
    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light');
  });
});

describe('theme subpath packaging', () => {
  const pkgDir = join(import.meta.dir, '..');

  it('publishes ./theme from the built dist', () => {
    const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>;
    };
    expect(pkg.exports['./theme']).toEqual({
      types: './dist/ts/theme.d.ts',
      import: './dist/ts/theme.js',
      default: './dist/ts/theme.js',
    });
  });
});
