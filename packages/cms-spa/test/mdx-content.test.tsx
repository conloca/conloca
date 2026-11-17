/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { LocalizedEntry } from '@conloca/content-api-client';
import { defineFragmentComponents, evaluateMDXToComponent } from '@conloca/mdx/render';
import { cleanup, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { fragmentRenderErrorHelper, MDXContent } from '../src/components/puck/MDXContent.js';
import { setSiteRender } from '../src/site-render.js';
import { renderWithProviders, screen, setupTestAPI } from './test-utils.js';

function createFragmentEntry(mdx: string, etag = 'etag-1'): LocalizedEntry {
  return {
    id: 'fragment-1',
    kind: 'fragment',
    type: 'mdx',
    collection: 'heroes',
    localized: {
      locale: 'en',
      etag,
      created: '2026-03-31T00:00:00.000Z',
      modified: '2026-03-31T00:00:00.000Z',
      name: 'hero-fragment',
      meta: {
        title: 'Hero Fragment',
      },
      content: {
        mdx,
      },
    },
  };
}

const Callout = ({ children }: { children?: ReactNode }) => <aside className="site-callout">{children}</aside>;

function Throws(): never {
  throw new Error('site component blew up');
}

function renderEntry(mdx: string) {
  return renderWithProviders(<MDXContent entry={createFragmentEntry(mdx)} />, undefined, false);
}

const fragmentList = () => (
  <>
    {Array.from({ length: 40 }, (_, index) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list
      <MDXContent key={index} entry={createFragmentEntry(`# Fragment ${index}`)} />
    ))}
  </>
);

describe('MDXContent', () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, '__SITE_RENDER_STATE__');
    setupTestAPI();
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, '__SITE_RENDER_STATE__');
  });

  describe("with the site's renderer and components", () => {
    beforeEach(() => {
      setSiteRender({
        evaluate: evaluateMDXToComponent,
        vocabulary: defineFragmentComponents({ components: { Callout, Throws } }),
      });
    });

    test('renders a site component inline, in no frame', async () => {
      const view = renderEntry('# Hello\n\n<Callout>inline callout</Callout>');
      const callout = await screen.findByText('inline callout');
      expect(callout.closest('aside.site-callout')).toBeTruthy();
      expect(callout.closest('[data-conloca-content-root].mdx-content.conloca-prose')).toBeTruthy();
      expect(view.container.querySelector('iframe')).toBeNull();
      expect(screen.queryByTitle('Sandboxed content preview')).toBeNull();
    });

    test('names an undeclared component and where to declare it', async () => {
      renderEntry('<Nope />');
      const card = (await screen.findByText('Cannot Render Fragment Content')).parentElement;
      expect(card?.textContent).toContain('Unknown component <Nope>');
      expect(card?.textContent).toContain('fragmentComponentsPath');
    });

    test('drops event handlers, inline styles and script URLs from raw HTML', async () => {
      const view = renderEntry('<div onclick="x" style="color:red"><a href="javascript:x">l</a></div>');
      await screen.findByText('l');
      const html = view.container.innerHTML;
      expect(html).not.toContain('onclick');
      expect(html).not.toContain('style');
      expect(html).not.toContain('javascript:');
    });

    test('a site component that throws shows the boundary card instead of crashing', async () => {
      const error = spyOn(console, 'error').mockImplementation(() => {});
      renderEntry('<Throws />');
      expect(await screen.findByText('MDXContent Rendering Error')).toBeTruthy();
      expect(screen.getByText('site component blew up')).toBeTruthy();
      error.mockRestore();
    });
  });

  describe("without the site's renderer", () => {
    test('renders plain markdown inline', async () => {
      renderEntry('# Plain heading');
      expect(await screen.findByRole('heading', { name: 'Plain heading' })).toBeTruthy();
    });

    test('shows the unknown-component card for a site component', async () => {
      renderEntry('<Callout>x</Callout>');
      const card = (await screen.findByText('Cannot Render Fragment Content')).parentElement;
      expect(card?.textContent).toContain('Unknown component <Callout>');
    });
  });

  test('nothing in an inline fragment navigates: links of any target, map areas, form submits', async () => {
    const view = renderEntry(
      [
        '[plain](/elsewhere)',
        '<a href="/away" target="_top">top</a>',
        '<a href="/away" target="_parent">parent</a>',
        '<map name="m"><area href="/x" shape="rect" coords="0,0,10,10" alt="area" /></map>',
        '<form action="/x"><button type="submit">s</button></form>',
        '<button form="outside" formaction="/x">outside</button>',
      ].join('\n\n'),
    );
    await screen.findByText('plain');
    // fireEvent returns false when the default action was prevented.
    for (const name of ['plain', 'top', 'parent']) expect(fireEvent.click(screen.getByText(name))).toBe(false);
    const area = view.container.querySelector('area');
    const form = view.container.querySelector('form');
    if (!area || !form) throw new Error(`the fragment dropped ${area ? 'the form' : 'the area'}`);
    expect(fireEvent.click(area)).toBe(false);
    expect(fireEvent.submit(form)).toBe(false);
    // A submit control may name a form outside the fragment, whose submit never passes through it.
    expect(fireEvent.click(screen.getByText('outside'))).toBe(false);
  });

  test('more mounted fragments than the cache holds neither re-evaluate nor go pending on a re-render', async () => {
    let evaluations = 0;
    setSiteRender({
      evaluate: (mdx: string) => {
        evaluations += 1;
        return evaluateMDXToComponent(mdx);
      },
    });
    const view = renderWithProviders(fragmentList(), undefined, false);
    await screen.findByRole('heading', { name: 'Fragment 39' });
    expect(await screen.findAllByRole('heading')).toHaveLength(40);
    expect(evaluations).toBe(40);
    view.rerender(fragmentList());
    expect(screen.getAllByRole('heading')).toHaveLength(40);
    expect(evaluations).toBe(40);
  });

  test('the helper blames rendering, never syntax or a compile service, for other errors', () => {
    expect(fragmentRenderErrorHelper(new Error('boom'))).toBe('This fragment cannot be rendered: boom');
  });
});
