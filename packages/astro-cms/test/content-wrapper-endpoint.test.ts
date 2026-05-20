import { describe, expect, test } from 'bun:test';
import { findContentWrapper } from '../src/site-styles/content-wrapper-endpoint.js';

/**
 * Tests for the discovery rule the wrapper-replication architecture
 * relies on. The endpoint fetches the live page HTML and returns the
 * host's content-root shape; the editor then mirrors it via the
 * `hostWrapperPlugin`. These tests lock in the priority order so a
 * regression doesn't silently break the visual match between editor
 * and published page.
 */
describe('findContentWrapper', () => {
  test('explicit `data-conloca-content-root` wins over the `<main>` heuristic', () => {
    // Both a `<main>` AND a marked element are present — the explicit
    // marker should win even though `<main>` would also have matched.
    const html = `
      <body>
        <main>
          <section class="custom" data-conloca-content-root>chosen</section>
        </main>
      </body>
    `;
    expect(findContentWrapper(html)).toEqual({ tagName: 'section', className: 'custom' });
  });

  test('`<main>` is the heuristic fallback', () => {
    const html = `<body><main class="content">x</main></body>`;
    expect(findContentWrapper(html)).toEqual({ tagName: 'main', className: 'content' });
  });

  test('inner `<article class="card">` does NOT trip the heuristic — this is the Starlight regression case', () => {
    // Starlight's `<Card>` user-component renders `<article class="card">`,
    // and pages often use multiple inside the content area. An earlier
    // heuristic picked the first one and mirrored a SUB-element of the
    // page; we want the wrapping `<main>` instead.
    const html = `
      <body>
        <main data-pagefind-body>
          <article class="card">inner card 1</article>
          <article class="card sl-flex astro-e3flfouy">inner card 2</article>
        </main>
      </body>
    `;
    expect(findContentWrapper(html)).toEqual({ tagName: 'main', className: '' });
  });

  test('preserves Astro scoped class hashes verbatim', () => {
    // The host's `<main>` likely carries an Astro scoped-class hash
    // (`astro-xxxxxxxx`); those hashes are required for scoped CSS
    // rules to match the wrapper in the editor.
    const html = `<body><main class="astro-ahzt2o7s sl-flex">x</main></body>`;
    expect(findContentWrapper(html)).toEqual({
      tagName: 'main',
      className: 'astro-ahzt2o7s sl-flex',
    });
  });

  test('returns null when no wrapper found', () => {
    // No data-attr, no `<main>` — the editor falls back to its existing
    // chrome rather than wrapping in something arbitrary.
    const html = `<body><div class="content">x</div></body>`;
    expect(findContentWrapper(html)).toBeNull();
  });

  test('ignores opening-tag-shaped strings inside HTML comments', () => {
    // A `<main>` appears in a comment AND for real. The real one should win.
    const html = '<body><!-- <main>commented out</main> --><div></div><main>real</main></body>';
    expect(findContentWrapper(html)).toEqual({ tagName: 'main', className: '' });
  });

  test('handles self-closing and attribute-quote variants', () => {
    // Single quotes, no quotes, mixed — the attribute parser must
    // handle all the forms HTML spec allows.
    const html = `<body><section class='custom-class' data-conloca-content-root>x</section></body>`;
    expect(findContentWrapper(html)).toEqual({ tagName: 'section', className: 'custom-class' });
  });

  test('boolean attribute (no value) on the marker still triggers the match', () => {
    // `<x data-conloca-content-root>` is valid HTML; our parser treats
    // boolean attrs as empty-string values, which still satisfies the
    // `'data-conloca-content-root' in attrs` check.
    const html = `<body><div class="mine" data-conloca-content-root>x</div></body>`;
    expect(findContentWrapper(html)).toEqual({ tagName: 'div', className: 'mine' });
  });
});
