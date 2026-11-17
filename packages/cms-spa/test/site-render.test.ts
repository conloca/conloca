import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { defineFragmentComponents, EMPTY_FRAGMENT_VOCABULARY, evaluateMDXToComponent } from '@conloca/mdx/render';
import { act, render } from '@testing-library/react';
import { createElement, Fragment, forwardRef, memo, type ReactNode } from 'react';
import { getSiteRender, setSiteRender, useSiteRender } from '../src/site-render.js';

const Callout = () => null;
const Frame = ({ children }: { children?: ReactNode }) => createElement(Fragment, null, children);
const evaluate = async () => ({ Component: null, outline: [] });
const Probe = () => createElement('span', null, useSiteRender().source);

describe('site render registry', () => {
  let warn: ReturnType<typeof spyOn>;
  beforeEach(() => {
    Reflect.deleteProperty(window, '__SITE_RENDER_STATE__');
    warn = spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    Reflect.deleteProperty(window, '__SITE_RENDER_STATE__');
  });

  test("falls back to the editor's own renderer before any set", () => {
    const fallback = getSiteRender();
    expect(fallback.source).toBe('editor');
    expect(fallback.vocabulary.components).toEqual({});
    expect(typeof fallback.evaluate).toBe('function');
  });

  test("holds the site's evaluate, vocabulary and frames", () => {
    setSiteRender({
      evaluate,
      vocabulary: defineFragmentComponents({ components: { Callout } }),
      frames: { blog: Frame },
    });
    const current = getSiteRender();
    expect(current.source).toBe('site');
    expect(current.evaluate).toBe(evaluate);
    expect(current.vocabulary.components.Callout).toBe(Callout);
    expect(current.frames.blog).toBe(Frame);
  });

  test('a malformed vocabulary falls back to the empty one with one warning', () => {
    setSiteRender({ vocabulary: {} });
    expect(getSiteRender().vocabulary.components).toEqual({});
    expect(getSiteRender().source).toBe('editor');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('fragmentComponents');
  });

  test('drops frames that are not components', () => {
    setSiteRender({ frames: { blog: 'x' } });
    expect(Object.hasOwn(getSiteRender().frames, 'blog')).toBe(false);
  });

  test('an evaluate that is not a function falls back to the editor renderer with one warning', () => {
    setSiteRender({ evaluate: 1 });
    expect(getSiteRender()).toEqual({
      evaluate: evaluateMDXToComponent,
      vocabulary: EMPTY_FRAGMENT_VOCABULARY,
      frames: {},
      source: 'editor',
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('evaluate');
  });

  test('keeps memo and forwardRef frames', () => {
    const a = memo(Frame);
    const b = forwardRef(Frame);
    setSiteRender({ frames: { a, b } });
    const { frames } = getSiteRender();
    expect(Object.keys(frames)).toEqual(['a', 'b']);
    expect(frames.a).toBe(a);
    expect(frames.b).toBe(b);
  });

  test('a frames value that is not a plain object leaves no frames, with one warning', () => {
    for (const frames of [[], 'x']) {
      warn.mockClear();
      setSiteRender({ frames });
      expect(getSiteRender().frames).toEqual({});
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('editorFrames');
    }
  });

  test('re-renders a subscriber on set', () => {
    const { container } = render(createElement(Probe));
    expect(container.textContent).toBe('editor');
    act(() => setSiteRender({ evaluate: async () => ({ Component: null, outline: [] }) }));
    expect(container.textContent).toBe('site');
  });
});
