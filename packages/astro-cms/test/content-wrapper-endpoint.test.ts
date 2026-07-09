import { describe, expect, test } from 'vitest';
import { findContentWrapper } from '../src/site-styles/content-wrapper-endpoint.js';

/**
 * Tests for the wrapper-discovery rule the editor relies on. The
 * endpoint fetches the live page HTML and returns the host's content
 * wrapper + code-block wrapper; the editor mirrors them via the
 * `hostWrapperPlugin`. These tests lock in the priorities so a
 * regression doesn't silently break the visual match between editor
 * and published page.
 */
describe('findContentWrapper — content', () => {
  test('explicit `data-conloca-content-root` wins over the `<main>` heuristic', () => {
    const html = `
      <body>
        <main>
          <section class="custom" data-conloca-content-root>chosen</section>
        </main>
      </body>
    `;
    expect(findContentWrapper(html).content).toEqual({
      tagName: 'section',
      className: 'custom',
    });
  });

  test('`<main>` is the heuristic fallback', () => {
    const html = `<body><main class="content">x</main></body>`;
    expect(findContentWrapper(html).content).toEqual({
      tagName: 'main',
      className: 'content',
    });
  });

  test('inner `<article class="card">` does NOT trip the heuristic — the Starlight regression case', () => {
    const html = `
      <body>
        <main data-pagefind-body>
          <article class="card">inner card 1</article>
          <article class="card sl-flex astro-e3flfouy">inner card 2</article>
        </main>
      </body>
    `;
    expect(findContentWrapper(html).content).toEqual({
      tagName: 'main',
      className: '',
    });
  });

  test('preserves Astro scoped class hashes verbatim', () => {
    const html = `<body><main class="astro-ahzt2o7s sl-flex">x</main></body>`;
    expect(findContentWrapper(html).content).toEqual({
      tagName: 'main',
      className: 'astro-ahzt2o7s sl-flex',
    });
  });

  test('returns null content when no wrapper found', () => {
    const html = `<body><div class="content">x</div></body>`;
    expect(findContentWrapper(html).content).toBeNull();
  });

  test('ignores opening-tag-shaped strings inside HTML comments', () => {
    const html = '<body><!-- <main>commented out</main> --><div></div><main>real</main></body>';
    expect(findContentWrapper(html).content).toEqual({
      tagName: 'main',
      className: '',
    });
  });

  test('handles self-closing and attribute-quote variants', () => {
    const html = `<body><section class='custom-class' data-conloca-content-root>x</section></body>`;
    expect(findContentWrapper(html).content).toEqual({
      tagName: 'section',
      className: 'custom-class',
    });
  });

  test('boolean attribute (no value) on the marker still triggers the match', () => {
    const html = `<body><div class="mine" data-conloca-content-root>x</div></body>`;
    expect(findContentWrapper(html).content).toEqual({
      tagName: 'div',
      className: 'mine',
    });
  });

  test('finds inner prose wrapper inside <main> (the real Starlight case)', () => {
    const html = `
      <body>
        <main class="astro-ahzt2o7s">
          <div class="content-panel">
            <article>
              <div class="sl-markdown-content">
                <h1>Page title</h1>
                <p>Intro paragraph</p>
                <h2>Section</h2>
                <p>More prose</p>
              </div>
            </article>
          </div>
        </main>
      </body>
    `;
    expect(findContentWrapper(html).content).toEqual({
      tagName: 'div',
      className: 'sl-markdown-content',
    });
  });

  test('picks the deepest classed wrapper when several contain all prose', () => {
    const html = `
      <body>
        <main>
          <div class="content-panel">
            <div class="sl-markdown-content">
              <h1>x</h1>
              <p>y</p>
            </div>
          </div>
        </main>
      </body>
    `;
    expect(findContentWrapper(html).content).toEqual({
      tagName: 'div',
      className: 'sl-markdown-content',
    });
  });

  test('falls back to <main> when prose is split across sibling wrappers (no majority)', () => {
    const html = `
      <body>
        <main class="astro-x">
          <article class="card"><p>card one body</p></article>
          <article class="card-two"><p>card two body</p></article>
        </main>
      </body>
    `;
    expect(findContentWrapper(html).content).toEqual({
      tagName: 'main',
      className: 'astro-x',
    });
  });

  test('classed wrapper holding the majority of prose wins over the rest', () => {
    const html = `
      <body>
        <main>
          <div class="sl-markdown-content">
            <h1>Title</h1>
            <p>Body</p>
            <article class="card">
              <p>Card body inside the main prose wrapper</p>
            </article>
          </div>
        </main>
      </body>
    `;
    expect(findContentWrapper(html).content).toEqual({
      tagName: 'div',
      className: 'sl-markdown-content',
    });
  });

  test('explicit opt-in still wins even when an inner prose wrapper exists', () => {
    const html = `
      <body>
        <main>
          <div class="sl-markdown-content" data-conloca-content-root>
            <h1>x</h1>
            <p>y</p>
          </div>
        </main>
      </body>
    `;
    expect(findContentWrapper(html).content).toEqual({
      tagName: 'div',
      className: 'sl-markdown-content',
    });
  });
});

describe('findContentWrapper — codeBlock', () => {
  test('null when the page has no <pre>', () => {
    const html = `
      <body>
        <main>
          <div class="sl-markdown-content">
            <h1>Title</h1>
            <p>No code here.</p>
          </div>
        </main>
      </body>
    `;
    expect(findContentWrapper(html).codeBlock).toBeNull();
  });

  test('null when <pre> has no classed wrappers between it and the content wrapper', () => {
    const html = `
      <body>
        <main>
          <div class="sl-markdown-content">
            <h1>Title</h1>
            <pre>bare pre</pre>
          </div>
        </main>
      </body>
    `;
    expect(findContentWrapper(html).codeBlock).toBeNull();
  });

  test('returns ordered chain of classed ancestors between content wrapper and <pre> (the Starlight expressive-code case)', () => {
    const html = `
      <body>
        <main>
          <div class="sl-markdown-content">
            <h1>Title</h1>
            <p>Intro</p>
            <div class="expressive-code">
              <figure class="frame has-title not-content">
                <figcaption class="header"><span class="title">example.ts</span></figcaption>
                <pre data-language="ts"><code>let x = 1;</code></pre>
              </figure>
            </div>
          </div>
        </main>
      </body>
    `;
    expect(findContentWrapper(html).codeBlock).toEqual([
      { tagName: 'div', className: 'expressive-code' },
      { tagName: 'figure', className: 'frame has-title not-content' },
    ]);
  });

  test('falls back gracefully when content wrapper resolution returned null', () => {
    // No <main>, no prose — content is null. We still gather <pre>
    // ancestor chains but the chain has no main scope, so preAncestorChains
    // stays empty and codeBlock is null too.
    const html = `<body><div class="frame"><pre>x</pre></div></body>`;
    expect(findContentWrapper(html).codeBlock).toBeNull();
  });

  test('preserves nesting order and per-link class lists (no flattening)', () => {
    // Each chain link reports its own tag + class list. Repeated class
    // names across links survive on whichever link carries them — the
    // host CSS expects them in those exact positions to drive its
    // descendant-selector rules (eg `.expressive-code .frame { ... }`).
    const html = `
      <body>
        <main>
          <div class="sl-markdown-content">
            <h1>x</h1>
            <div class="ec-wrap frame">
              <figure class="frame inner">
                <pre>code</pre>
              </figure>
            </div>
          </div>
        </main>
      </body>
    `;
    expect(findContentWrapper(html).codeBlock).toEqual([
      { tagName: 'div', className: 'ec-wrap frame' },
      { tagName: 'figure', className: 'frame inner' },
    ]);
  });
});

/**
 * The discovery is host-agnostic by construction: it walks the live
 * HTML for tag patterns that every host uses (`<main>`, headings, `<p>`,
 * `<pre>`) and returns whichever classed ancestors it finds. No special
 * casing of `.sl-markdown-content` / `.expressive-code` / any other
 * framework's class names. These tests exercise non-Starlight shapes
 * to prove that.
 */
describe('findContentWrapper — host-agnostic across frameworks', () => {
  test('Tailwind Typography: returns `.prose` as the content wrapper', () => {
    const html = `
      <body>
        <main>
          <article class="prose prose-lg dark:prose-invert">
            <h1>Title</h1>
            <p>A paragraph.</p>
            <p>Another paragraph.</p>
            <h2>Section</h2>
            <p>More body.</p>
          </article>
        </main>
      </body>
    `;
    expect(findContentWrapper(html).content).toEqual({
      tagName: 'article',
      className: 'prose prose-lg dark:prose-invert',
    });
  });

  test('hand-rolled custom CSS: returns whatever wrapper class is used', () => {
    const html = `
      <body>
        <main>
          <article class="article-body">
            <h1>Custom</h1>
            <p>Body</p>
            <h2>More</h2>
          </article>
        </main>
      </body>
    `;
    expect(findContentWrapper(html).content).toEqual({
      tagName: 'article',
      className: 'article-body',
    });
  });

  test('Tailwind Typography code block with NO classed wrappers between pre and prose: codeBlock is null', () => {
    // Plain Tailwind Typography pages render `<pre>` directly inside
    // `.prose` with no intermediate wrapper. The discovery returns
    // null for codeBlock — there's nothing host-specific to mirror,
    // and the editor falls back to its own default code-block chrome.
    const html = `
      <body>
        <main>
          <article class="prose">
            <h1>Title</h1>
            <p>Intro</p>
            <pre><code>let x = 1;</code></pre>
          </article>
        </main>
      </body>
    `;
    expect(findContentWrapper(html).codeBlock).toBeNull();
  });

  test('hand-rolled site with a code-block wrapper: returns that wrapper, not Starlight-specific', () => {
    // A bespoke site might wrap code blocks in any class name. As long
    // as it sits between the content wrapper and the `<pre>`, discovery
    // picks it up — no class-name allowlist.
    const html = `
      <body>
        <main>
          <article class="content">
            <h1>x</h1>
            <p>y</p>
            <div class="my-code-card shadow-lg">
              <pre>code</pre>
            </div>
          </article>
        </main>
      </body>
    `;
    expect(findContentWrapper(html).codeBlock).toEqual([{ tagName: 'div', className: 'my-code-card shadow-lg' }]);
  });

  test('framework using <article> instead of a classed wrapper inside main: returns main as content', () => {
    // Some minimal frameworks render `<article>` (unclassed) directly
    // inside `<main>`. With no classed wrapper holding the majority
    // of prose, the heuristic falls back to `<main>` — the safe
    // "the host has no special wrapper" outcome.
    const html = `
      <body>
        <main class="page">
          <article>
            <h1>Bare</h1>
            <p>Body</p>
          </article>
        </main>
      </body>
    `;
    expect(findContentWrapper(html).content).toEqual({
      tagName: 'main',
      className: 'page',
    });
  });

  test('arbitrary nested wrapping: deepest classed ancestor with majority wins', () => {
    // A made-up host wraps prose three layers deep. The deepest one
    // is the most specific scope; the heuristic picks it.
    const html = `
      <body>
        <main>
          <div class="grid-layout">
            <section class="col-main">
              <div class="rich-text">
                <h1>x</h1>
                <p>y</p>
                <p>z</p>
              </div>
            </section>
          </div>
        </main>
      </body>
    `;
    expect(findContentWrapper(html).content).toEqual({
      tagName: 'div',
      className: 'rich-text',
    });
  });

  test('Astro-scoped class hashes flow through verbatim regardless of framework', () => {
    // Astro adds `astro-XXXXXXXX` class hashes to scoped styles. The
    // hash needs to survive the round-trip so the editor matches
    // scoped CSS rules. This is true for any Astro-based host, not
    // just Starlight.
    const html = `
      <body>
        <main>
          <article class="docs-body astro-q7k9x2p3">
            <h1>x</h1>
            <p>y</p>
          </article>
        </main>
      </body>
    `;
    expect(findContentWrapper(html).content).toEqual({
      tagName: 'article',
      className: 'docs-body astro-q7k9x2p3',
    });
  });

  test('multiple code blocks across the page: all consistent (first pre is representative)', () => {
    // Code blocks on a single page are uniformly wrapped by the host.
    // The discovery uses the first <pre>'s chain as the canonical one.
    const html = `
      <body>
        <main>
          <article class="prose">
            <h1>x</h1>
            <div class="code-wrap">
              <pre>first</pre>
            </div>
            <p>between</p>
            <div class="code-wrap">
              <pre>second</pre>
            </div>
          </article>
        </main>
      </body>
    `;
    expect(findContentWrapper(html).codeBlock).toEqual([{ tagName: 'div', className: 'code-wrap' }]);
  });
});
