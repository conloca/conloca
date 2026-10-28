/// <reference lib="dom" />
import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { cleanup, render, waitFor } from '@testing-library/react';
import { createElement, useEffect } from 'react';
import { findWrapperByClass, keepUnchanged, readProbedPage, useProbedHostStyles } from './host-style-probe.js';
import { setSiteBaseUrl } from './ui-config.js';

function doc(html: string): Document {
  const d = document.implementation.createHTMLDocument('probe');
  d.body.innerHTML = html;
  return d;
}

describe('findWrapperByClass', () => {
  test('resolves the discovered class when present', () => {
    const d = doc('<main></main><article class="sl-markdown-content"><p>x</p></article>');
    expect(findWrapperByClass(d, 'sl-markdown-content')?.tagName).toBe('ARTICLE');
  });

  test('no discovered class: prefers the documented prose scope over <main>', () => {
    // Synthetic probe elements must land INSIDE the scope the host's prose
    // rules target (`.conloca-prose :where(h1) { … }`), or they measure
    // unscoped page defaults and the probe emits wrong values. Every
    // Conloca-rendered fragment page carries the scope class by
    // construction, even when wrapper discovery comes back empty.
    const d = doc('<main><div class="mdx-content conloca-prose"><h1>t</h1></div></main>');
    expect(findWrapperByClass(d, null)?.className).toContain('conloca-prose');
  });

  test('no discovered class and no prose scope: falls back to <main>', () => {
    const d = doc('<main><p>x</p></main>');
    expect(findWrapperByClass(d, null)?.tagName).toBe('MAIN');
  });

  test('discovered class missing from the document: same fallback ladder', () => {
    const d = doc('<div class="conloca-prose"></div>');
    expect(findWrapperByClass(d, 'gone-wrapper')?.className).toBe('conloca-prose');
  });

  test('nothing to stand on: null, so the probe settles empty instead of throwing', () => {
    const d = doc('<div id="app"></div>');
    expect(findWrapperByClass(d, null)).toBeNull();
  });
});

// An editor in a parent frame has no dev endpoints for the route's CSS and
// content wrapper, so the probe's page load must yield both, the way those
// endpoints yield them locally.
describe('readProbedPage', () => {
  test("finds the page's content wrapper and code-block chain by the dev endpoint's rule", () => {
    const d = doc(
      '<main><div class="sl-markdown-content"><h2>h</h2><p>a</p><div class="expressive-code"><figure class="frame"><pre>x</pre></figure></div></div></main>',
    );
    expect(readProbedPage(d, null, true).wrappers).toEqual({
      content: { tagName: 'div', className: 'sl-markdown-content' },
      codeBlock: [
        { tagName: 'div', className: 'expressive-code' },
        { tagName: 'figure', className: 'frame' },
      ],
    });
  });

  // Media-bound sheets and where the samples are measured are checked in the
  // browser (MdxEditorHostParity stories): Happy DOM leaves `sheet.media`
  // empty and cannot iterate a computed style.
  test("returns the page's stylesheets as one text", () => {
    const d = doc(
      '<style>.sl-markdown-content p { margin-top: 16px; }</style><style>.nav { color: red; }</style><main><p>a</p></main>',
    );
    expect(readProbedPage(d, null, true).styles).toEqual([
      '.sl-markdown-content p { margin-top: 16px; }\n.nav { color: red; }',
    ]);
  });

  test('an editor with dev endpoints asks for no discovery, so none is read', () => {
    const d = doc('<style>.x { color: red; }</style><main><div class="sl-markdown-content"><p>a</p></div></main>');
    const probe = readProbedPage(d, null, false);
    expect(probe.styles).toEqual([]);
    expect(probe.wrappers).toEqual({ content: null, codeBlock: null });
  });
});

// A theme toggle re-probes the same page: unchanged styles and wrappers must
// keep their identity, or the editor reinjects the route sheet and rebuilds
// its plugins for nothing.
describe('keepUnchanged', () => {
  const wrappers = { content: { tagName: 'div', className: 'w' }, codeBlock: null };
  const prev = { css: 'a', styles: ['S'], wrappers };

  test('keeps the previous styles and wrappers when their content is the same', () => {
    const next = keepUnchanged(prev, { css: 'b', styles: ['S'], wrappers: structuredClone(wrappers) });
    expect(next.css).toBe('b');
    expect(next.styles).toBe(prev.styles);
    expect(next.wrappers).toBe(prev.wrappers);
  });

  test('takes the new ones when their content differs', () => {
    const nextWrappers = { content: { tagName: 'div', className: 'v' }, codeBlock: null };
    const next = keepUnchanged(prev, { css: 'a', styles: ['T'], wrappers: nextWrappers });
    expect(next.styles).toEqual(['T']);
    expect(next.wrappers).toBe(nextWrappers);
  });
});

/**
 * Captures successive hook snapshots without mounting the full editor.
 * The flash bug is "settled starts false while css is empty" — that is a
 * hook contract, so unit it here rather than through CMSMDXEditor.
 */
function ProbeSnapshot({
  routeUrl,
  wrapperClass,
  onSnap,
}: {
  routeUrl?: string;
  wrapperClass: string | null;
  onSnap: (snap: { css: string; settled: boolean }) => void;
}) {
  const { css, settled } = useProbedHostStyles(routeUrl, wrapperClass);
  useEffect(() => {
    onSnap({ css, settled });
  }, [css, settled, onSnap]);
  return null;
}

describe('useProbedHostStyles settled flag', () => {
  afterEach(() => {
    cleanup();
    mock.restore();
  });

  test('starts unsettled with empty css — callers must not treat empty as failure yet', () => {
    const snaps: Array<{ css: string; settled: boolean }> = [];
    render(
      createElement(ProbeSnapshot, {
        routeUrl: '/preview',
        wrapperClass: null,
        onSnap: (s) => snaps.push(s),
      }),
    );
    expect(snaps[0]).toEqual({ css: '', settled: false });
  });

  test('probes the route under the site base, not at the origin root', () => {
    setSiteBaseUrl('https://s.example/docs/');
    // Keep the probe frame out of the document: only its address matters, and loading it would reach for the network.
    const append = spyOn(document.body, 'appendChild').mockImplementation((node) => node);
    try {
      render(createElement(ProbeSnapshot, { routeUrl: '/blog/x', wrapperClass: null, onSnap: () => {} }));
      const probe = append.mock.calls.map(([node]) => node).find((node) => node instanceof HTMLIFrameElement);
      expect(probe?.getAttribute('src')).toBe('https://s.example/docs/blog/x');
    } finally {
      append.mockRestore();
      setSiteBaseUrl('');
    }
  });

  test('no probe source settles empty immediately (definitive: nothing to probe)', async () => {
    const snaps: Array<{ css: string; settled: boolean }> = [];
    render(
      createElement(ProbeSnapshot, {
        wrapperClass: null,
        onSnap: (s) => snaps.push(s),
      }),
    );
    await waitFor(() => {
      expect(snaps.at(-1)).toEqual({ css: '', settled: true });
    });
  });

  test('settles true with css once the iframe probe resolves', async () => {
    const snaps: Array<{ css: string; settled: boolean }> = [];
    render(
      createElement(ProbeSnapshot, {
        routeUrl: 'about:blank',
        wrapperClass: 'prose',
        onSnap: (s) => snaps.push(s),
      }),
    );
    expect(snaps[0]).toEqual({ css: '', settled: false });
    await waitFor(() => {
      const last = snaps.at(-1);
      expect(last?.settled).toBe(true);
    });
    const last = snaps.at(-1)!;
    // Either a real stylesheet or definitive empty is fine — the contract
    // under test is that settled flips only after the probe finishes, not
    // that happy-dom can measure every CSS property identically to Chrome.
    expect(last.settled).toBe(true);
    expect(typeof last.css).toBe('string');
  });
});
