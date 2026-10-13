import { describe, expect, test } from 'bun:test';
import { joinSandboxPreviewStyles, SANDBOX_L0_CSS, stripDarkSchemeBlocks } from './sandbox-preview-styles.js';

describe('sandbox-preview-styles', () => {
  test('L0 baseline targets sandbox root and is never Times', () => {
    expect(SANDBOX_L0_CSS).toContain('#__sandbox_root');
    expect(SANDBOX_L0_CSS).toContain('ui-sans-serif');
    expect(SANDBOX_L0_CSS.toLowerCase()).not.toContain('times');
  });

  test('L0 pins the frame to the light scheme — the author OS theme is not the page', () => {
    expect(SANDBOX_L0_CSS).toContain('color-scheme: light');
  });

  test('join always includes L0 even with empty host sheets', () => {
    const css = joinSandboxPreviewStyles([]);
    expect(css).toContain('ui-sans-serif');
    expect(css).toContain('#__sandbox_root h1');
  });

  test('join appends host sheets after L0 — host rules win ties as floors intend', () => {
    const css = joinSandboxPreviewStyles(['.hero { color: red; }']);
    expect(css.indexOf('ui-sans-serif')).toBeLessThan(css.indexOf('.hero'));
    expect(css).toContain('.hero { color: red; }');
  });

  test('host ink survives: no color lock anywhere in the joined output', () => {
    const css = joinSandboxPreviewStyles(['.conloca-prose :where(p) { color: #737373; }']);
    expect(css).toContain('#737373');
    // The old contrast lock's signatures must be gone — the editor is a
    // mirror, not a makeup artist: floors only, never overrides.
    expect(css).not.toContain('color: #181818 !important');
    expect(css).not.toContain('color: inherit !important');
    expect(css).not.toContain('color: #0b57d0 !important');
  });

  test('the background guard stays, stays last, and stays !important', () => {
    // Layout guarantee, not ink: the chip must remain transparent so the
    // article card underneath shows through, whatever the host body paints.
    const css = joinSandboxPreviewStyles(['body { background: #111; }']);
    const guard = css.lastIndexOf('background: transparent !important');
    expect(guard).toBeGreaterThan(css.indexOf('background: #111'));
  });

  test('dark-scheme media blocks are stripped from host sheets before joining', () => {
    const css = joinSandboxPreviewStyles([
      'p { color: #737373; } @media (prefers-color-scheme: dark) { p { color: #fafafa; } }',
    ]);
    expect(css).toContain('#737373');
    expect(css).not.toContain('#fafafa');
  });
});

describe('stripDarkSchemeBlocks', () => {
  test('removes a dark-scheme block including nested braces', () => {
    const out = stripDarkSchemeBlocks(
      '@media (prefers-color-scheme: dark) { :root { --x: 1; } .a { color: white; } } .b { color: black; }',
    );
    expect(out).not.toContain('--x');
    expect(out).not.toContain('white');
    expect(out).toContain('.b { color: black; }');
  });

  test('removes combined preludes (screen and …dark)', () => {
    const out = stripDarkSchemeBlocks('@media screen and (prefers-color-scheme:dark){.a{color:#eee}}');
    expect(out).not.toContain('#eee');
  });

  test('keeps light-scheme and negated-dark blocks — they describe the light rendering', () => {
    const out = stripDarkSchemeBlocks(
      '@media (prefers-color-scheme: light) { .a { color: #111; } } @media not (prefers-color-scheme: dark) { .b { color: #222; } }',
    );
    expect(out).toContain('#111');
    expect(out).toContain('#222');
  });

  test('keeps unrelated media blocks', () => {
    const out = stripDarkSchemeBlocks('@media (min-width: 768px) { .a { font-size: 40px; } }');
    expect(out).toContain('40px');
  });

  test('brace counting is not fooled by braces inside strings or comments', () => {
    const out = stripDarkSchemeBlocks(
      '@media (prefers-color-scheme: dark) { .a { background: url("x{y}.png"); /* } */ color: #eee; } } .keep { color: #333; }',
    );
    expect(out).not.toContain('#eee');
    expect(out).toContain('.keep { color: #333; }');
  });

  test('no dark blocks → input unchanged', () => {
    const css = '.a { color: red; } @media print { .b { display: none; } }';
    expect(stripDarkSchemeBlocks(css)).toBe(css);
  });
});
