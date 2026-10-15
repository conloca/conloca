/** Site renderers receive draft URLs while editable data stays canonical. */
import { describe, expect, test } from 'bun:test';
import type { Config } from '@puckeditor/core';
import { createElement, memo, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { withDraftMediaRendering } from '../src/components/editor/draft-media-config.js';

const BASE = 'https://editor.example/api/v1/assets/draft';
const config: Config = {
  components: {
    Hero: {
      fields: {
        image: { type: 'object', objectFields: { url: { type: 'text' } } },
        items: { type: 'array', arrayFields: { url: { type: 'text' } } },
        title: { type: 'text' },
        slot: { type: 'slot' },
      },
      render: ({ image, title, items, puck, slot }) => {
        const [label] = useState('hook works');
        return (
          <div data-image={image.url} data-item={items[0]?.url} data-editing={puck.isEditing} data-hook={label}>
            {title}
            {typeof slot === 'function' ? slot() : null}
          </div>
        );
      },
    },
  },
};

function propsFor(url: string) {
  const metadata: Record<string, unknown> = {};
  metadata.self = metadata;
  return {
    id: 'hero',
    image: Object.freeze({ url }),
    items: Object.freeze([Object.freeze({ url: '/assets/nested/other.PNG' })]),
    title: createElement('strong', {}, 'Keep React title'),
    slot: () => createElement('span', {}, 'Keep slot'),
    puck: { isEditing: true, metadata, dragRef: null, renderDropZone: () => null },
    undeclared: metadata,
  };
}

describe('draft media render configuration', () => {
  test('resolves nested declared image fields and preserves hooks, slots and cyclic runtime metadata', () => {
    const props = propsFor('/assets/hero.png');
    const wrapped = withDraftMediaRendering(config, BASE);
    const html = renderToStaticMarkup(createElement(wrapped.components.Hero.render, props));
    expect(html).toContain(`data-image="${BASE}/hero.png"`);
    expect(html).toContain(`data-item="${BASE}/nested/other.PNG"`);
    expect(html).toContain('data-hook="hook works"');
    expect(html).toContain('<strong>Keep React title</strong>');
    expect(html).toContain('Keep slot');
    expect(props.image.url).toBe('/assets/hero.png');
    expect(props.items[0]?.url).toBe('/assets/nested/other.PNG');
    expect(props.puck.metadata.self).toBe(props.puck.metadata);
  });

  test('an unrelated editable value remains canonical after another render', () => {
    const props = propsFor('/assets/uploads/hero.png');
    const wrapped = withDraftMediaRendering(config, BASE);
    renderToStaticMarkup(createElement(wrapped.components.Hero.render, props));
    const edited = { ...props, title: 'Edited heading' };
    const html = renderToStaticMarkup(createElement(wrapped.components.Hero.render, edited));
    expect(html).toContain(`data-image="${BASE}/uploads/hero.png"`);
    expect(edited.image).toBe(props.image);
    expect(edited.image.url).toBe('/assets/uploads/hero.png');
    expect(config.components.Hero.render).not.toBe(wrapped.components.Hero.render);
  });

  test.each([
    'https://cdn.example/assets/hero.png',
    '//cdn.example/assets/hero.png',
    'Use /assets/hero.png here',
    '/assets/hero.png.old',
    '/assets/png',
    '/assets/../hero.png',
    '/assets/folder//hero.png',
  ])('leaves noncanonical reference %s untouched', (url) => {
    const wrapped = withDraftMediaRendering(config, BASE);
    const html = renderToStaticMarkup(createElement(wrapped.components.Hero.render, propsFor(url)));
    expect(html).toContain(`data-image="${url}"`);
  });

  test.each(['ფოტო', '%E1%83%A4%E1%83%9D%E1%83%A2%E1%83%9D', 'marketing%20images', '%2e%2e', '100% ready'])(
    'preserves the literal canonical folder %s while encoding URL transport',
    (folder) => {
      const path = `/assets/${folder}/hero.PNG`;
      const wrapped = withDraftMediaRendering(config, BASE);
      const props = propsFor(path);
      const html = renderToStaticMarkup(createElement(wrapped.components.Hero.render, props));
      expect(html).toContain(`${BASE}/${encodeURIComponent(folder)}/hero.PNG`);
      expect(props.image.url).toBe(path);
    },
  );

  test.each(['marketing images', "quotes' & (images)"])(
    'renders an ordinary folder name %s as safe URL segments',
    (folder) => {
      const wrapped = withDraftMediaRendering(config, BASE);
      const path = `/assets/${folder}/hero.png`;
      const encoded = encodeURIComponent(folder).replace(
        /[!'()*]/g,
        (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
      );
      const html = renderToStaticMarkup(createElement(wrapped.components.Hero.render, propsFor(path)));
      expect(html).toContain(`data-image="${BASE}/${encoded}/hero.png"`);
    },
  );

  test('resolves declared root image fields like component fields', () => {
    const rootConfig: Config = {
      components: {},
      root: {
        fields: { backgroundImage: { type: 'text' } },
        render: ({ backgroundImage }: Record<string, unknown>) => <main data-background={String(backgroundImage)} />,
      },
    };
    const props = { backgroundImage: '/assets/hero.png', puck: { isEditing: true } };
    const wrapped = withDraftMediaRendering(rootConfig, BASE);
    const render = wrapped.root?.render;
    if (!render) throw new Error('Root renderer was dropped');
    const html = renderToStaticMarkup(createElement(render, props as never));
    expect(html).toContain(`data-background="${BASE}/hero.png"`);
    expect(props.backgroundImage).toBe('/assets/hero.png');
  });

  test('renders a memoized root component instead of calling it', () => {
    const Root = memo(({ backgroundImage }: { backgroundImage: string }) => <main data-background={backgroundImage} />);
    const rootConfig = {
      components: {},
      root: { fields: { backgroundImage: { type: 'text' } }, render: Root },
    } as unknown as Config;
    const render = withDraftMediaRendering(rootConfig, BASE).root?.render;
    if (!render) throw new Error('Root renderer was dropped');
    const html = renderToStaticMarkup(createElement(render, { backgroundImage: '/assets/hero.png' } as never));
    expect(html).toContain(`data-background="${BASE}/hero.png"`);
  });

  test('keeps standalone configuration identical', () => {
    expect(withDraftMediaRendering(config, undefined)).toBe(config);
  });
});

describe('workspace-scoped draft renderer bases', () => {
  test('places scope after the encoded image path without changing the canonical field', () => {
    const props = propsFor('/assets/literal%20folder/hero.png');
    const wrapped = withDraftMediaRendering(config, `${BASE}/?editorWorkspace=%257BscopeA%257D`);
    const html = renderToStaticMarkup(createElement(wrapped.components.Hero.render, props));
    expect(html).toContain(`data-image="${BASE}/literal%2520folder/hero.png?editorWorkspace=%257BscopeA%257D"`);
    expect(props.image.url).toBe('/assets/literal%20folder/hero.png');
  });

  test('keeps an older renderer bound to its original scope when another scope is created', () => {
    const props = propsFor('/assets/hero.png');
    const original = withDraftMediaRendering(config, `${BASE}?editorWorkspace=scopeA`);
    const next = withDraftMediaRendering(config, `${BASE}?editorWorkspace=scopeB`);
    const laterHtml = renderToStaticMarkup(createElement(next.components.Hero.render, props));
    const originalHtml = renderToStaticMarkup(createElement(original.components.Hero.render, props));
    expect(laterHtml).toContain(`${BASE}/hero.png?editorWorkspace=scopeB`);
    expect(originalHtml).toContain(`${BASE}/hero.png?editorWorkspace=scopeA`);
    expect(originalHtml).not.toContain('scopeB');
    expect(props.image.url).toBe('/assets/hero.png');
  });
});
