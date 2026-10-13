import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyTheme,
  getStoredTheme,
  normalizePrePaintScript,
  PRE_PAINT_THEME_SCRIPT,
  resolveTheme,
  THEME_STORAGE_KEY,
} from './theme.js';

/**
 * Every html entry — `main.html` (the entry a host app embeds),
 * `dev.html` (the dev harness), and anything added beside them — carries an
 * inline script that paints the theme on the very first frame, before any
 * module runs. None can import the theme core, because they run before the
 * module graph exists, so they are copies of the theme pipeline we cannot
 * delete. This suite is the drift guard instead, on two fronts: each entry's
 * script must match `PRE_PAINT_THEME_SCRIPT` verbatim, and EXECUTING it must
 * produce the same DOM as the core's full pipeline
 * (`applyTheme(resolveTheme(getStoredTheme()))`) for every preference shape —
 * stored, system, and unrecognized — so a change to the core's resolution OR
 * write that a script doesn't follow fails here.
 */

/** Workspace root: `packages/<package>/src` is three levels down from it. */
const WORKSPACE_ROOT = join(import.meta.dir, '..', '..', '..');

/**
 * Discovered rather than listed. A hard-coded list only guards the entries
 * someone remembered to name, so a new one could ship a stale script — or no
 * script at all — with nothing failing. Every entry the glob turns up is held
 * to the canonical snippet below.
 */
const ENTRY_FILES = globSync('packages/*/src/*.html', { cwd: WORKSPACE_ROOT }).sort();

/**
 * The entries that must be found for this suite to mean anything. A glob that
 * quietly matches nothing is a fake-green gate, so pin the known entries —
 * but only as a floor, so a NEW entry gets covered here instead of rejected.
 */
const KNOWN_ENTRIES = ['packages/cms-spa/src/dev.html', 'packages/cms-spa/src/main.html'] as const;

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

/** The entry's attribute-less inline script (the module script carries `type`/`src`). */
function prePaintScript(entry: string): string {
  const html = readFileSync(join(WORKSPACE_ROOT, entry), 'utf8');
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (match === null || match[1] === undefined) {
    throw new Error(`${entry}: no inline pre-paint <script> found`);
  }
  return match[1];
}

interface PaintedState {
  dark: boolean;
  dataTheme: string | null;
  colorScheme: string;
}

function paintedState(): PaintedState {
  const root = document.documentElement;
  return {
    dark: root.classList.contains('dark'),
    dataTheme: root.getAttribute('data-theme'),
    colorScheme: root.style.colorScheme,
  };
}

/** Strip the theme write off `<html>` so each paint starts from a clean root. */
function resetThemeRoot(): void {
  const root = document.documentElement;
  root.className = '';
  root.removeAttribute('data-theme');
  root.removeAttribute('style');
}

/**
 * Run the shipped script against the stored value, then the core's full
 * pipeline from the same clean root, and return both paints. The core side is
 * derived — not hand-fed — so the script's copied RESOLUTION (unrecognized →
 * system, system → OS preference) is compared too, not just the DOM write.
 */
function statesFor(entry: string, stored: string): [PaintedState, PaintedState] {
  localStorage.setItem(THEME_STORAGE_KEY, stored);
  // Executing the shipped inline script is the point of this suite.
  new Function(prePaintScript(entry))();
  const fromScript = paintedState();
  resetThemeRoot();
  applyTheme(resolveTheme(getStoredTheme()));
  return [fromScript, paintedState()];
}

beforeEach(() => {
  localStorage.clear();
  resetThemeRoot();
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
  resetThemeRoot();
  localStorage.clear();
});

describe('html entry discovery', () => {
  it('finds every html entry the packages ship', () => {
    expect(ENTRY_FILES.length).toBeGreaterThanOrEqual(KNOWN_ENTRIES.length);
    for (const known of KNOWN_ENTRIES) {
      expect(ENTRY_FILES).toContain(known);
    }
  });
});

for (const entry of ENTRY_FILES) {
  describe(`${entry} pre-paint script`, () => {
    it('carries the canonical snippet', () => {
      expect(normalizePrePaintScript(prePaintScript(entry))).toBe(normalizePrePaintScript(PRE_PAINT_THEME_SCRIPT));
    });

    it('paints a dark preference exactly like the theme core', () => {
      const [fromScript, fromCore] = statesFor(entry, 'dark');
      expect(fromScript).toEqual(fromCore);
      expect(fromScript).toEqual({ dark: true, dataTheme: 'dark', colorScheme: 'dark' });
    });

    it('paints a light preference exactly like the theme core', () => {
      const [fromScript, fromCore] = statesFor(entry, 'light');
      expect(fromScript).toEqual(fromCore);
      expect(fromScript).toEqual({ dark: false, dataTheme: 'light', colorScheme: 'light' });
    });

    it('resolves a system preference against a dark OS exactly like the theme core', () => {
      stubMatchMedia(true);
      const [fromScript, fromCore] = statesFor(entry, 'system');
      expect(fromScript).toEqual(fromCore);
      expect(fromScript).toEqual({ dark: true, dataTheme: 'dark', colorScheme: 'dark' });
    });

    it('treats an unrecognized stored value as system exactly like the theme core', () => {
      const [fromScript, fromCore] = statesFor(entry, 'aubergine');
      expect(fromScript).toEqual(fromCore);
      expect(fromScript).toEqual({ dark: false, dataTheme: 'light', colorScheme: 'light' });
    });
  });
}
