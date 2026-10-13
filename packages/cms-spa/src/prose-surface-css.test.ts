/// <reference lib="dom" />
import { describe, expect, test } from 'bun:test';
import { deriveProseSurfaceStyles, filterProseSurfaceCss, PROSE_SURFACE_BASE_CSS } from './prose-surface-css.js';

describe('filterProseSurfaceCss', () => {
  test('keeps .conloca-prose-scoped rules', () => {
    const out = filterProseSurfaceCss('.conloca-prose :where(h1){font-size:36px}');
    expect(out).toContain('conloca-prose');
    expect(out).toContain('36px');
  });

  test('drops unscoped branches from grouped selectors', () => {
    const out = filterProseSurfaceCss('.conloca-prose h1, button { color: #737373 }');
    // CSSOM may re-serialize the color; assert the scoped branch and declaration survived.
    expect(out).toContain('.conloca-prose h1');
    expect(out).toMatch(/#737373|rgb\(115,\s*115,\s*115\)/);
    expect(out).not.toContain('button');
  });

  test('does not split commas nested inside selector functions', () => {
    const out = filterProseSurfaceCss('.conloca-prose :is(h1, h2), button { color: #737373 }');
    expect(out).toMatch(/\.conloca-prose :is\(h1,\s*h2\)/);
    expect(out).not.toContain('button');
  });

  test('keeps @font-face — the fonts the prose rules ask for', () => {
    const out = filterProseSurfaceCss('@font-face{font-family:Nohemi;src:url(https://site.example/n.otf)}');
    expect(out).toContain('@font-face');
    expect(out).toContain('Nohemi');
  });

  test('drops bare-tag globals — unlayered injection would beat the admin chrome utilities', () => {
    const out = filterProseSurfaceCss('h2{font-size:60px}.conloca-prose :where(h2){font-size:30px}');
    expect(out).not.toContain('60px');
    expect(out).toContain('30px');
  });

  test('drops component-module rules — hashed classes belong to the canvas, not the typing surface', () => {
    const out = filterProseSurfaceCss('.hero_ab1c2_3{background:red}');
    expect(out).toBe('');
  });

  test('descends into @media, keeping only prose-scoped rules inside', () => {
    const out = filterProseSurfaceCss(
      '@media (min-width:768px){.conloca-prose :where(h1){font-size:40px}h1{font-size:80px}}',
    );
    expect(out).toContain('@media');
    expect(out).toContain('40px');
    expect(out).not.toContain('80px');
  });

  test('drops an @media whose contents are all unscoped', () => {
    const out = filterProseSurfaceCss('@media print{h1{font-size:10px}}');
    expect(out).toBe('');
  });

  test('survives unparseable input by returning nothing rather than throwing', () => {
    expect(filterProseSurfaceCss('this is not css {{{')).toBe('');
  });
});

describe('deriveProseSurfaceStyles', () => {
  test('empty site styles → empty (surface keeps its floors, no paper)', () => {
    expect(deriveProseSurfaceStyles([])).toEqual([]);
  });

  test('non-empty site styles → filtered prose rules + the paper base sheet, in that order', () => {
    const derived = deriveProseSurfaceStyles(['.conloca-prose :where(p){color:#737373}.hero{color:red}']);
    expect(derived).toHaveLength(2);
    expect(derived[0]).toContain('conloca-prose');
    expect(derived[0]).not.toContain('.hero');
    expect(derived[1]).toBe(PROSE_SURFACE_BASE_CSS);
  });

  test('sheets that filter to nothing still get the paper — the base ink floor is the point', () => {
    const derived = deriveProseSurfaceStyles(['.hero{color:red}']);
    expect(derived).toEqual(['', PROSE_SURFACE_BASE_CSS]);
  });
});

describe('PROSE_SURFACE_BASE_CSS', () => {
  test('paints the host surface with a light paper fallback, never theme-flipping', () => {
    expect(PROSE_SURFACE_BASE_CSS).toContain('.conloca-prose--editor');
    expect(PROSE_SURFACE_BASE_CSS).toContain('var(--conloca-host-prose-bg, #ffffff)');
    expect(PROSE_SURFACE_BASE_CSS).toContain('--conloca-host-color');
    expect(PROSE_SURFACE_BASE_CSS).not.toContain('prefers-color-scheme');
  });

  test('never hard-codes an opaque paper — that is what put white headings on white', () => {
    expect(PROSE_SURFACE_BASE_CSS).not.toMatch(/background:\s*#ffffff/);
  });

  test('does not pin color-scheme — the paper follows the host, so a forced scheme would fight it', () => {
    expect(PROSE_SURFACE_BASE_CSS).not.toContain('color-scheme');
  });
});

/**
 * The scope-root contract, asserted as EXACT selector sets.
 *
 * `toContain` cannot express this: the regression being guarded is a filter
 * that keeps too little (reverting to `.conloca-prose`-only, which yields an
 * empty tier on every real host sheet) or too much (anything not rooted at a
 * scope class, which would escape unlayered into admin chrome). Only an exact
 * set pins both edges at once.
 */
describe('filterProseSurfaceCss scope roots', () => {
  /**
   * Selector texts of the kept top-level style rules, in order.
   *
   * Comma spacing is normalised because CSSOM serialisation of it is
   * engine-dependent (happy-dom emits `:is(h1,h2)`, Chromium `:is(h1, h2)`);
   * everything else about the selector is compared verbatim.
   */
  const selectorsOf = (css: string): string[] => {
    const tag = document.createElement('style');
    tag.media = 'not all';
    tag.textContent = css;
    document.head.appendChild(tag);
    try {
      return Array.from(tag.sheet?.cssRules ?? [])
        .filter((rule): rule is CSSStyleRule => rule.type === 1)
        .map((rule) => rule.selectorText.replace(/,\s*/g, ', '));
    } finally {
      tag.remove();
    }
  };

  // A host sheet in the shape Starlight actually ships: prose rules rooted at
  // the theme's own wrapper class, plus decoys that must not survive.
  const HOST_SHEET = [
    '.sl-markdown-content h2:not(:where(.not-content *)){font-size:2.1875rem}',
    '.sl-markdown-content :is(h1,h2):not(:where(.not-content *)){font-weight:600}',
    '.conloca-prose p{color:#111111}',
    // Decoys: a bare tag global, a near-miss class name, and a rule where the
    // wrapper class is present but NOT the root.
    'h2{font-size:60px}',
    '.sl-markdown-contentious h2{font-size:99px}',
    '.card .sl-markdown-content h2{font-size:11px}',
  ].join('');

  test('keeps rules rooted at the discovered wrapper class alongside the Conloca class', () => {
    expect(selectorsOf(filterProseSurfaceCss(HOST_SHEET, 'sl-markdown-content'))).toEqual([
      '.sl-markdown-content h2:not(:where(.not-content *))',
      '.sl-markdown-content :is(h1, h2):not(:where(.not-content *))',
      '.conloca-prose p',
    ]);
  });

  test('without the wrapper class the same host sheet collapses to almost nothing — the defect', () => {
    // This is the pre-fix behaviour, kept as an assertion so a revert to
    // `.conloca-prose`-only fails loudly instead of silently emptying the tier.
    expect(selectorsOf(filterProseSurfaceCss(HOST_SHEET))).toEqual(['.conloca-prose p']);
  });

  test('every token of a multi-class wrapper is a scope root', () => {
    const css = '.prose h2{font-size:30px}.card h3{font-size:20px}.deck h4{font-size:10px}';
    expect(selectorsOf(filterProseSurfaceCss(css, 'prose card'))).toEqual(['.prose h2', '.card h3']);
  });

  test('a wrapper that already carries the Conloca class does not duplicate its rules', () => {
    const out = filterProseSurfaceCss('.conloca-prose h2{font-size:30px}', 'conloca-prose extra');
    expect(selectorsOf(out)).toEqual(['.conloca-prose h2']);
  });

  test('an empty or absent wrapper class changes nothing', () => {
    for (const wrapper of [undefined, null, '', '   ']) {
      expect(selectorsOf(filterProseSurfaceCss(HOST_SHEET, wrapper))).toEqual(['.conloca-prose p']);
    }
  });

  test('a grouped selector keeps only its scope-rooted branches', () => {
    const out = filterProseSurfaceCss(
      '.sl-markdown-content h2, button, .conloca-prose h3{margin:0}',
      'sl-markdown-content',
    );
    expect(selectorsOf(out)).toEqual(['.sl-markdown-content h2, .conloca-prose h3']);
  });
});
