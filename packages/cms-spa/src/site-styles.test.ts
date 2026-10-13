import { describe, expect, test } from 'bun:test';
import { scopeHostCss, stylesFromResponse } from './site-styles.js';

describe('stylesFromResponse', () => {
  test('accepts a text/css body', () => {
    expect(stylesFromResponse('text/css', '.a{color:red}')).toEqual(['.a{color:red}']);
  });

  test('accepts text/css with charset and mixed case', () => {
    expect(stylesFromResponse('text/css; charset=utf-8', '.a{}')).toEqual(['.a{}']);
    expect(stylesFromResponse('TEXT/CSS', '.a{}')).toEqual(['.a{}']);
  });

  test('rejects an HTML body — a catch-all route can answer 200 text/html on the same path', () => {
    // The dangerous case: a non-empty result here would suppress every
    // fallback tier below the endpoint in the editor style chain.
    expect(stylesFromResponse('text/html; charset=utf-8', '<!doctype html><html>…')).toEqual([]);
  });

  test('rejects a missing content type — the real endpoint always declares text/css', () => {
    expect(stylesFromResponse(null, '.a{}')).toEqual([]);
  });

  test('empty css body yields no styles', () => {
    expect(stylesFromResponse('text/css', '')).toEqual([]);
  });
});

describe('scopeHostCss', () => {
  test('confines broad host selectors to the editor surface', () => {
    expect(scopeHostCss('h1{font-size:72px}button{padding:0}', '.editor-surface')).toBe(
      '@scope (.editor-surface) {\nh1{font-size:72px}button{padding:0}\n}',
    );
  });

  test('rebases root and theme selectors onto the editor surface', () => {
    const scoped = scopeHostCss(
      [
        '@charset "UTF-8";',
        '/* tokens */ :root,:host{--ink:#012}',
        'html.dark body .callout{color:var(--ink)}',
        '/* dark tokens */ .dark body{--paper:#fff}',
        '@media (min-width:40rem){\n  html body{background:var(--paper)}}',
      ].join(''),
      '.editor-surface',
    );

    expect(scoped).toContain('/* tokens */ :scope,:scope{--ink:#012}');
    expect(scoped).toContain(':scope.dark .callout{color:var(--ink)}');
    expect(scoped).toContain('/* dark tokens */ :scope:is(.dark, .dark *){--paper:#fff}');
    expect(scoped).toContain('@media (min-width:40rem){\n  :scope{background:var(--paper)}}');
    expect(scoped).not.toContain('html.dark');
  });

  test('rebases the attribute theme form the same way, without touching compound uses', () => {
    // A host that keys its theme off `[data-theme]` writes it as a bare
    // compound, which inside `@scope` matches only DESCENDANTS of the scope
    // root — never the root itself. Its `:root` counterpart IS rebased, so
    // without this the light tokens land and the dark ones silently do not.
    const scoped = scopeHostCss(
      [
        ':root{--bg:#fff}',
        '[data-theme="dark"]{--bg:#000}',
        'html[data-theme="dark"] .card{color:red}',
        '.section[data-theme="brand"] p{color:blue}',
      ].join(''),
      '.editor-surface',
    );

    expect(scoped).toContain(':scope{--bg:#fff}');
    expect(scoped).toContain(':scope:is([data-theme="dark"], [data-theme="dark"] *){--bg:#000}');
    expect(scoped).toContain(':scope[data-theme="dark"] .card{color:red}');
    // A component that merely USES the attribute is not a theme root, so it is
    // left alone — this is the boundary the rebase must not cross.
    expect(scoped).toContain('.section[data-theme="brand"] p{color:blue}');
  });

  test('does not rewrite similarly named selectors or keyframe steps', () => {
    const css =
      'html-card{display:block}:host-context(.dark){color:white}@keyframes fade{from{opacity:0}to{opacity:1}}';

    expect(scopeHostCss(css, '.editor-surface')).toContain(css);
  });
});
