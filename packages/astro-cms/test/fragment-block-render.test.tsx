import { describe, expect, test } from 'bun:test';
import type { ComponentConfig, Config, Data, PuckComponent } from '@puckeditor/core';
import { type ComponentType, memo } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createPageRendererWithFragments } from '../src/components/RenderWithFragments.js';
import type { ContentFragmentSectionProps, DataContext } from '../src/types.js';

const inlineFragmentFixture = 'vx-fr4gedit';

const HOST_MARKUP_WITH_FRAGMENT =
  '<article class="article-content">' +
  '<div class="mdx-content conloca-prose" data-conloca-content-root="">' +
  '<h2>Heading</h2><p>Body</p>' +
  '</div></article>';

function FragmentBody() {
  return (
    <>
      <h2>Heading</h2>
      <p>Body</p>
    </>
  );
}

const OUTLINE = [
  { depth: 2, id: 'heading', text: 'Heading' },
  { depth: 3, id: 'detail', text: 'Detail' },
] as const;

const fragment = {
  id: inlineFragmentFixture,
  title: 'Edit what you see',
  Component: FragmentBody as ComponentType,
  outline: OUTLINE,
};

/**
 * A host site's block: it records what the platform handed it and renders its
 * own markup, which is the whole point of the contract under test.
 */
function hostSection(calls: ContentFragmentSectionProps[]): ComponentConfig<ContentFragmentSectionProps> {
  return {
    label: 'Article body',
    fields: { fragmentId: { type: 'text' } },
    defaultProps: { fragmentId: '' },
    render: ({ fragmentId, fragment: resolved, fragmentOutline }) => {
      calls.push({ fragmentId, fragment: resolved, fragmentOutline });
      return <article className="article-content">{resolved ?? <p>Pick a fragment.</p>}</article>;
    },
  };
}

/**
 * The same block wrapped in `memo`, which a site is free to do. React renders
 * that object happily; nothing can call it. Puck types `render` as a plain
 * function, which is why the site — and this test — needs the cast.
 */
function memoised(section: ComponentConfig<ContentFragmentSectionProps>): ComponentConfig<ContentFragmentSectionProps> {
  return { ...section, render: memo(section.render) as unknown as PuckComponent<ContentFragmentSectionProps> };
}

function configOf(section: ComponentConfig<ContentFragmentSectionProps>): Config {
  return { components: { ContentFragmentSection: section } as Config['components'] };
}

function pageData(fragmentId: string): Data {
  return { root: {}, content: [{ type: 'ContentFragmentSection', props: { id: 'block-1', fragmentId } }] };
}

const context: DataContext = {
  collections: {},
  locale: 'en',
  siteName: 'default',
  page: { id: 'vx-post', pathname: '/blog/post', collection: 'pages' },
};

function renderPage(config: Config, data: Data): string {
  const PageRenderer = createPageRendererWithFragments(config, data, [fragment], context);
  return renderToStaticMarkup(<PageRenderer />);
}

describe('ContentFragmentSection renders through the host block', () => {
  test('calls the host render with the resolved fragment', () => {
    const calls: ContentFragmentSectionProps[] = [];

    renderPage(configOf(hostSection(calls)), pageData(inlineFragmentFixture));

    expect(calls).toHaveLength(1);
    expect(calls[0].fragmentId).toBe(inlineFragmentFixture);
    expect(calls[0].fragment).toBeDefined();
  });

  test("hands the host the fragment's outline alongside its content", () => {
    const calls: ContentFragmentSectionProps[] = [];

    renderPage(configOf(hostSection(calls)), pageData(inlineFragmentFixture));

    expect(calls[0].fragmentOutline).toEqual([
      { depth: 2, id: 'heading', text: 'Heading' },
      { depth: 3, id: 'detail', text: 'Detail' },
    ]);
  });

  /**
   * A site that renders a contents list must be able to tell "this fragment has
   * no headings" from "this id matched nothing", so the unresolved case is an
   * empty outline rather than undefined.
   */
  test('gives an empty outline when the id resolves to nothing', () => {
    const calls: ContentFragmentSectionProps[] = [];

    renderPage(configOf(hostSection(calls)), pageData('vx-n0suchid'));

    expect(calls[0].fragmentOutline).toEqual([]);
  });

  test('leaves the fragment undefined when the id resolves to nothing', () => {
    const calls: ContentFragmentSectionProps[] = [];

    renderPage(configOf(hostSection(calls)), pageData('vx-n0suchid'));

    expect(calls).toHaveLength(1);
    expect(calls[0].fragment).toBeUndefined();
  });

  test('emits no wrapper of its own around the host output', () => {
    const html = renderPage(configOf(hostSection([])), pageData(inlineFragmentFixture));

    expect(html).toStartWith('<article class="article-content">');
    expect(html).toEndWith('</article>');
    expect(html).not.toContain('<section');
    expect(html).not.toContain('max-w-');
    expect(html).not.toContain('text-brand-');
  });

  test('wraps the fragment in the content-root marker the style scanner looks for', () => {
    const html = renderPage(configOf(hostSection([])), pageData(inlineFragmentFixture));

    expect(html).toBe(HOST_MARKUP_WITH_FRAGMENT);
  });

  test('renders the host placeholder when nothing resolves', () => {
    const html = renderPage(configOf(hostSection([])), pageData('vx-n0suchid'));

    expect(html).toBe('<article class="article-content"><p>Pick a fragment.</p></article>');
  });

  test('renders a host block wrapped in memo', () => {
    const calls: ContentFragmentSectionProps[] = [];

    const html = renderPage(configOf(memoised(hostSection(calls))), pageData(inlineFragmentFixture));

    expect(calls).toHaveLength(1);
    expect(html).toBe(HOST_MARKUP_WITH_FRAGMENT);
  });
});
