/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ContentManifest } from '@conloca/content-api-client';
import type { ComponentConfig, Config, CustomField, PuckComponent } from '@puckeditor/core';
import { cleanup, waitFor } from '@testing-library/react';
import { isValidElement, memo, type ReactElement } from 'react';
import { FragmentContentWrapper } from '../src/components/editor/FragmentWrappers.js';
import {
  type ContentFragmentSectionProps,
  enhancePuckConfigWithFragments,
} from '../src/components/editor/PageEditorWrapper.js';
import { ContentFragmentSelectorField } from '../src/components/fields/ContentFragmentSelectorField.js';
import { API_ROUTES, mockAPIError, renderWithProviders, setupTestAPI, testApi } from './test-utils.js';

const inlineFragmentFixture = 'vx-fr4gedit';

const HOST_MARKUP = '<article class="article-content"></article>';

const FRAGMENT_PREVIEW_TITLE = 'Sandboxed content preview';

/** The single element a rendered fragment sits in, published renderer and editor alike. */
const CONTENT_ROOT_OPEN = '<div class="mdx-content conloca-prose" data-conloca-content-root="">';

const fragments: ContentManifest[] = [
  {
    id: inlineFragmentFixture,
    type: 'mdx',
    kind: 'fragment',
    collection: 'fragments',
    locales: {
      en: {
        locale: 'en',
        name: 'edit-what-you-see',
        etag: 'meta1.content1',
        created: '2026-01-01T00:00:00.000Z',
        modified: '2026-01-01T00:00:00.000Z',
        meta: { title: 'Edit what you see' },
      },
    },
  },
];

/**
 * A host site's block: records what the editor handed it, renders its own
 * markup. The fragment node is recorded rather than rendered, so these cases
 * assert what the block was given without mounting the body.
 */
function hostSection(calls: ContentFragmentSectionProps[]): ComponentConfig<ContentFragmentSectionProps> {
  return {
    label: 'Article body',
    fields: { fragmentId: { type: 'text' } },
    defaultProps: { fragmentId: '' },
    render: ({ fragmentId, fragment, fragmentOutline }) => {
      calls.push({ fragmentId, fragment, fragmentOutline });
      return <article className="article-content" />;
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

function enhancedSection(
  section: ComponentConfig<ContentFragmentSectionProps>,
  manifest: ContentManifest[] = fragments,
  locale = 'en',
): ComponentConfig<ContentFragmentSectionProps> {
  const hostConfig: Config = { components: { ContentFragmentSection: section } as Config['components'] };
  const enhanced = enhancePuckConfigWithFragments(hostConfig, manifest, locale);
  return enhanced.components.ContentFragmentSection as ComponentConfig<ContentFragmentSectionProps>;
}

function renderSection(section: ComponentConfig<ContentFragmentSectionProps>, fragmentId: string): string {
  const Section = section.render;
  // Puck injects `id` and `puck` at render time; the test supplies the id only.
  const props = { fragmentId, id: 'block-1' } as Parameters<typeof section.render>[0];

  // A query client is required even when nothing is selected: the wrapper asks
  // for the fragment's outline, and that question is a query whatever the answer.
  return renderWithProviders(<Section {...props} />).container.innerHTML;
}

/** A host block that renders what it was handed, for the cases that want finished markup. */
function hostSectionShowingFragment(): ComponentConfig<ContentFragmentSectionProps> {
  return {
    label: 'Article body',
    fields: { fragmentId: { type: 'text' } },
    defaultProps: { fragmentId: '' },
    render: ({ fragment }) => <article className="article-content">{fragment}</article>,
  };
}

function standaloneBlock(manifest: ContentManifest[], locale = 'en'): ComponentConfig<{ contentId: string }> {
  const enhanced = enhancePuckConfigWithFragments({ components: {} as Config['components'] }, manifest, locale);
  return enhanced.components[`Fragment_${manifest[0].id}`] as ComponentConfig<{ contentId: string }>;
}

describe('the editor hands the fragment to the host block', () => {
  test('keeps fragmentId as the fragment picker', () => {
    const section = enhancedSection(hostSection([]));
    const field = section.fields?.fragmentId as CustomField<string>;

    expect(field.type).toBe('custom');
    expect(field.label).toBe('Content Fragment');

    const picker: ReactElement = field.render({
      field,
      name: 'fragmentId',
      id: 'fragmentId',
      value: inlineFragmentFixture,
      onChange: () => {},
    });
    expect(picker.type).toBe(ContentFragmentSelectorField);
  });

  test('calls the host render with a fragment when one is selected', () => {
    const calls: ContentFragmentSectionProps[] = [];
    renderSection(enhancedSection(hostSection(calls)), inlineFragmentFixture);

    expect(calls).toHaveLength(1);
    expect(calls[0].fragmentId).toBe(inlineFragmentFixture);
    expect(isValidElement(calls[0].fragment)).toBe(true);
  });

  test('leaves the fragment undefined when nothing is selected', () => {
    const calls: ContentFragmentSectionProps[] = [];
    renderSection(enhancedSection(hostSection(calls)), '');

    expect(calls).toHaveLength(1);
    expect(calls[0].fragment).toBeUndefined();
  });

  /**
   * The published renderer gives the block no fragment for an id it cannot
   * find, so the site's own placeholder shows. A deleted fragment leaves such
   * an id behind; the editor must show the same placeholder, not a preview.
   */
  test('leaves the fragment undefined when the id resolves to nothing', () => {
    const calls: ContentFragmentSectionProps[] = [];
    renderSection(enhancedSection(hostSection(calls)), 'vx-n0suchid');

    expect(calls).toHaveLength(1);
    expect(calls[0].fragment).toBeUndefined();
  });

  test('wraps the fragment in the content-root marker', () => {
    const calls: ContentFragmentSectionProps[] = [];
    renderSection(enhancedSection(hostSection(calls)), inlineFragmentFixture);

    const wrapper = calls[0].fragment as ReactElement<{
      className: string;
      'data-conloca-content-root': string;
      children: ReactElement<{ contentId: string }>;
    }>;

    expect(wrapper.type).toBe('div');
    expect(wrapper.props.className).toBe('mdx-content conloca-prose');
    expect(wrapper.props['data-conloca-content-root']).toBe('');
    expect(wrapper.props.children.type).toBe(FragmentContentWrapper);
    expect(wrapper.props.children.props.contentId).toBe(inlineFragmentFixture);
  });

  test('emits no wrapper of its own around the host output', () => {
    expect(renderSection(enhancedSection(hostSection([])), inlineFragmentFixture)).toBe(HOST_MARKUP);
  });

  test('renders a host block wrapped in memo', () => {
    const calls: ContentFragmentSectionProps[] = [];

    const html = renderSection(enhancedSection(memoised(hostSection(calls))), inlineFragmentFixture);

    expect(calls).toHaveLength(1);
    expect(isValidElement(calls[0].fragment)).toBe(true);
    expect(html).toBe(HOST_MARKUP);
  });
});

describe('a fragment is boxed exactly once whichever block holds it', () => {
  beforeEach(() => {
    setupTestAPI();
  });

  afterEach(() => {
    cleanup();
    testApi?.clear();
  });

  /**
   * A real fragment the in-memory API serves: the preview only reaches its
   * final markup once the entry loads and its MDX compiles, and the duplicate
   * wrapper this suite guards against lives on exactly that branch.
   */
  async function seedFragment(
    bodies: Record<string, string> = { en: '# Edit what you see' },
  ): Promise<ContentManifest[]> {
    const locales = Object.fromEntries(
      Object.entries(bodies).map(([locale, mdx]) => [
        locale,
        { meta: { title: 'Edit what you see' }, content: { mdx } },
      ]),
    );
    const created = await testApi.createContent({
      kind: 'fragment',
      collection: 'fragments',
      type: 'mdx',
      name: 'edit-what-you-see',
      meta: { title: 'Edit what you see' },
      locales,
    });
    if (!created.id) throw new Error(`fixture fragment was not created: ${created.reason}`);

    // The manifest the API itself keeps, so the config sees the locales the
    // fragment really has, as the editor's fragment list does.
    const entry = await testApi.getContent(created.id);
    if (!entry) throw new Error('fixture fragment could not be read back');
    return [entry];
  }

  /** Mount a block and wait for the fragment preview, whose branch carries the wrapper. */
  async function mountFragment(ui: ReactElement): Promise<HTMLElement> {
    const view = renderWithProviders(ui, undefined, false);
    await view.findByTitle(FRAGMENT_PREVIEW_TITLE);
    return view.container;
  }

  function expectOneContentRoot(container: HTMLElement) {
    const markup = container.innerHTML;

    expect(container.querySelectorAll('.mdx-content').length).toBe(1);
    expect(markup).toContain(CONTENT_ROOT_OPEN);
    expect(markup).not.toContain('max-w-none');
  }

  /**
   * The editor cannot read the headings out of the rendered body — that renders
   * in a sandbox with no same-origin access — so it takes them off the compile
   * it already requests for the preview. This is the editor half of the pair;
   * `@conloca/mdx` proves the two pipelines produce the same list.
   */
  test('hands the host the outline compiled from the selected fragment', async () => {
    const manifest = await seedFragment({ en: '## First\n\n### Nested\n\n## Second' });
    const calls: ContentFragmentSectionProps[] = [];
    const section = enhancedSection(hostSection(calls), manifest);
    const Section = section.render;
    const props = { fragmentId: manifest[0].id, id: 'block-1' } as Parameters<typeof section.render>[0];

    renderWithProviders(<Section {...props} />, undefined, false);

    await waitFor(() => {
      expect(calls.at(-1)?.fragmentOutline).toEqual([
        { depth: 2, id: 'first', text: 'First' },
        { depth: 3, id: 'nested', text: 'Nested' },
        { depth: 2, id: 'second', text: 'Second' },
      ]);
    });
  });

  /**
   * The published page compiles the fragment in the page's language, so a
   * contents list built from the English version would list headings the
   * Dutch page does not have.
   */
  test('hands the host the outline of the fragment in the editing locale', async () => {
    const manifest = await seedFragment({ en: '## English heading', nl: '## Dutch heading' });
    const calls: ContentFragmentSectionProps[] = [];
    const section = enhancedSection(hostSection(calls), manifest, 'nl');
    const Section = section.render;
    const props = { fragmentId: manifest[0].id, id: 'block-1' } as Parameters<typeof section.render>[0];

    renderWithProviders(<Section {...props} />, undefined, false);

    await waitFor(() => {
      expect(calls.at(-1)?.fragmentOutline).toEqual([{ depth: 2, id: 'dutch-heading', text: 'Dutch heading' }]);
    });
  });

  /**
   * The preview reads the fragment in the editing locale. When that read
   * fails the block must say so; before, any read that did not return an
   * entry left the spinner up for good.
   */
  test('the host block preview reads the editing locale and says when that read fails', async () => {
    const manifest = await seedFragment({ en: '## English heading', nl: '## Dutch heading' });
    mockAPIError(API_ROUTES.LOCALIZED_CONTENT(manifest[0].id, 'nl'), 500, 'FETCH_ERROR', 'Server error');
    const section = enhancedSection(hostSectionShowingFragment(), manifest, 'nl');
    const Section = section.render;
    const props = { fragmentId: manifest[0].id, id: 'block-1' } as Parameters<typeof section.render>[0];

    const view = renderWithProviders(<Section {...props} />, undefined, false);

    await view.findByText(/^Could not load this fragment: /);
    expect(view.container.textContent).not.toContain('Loading content');
    expect(view.queryByTitle(FRAGMENT_PREVIEW_TITLE)).toBeNull();
  });

  test('the standalone fragment block says a missing locale version is missing instead of spinning', async () => {
    const manifest = await seedFragment();
    const block = standaloneBlock(manifest, 'fr');
    const Block = block.render;
    const props = { contentId: manifest[0].id, id: 'block-1' } as Parameters<typeof block.render>[0];

    const view = renderWithProviders(<Block {...props} />, undefined, false);

    await view.findByText("This fragment has no 'fr' version yet.");
    expect(view.container.textContent).not.toContain('Loading content');
    expect(view.queryByTitle(FRAGMENT_PREVIEW_TITLE)).toBeNull();
  });

  test('the host block boxes the fragment once, not once inside another', async () => {
    const manifest = await seedFragment();
    const section = enhancedSection(hostSectionShowingFragment(), manifest);
    const Section = section.render;
    const props = { fragmentId: manifest[0].id, id: 'block-1' } as Parameters<typeof section.render>[0];

    expectOneContentRoot(await mountFragment(<Section {...props} />));
  });

  test('the standalone fragment block uses that same single box', async () => {
    const manifest = await seedFragment();
    const block = standaloneBlock(manifest);
    const Block = block.render;
    const props = { contentId: manifest[0].id, id: 'block-1' } as Parameters<typeof block.render>[0];

    expectOneContentRoot(await mountFragment(<Block {...props} />));
  });
});
