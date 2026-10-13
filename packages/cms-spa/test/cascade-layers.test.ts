import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Cascade-layer regression: cms-spa's compiled stylesheet must keep
// Tailwind's preflight in the TOP-LEVEL `base` layer. When preflight rode
// inside `cms-admin` (via the monolithic `@import "tailwindcss"
// layer(cms-admin)`), the layer statement ranked it AFTER a host app's
// top-level `utilities` layer and the universal reset silently defeated
// every host utility the admin build didn't also emit (a host-side
// arbitrary padding utility computed to 0). Theme and utilities must
// keep their original `cms-admin.theme` / `cms-admin.utilities`
// sublayers so admin-internal precedence (puck.css and hand-written
// cms-admin rules over generated utilities) is untouched.
//
// The assertions read the dev-shaped artifact `bun-web` builds (the test
// target depends on it), NOT a compile spawned here: the Tailwind CLI
// eagerly loads `@parcel/watcher`'s C++ binding even for a one-shot
// compile, and that dlopen fails in the CI unit-test environment. Reading
// the build's own output also proves the layer placement of the artifact
// that actually ships. The production copy is minified, which preserves
// `@layer` structure and cascade semantics — the assertions target the
// layer placement, not whitespace.

const SRC = join(import.meta.dir, '../src/main.css');
const BUILT = join(import.meta.dir, '../dist/spa/main.css');

function builtCss(): string {
  if (!existsSync(BUILT)) {
    throw new Error(
      'dist/spa/main.css is missing — run `bunx nx run cms-spa:bun-web` (the nx test target depends on it)',
    );
  }
  return readFileSync(BUILT, 'utf8');
}

/** Brace depth of every occurrence of `needle` in `css`. */
function depthsOf(css: string, needle: string): number[] {
  // Strip comments and quoted strings so braces inside them (e.g. a
  // content utility with a brace in its arbitrary value) can't corrupt
  // the depth tracking.
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"[^"\n]*"|'[^'\n]*'/g, '');
  const depths: number[] = [];
  let depth = 0;
  let i = 0;
  while (i < clean.length) {
    const nextOpen = clean.indexOf('{', i);
    const nextClose = clean.indexOf('}', i);
    const nextMatch = clean.indexOf(needle, i);
    if (nextMatch !== -1 && (nextOpen === -1 || nextMatch < nextOpen) && (nextClose === -1 || nextMatch < nextClose)) {
      depths.push(depth);
      // The needle itself may contain braces ('@layer base {' ends in one).
      // Account for them or every subsequent match drifts by the
      // needle's own unmatched-brace count.
      depth += (needle.match(/\{/g) ?? []).length - (needle.match(/\}/g) ?? []).length;
      i = nextMatch + needle.length;
      continue;
    }
    if (nextOpen === -1 && nextClose === -1) break;
    if (nextOpen !== -1 && (nextClose === -1 || nextOpen < nextClose)) {
      depth++;
      i = nextOpen + 1;
    } else {
      depth--;
      i = nextClose + 1;
    }
  }
  return depths;
}

describe('main.css cascade layers (preflight must stay in top-level base)', () => {
  test('source never re-introduces the monolithic layered tailwind import', () => {
    const src = readFileSync(SRC, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    // The forcing line this fix removed. Granular subpath imports
    // (tailwindcss/theme.css etc.) are fine — match the bare specifier only.
    expect(src).not.toMatch(/@import\s+"tailwindcss"\s+layer\(/);
    // The top-level order statement must keep `base` before `utilities`
    // before `cms-admin` — that ordering is what lets host utilities beat
    // the reset while admin chrome keeps winning over host CSS.
    const m = src.match(/^@layer\s+([^;]+);/m);
    expect(m).toBeTruthy();
    const order = m![1].split(',').map((s) => s.trim());
    expect(order).toEqual(expect.arrayContaining(['base', 'utilities', 'cms-admin']));
    expect(order.indexOf('base')).toBeLessThan(order.indexOf('utilities'));
    expect(order.indexOf('utilities')).toBeLessThan(order.indexOf('cms-admin'));
  });

  test('compiled css puts preflight in top-level base, theme/utilities in cms-admin sublayers', () => {
    const css = builtCss();

    // Preflight's universal reset exists exactly once, at top level.
    // (The depth check is the real negative guard: it fails on the
    // pre-fix output, which nested `@layer base` inside `@layer
    // cms-admin { … }` and therefore reported depth ≥ 1.)
    const baseDepths = depthsOf(css, '@layer base {');
    expect(baseDepths.length).toBeGreaterThan(0);
    expect(baseDepths.every((d) => d === 0)).toBe(true);
    // The base block carries the universal reset.
    const baseStart = css.indexOf('@layer base {');
    const baseBlock = css.slice(baseStart, css.indexOf('@layer', baseStart + 1));
    expect(baseBlock).toContain('*, ::after, ::before, ::backdrop, ::file-selector-button');
    expect(baseBlock).toContain('margin: 0');
    expect(baseBlock).toContain('padding: 0');

    // Theme + utilities keep their pre-split sublayers (admin-internal
    // precedence vs puck.css / hand-written cms-admin rules unchanged).
    expect(css).toContain('@layer cms-admin.theme {');
    expect(css).toContain('@layer cms-admin.utilities {');

    // The compiled top-level order statement keeps `base` before
    // `utilities` before `cms-admin` — the ordering the fix relies on.
    const stmts = [...css.matchAll(/^@layer\s+([a-z][a-z0-9-,\s]*);/gm)].map((m) =>
      m[1].split(',').map((s) => s.trim()),
    );
    const order = stmts.find((names) => names.includes('cms-admin'));
    expect(order).toBeTruthy();
    expect(order!).toEqual(expect.arrayContaining(['base', 'utilities', 'cms-admin']));
    expect(order!.indexOf('base')).toBeLessThan(order!.indexOf('utilities'));
    expect(order!.indexOf('utilities')).toBeLessThan(order!.indexOf('cms-admin'));
  });
});
