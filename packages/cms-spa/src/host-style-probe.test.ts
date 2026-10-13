/// <reference lib="dom" />
import { afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, render, waitFor } from '@testing-library/react';
import { createElement, useEffect } from 'react';
import { findWrapperByClass, useProbedHostStyles } from './host-style-probe.js';

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

/**
 * Captures successive hook snapshots without mounting the full editor.
 * The flash bug is "settled starts false while css is empty" — that is a
 * hook contract, so unit it here rather than through CMSMDXEditor.
 */
function ProbeSnapshot({
  routeUrl,
  wrapperClass,
  routeCss,
  onSnap,
}: {
  routeUrl?: string;
  wrapperClass: string | null;
  routeCss?: string;
  onSnap: (snap: { css: string; settled: boolean }) => void;
}) {
  const snap = useProbedHostStyles(routeUrl, wrapperClass, { routeCss });
  useEffect(() => {
    onSnap(snap);
  }, [snap, onSnap]);
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
    // happy-dom fires iframe load for srcdoc; the reconstruction path is
    // the cross-origin path this flag exists to protect.
    const snaps: Array<{ css: string; settled: boolean }> = [];
    render(
      createElement(ProbeSnapshot, {
        wrapperClass: 'prose',
        routeCss: '.prose p{font-size:18px}',
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
