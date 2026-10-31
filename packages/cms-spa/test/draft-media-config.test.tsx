/** Site renderers receive loaded image bytes while editable data stays canonical. */
import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import type { Config } from '@puckeditor/core';
import { createElement, memo, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DRAFT_IMAGE_PLACEHOLDER,
  DRAFT_IMAGE_WAIT_MS,
  draftImageData,
  draftImagePreview,
  withDraftMediaRendering,
} from '../src/components/editor/draft-media-config.js';
import { clearMediaCache } from '../src/frame/media-cache.js';
import type { MediaLoadInput } from '../src/frame/protocol.js';
import { configureUI } from '../src/ui-config.js';

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

let loads: MediaLoadInput[] = [];
let failing = false;

async function loadMedia(input: MediaLoadInput): Promise<Blob> {
  loads.push(input);
  if (failing) throw new Error('404');
  return new Blob(['png']);
}

beforeEach(() => {
  loads = [];
  failing = false;
  configureUI({ loadMedia });
});

afterEach(() => {
  jest.useRealTimers();
  clearMediaCache();
  configureUI({});
});
/** The `src` the wrapped Hero renders for an image field holding `url`. */
function imageOf(wrapped: Config, url: string): string | undefined {
  const html = renderToStaticMarkup(createElement(wrapped.components.Hero.render, { ...propsFor(url), items: [] }));
  return /data-image="([^"]*)"/.exec(html)?.[1];
}

describe('canvas render configuration', () => {
  test('resolves nested declared image fields and preserves hooks, slots and cyclic runtime metadata', async () => {
    const props = propsFor('/assets/hero.png');
    const wrapped = withDraftMediaRendering(config);
    renderToStaticMarkup(createElement(wrapped.components.Hero.render, props));
    await Bun.sleep(0);
    const html = renderToStaticMarkup(createElement(wrapped.components.Hero.render, props));
    expect(html).toMatch(/data-image="blob:/);
    expect(html).toMatch(/data-item="blob:/);
    expect(loads).toEqual([
      { route: 'repo', path: 'hero.png' },
      { route: 'repo', path: 'nested/other.PNG' },
    ]);
    expect(html).toContain('data-hook="hook works"');
    expect(html).toContain('<strong>Keep React title</strong>');
    expect(html).toContain('Keep slot');
    expect(props.image.url).toBe('/assets/hero.png');
    expect(props.items[0]?.url).toBe('/assets/nested/other.PNG');
    expect(props.puck.metadata.self).toBe(props.puck.metadata);
    expect(config.components.Hero.render).not.toBe(wrapped.components.Hero.render);
  });

  test('resolves declared root image fields like component fields, and renders a memoized root', async () => {
    const plainRoot: Config = {
      components: {},
      root: {
        fields: { backgroundImage: { type: 'text' } },
        // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Puck types root props as an open record.
        render: ({ backgroundImage }: Record<string, unknown>) => <main data-background={String(backgroundImage)} />,
      },
    };
    const Root = memo(({ backgroundImage }: { backgroundImage: string }) => <main data-background={backgroundImage} />);
    const memoConfig = { components: {}, root: { fields: { backgroundImage: { type: 'text' } }, render: Root } };
    // SAFETY: Puck renders a memo component as a root at runtime; its Config type only names plain functions.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions, typescript/no-unsafe-type-assertion -- same reason as the SAFETY note.
    const memoRoot = memoConfig as unknown as Config;
    for (const rootConfig of [plainRoot, memoRoot]) {
      const props = { backgroundImage: '/assets/hero.png', puck: { isEditing: true } };
      const render = withDraftMediaRendering(rootConfig).root?.render;
      if (!render) throw new Error('Root renderer was dropped');
      // SAFETY: both roots take these props; Puck's render prop type differs per config, so the call site cannot name it.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same reason as the SAFETY note.
      renderToStaticMarkup(createElement(render, props as never));
      // oxlint-disable-next-line no-await-in-loop -- each root must get its load before it is checked.
      await Bun.sleep(0);
      // SAFETY: as above, both roots take these props.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same reason as the SAFETY note.
      expect(renderToStaticMarkup(createElement(render, props as never))).toMatch(/data-background="blob:/);
      expect(props.backgroundImage).toBe('/assets/hero.png');
    }
  });

  test('without a loader the configuration is returned untouched', () => {
    configureUI({});
    expect(withDraftMediaRendering(config)).toBe(config);
  });
});

describe('repository images in the canvas', () => {
  test('a repo link shows the placeholder while loading, then the branch bytes, and loads from the repo route', async () => {
    const wrapped = withDraftMediaRendering(config);
    expect(imageOf(wrapped, '/assets/hero.png')).toBe(DRAFT_IMAGE_PLACEHOLDER);
    await Bun.sleep(0);
    expect(imageOf(wrapped, '/assets/hero.png')).toStartWith('blob:');
    expect(loads).toEqual([{ route: 'repo', path: 'hero.png' }]);
  });

  test('a repository image that fails to load keeps its stored link; a draft address shows the placeholder', async () => {
    failing = true;
    const wrapped = withDraftMediaRendering(config);
    imageOf(wrapped, '/assets/hero.png');
    imageOf(wrapped, '/api/v1/assets/serve/uploads/a.png');
    await Bun.sleep(0);
    expect(imageOf(wrapped, '/assets/hero.png')).toBe('/assets/hero.png');
    expect(imageOf(wrapped, '/api/v1/assets/serve/uploads/a.png')).toBe(DRAFT_IMAGE_PLACEHOLDER);
  });

  test.each([
    ['/assets/my%20photo.jpg', 'my photo.jpg'],
    ['/assets/%E1%83%A4%E1%83%9D%E1%83%A2%E1%83%9D/a%20b.jpeg', 'ფოტო/a b.jpeg'],
    ['/assets/ფოტო/Team/HERO.PNG', 'ფოტო/Team/HERO.PNG'],
    ['/assets/100%2525.png', '100%25.png'],
  ])('the link %s loads the file the site serves for it', async (url, path) => {
    imageOf(withDraftMediaRendering(config), url);
    await Bun.sleep(0);
    expect(loads).toEqual([{ route: 'repo', path }]);
  });

  test.each([
    '/assets/a%2Fb.png',
    '/assets/a%5Cb.png',
    '/assets/%2e%2e/x.png',
    '/assets/%2E/x.png',
    '/assets/%E0%A4%A.png',
    '/assets/a%00.png',
  ])('an escape that would change the path (%p) loads nothing and stays as stored', async (url) => {
    const wrapped = withDraftMediaRendering(config);
    expect(imageOf(wrapped, url)).toBe(url);
    await Bun.sleep(0);
    expect(loads).toEqual([]);
  });

  test.each([
    'https://cdn.example/assets/hero.png',
    '//cdn.example/assets/hero.png',
    'Use /assets/hero.png here',
    '/assets/hero.png.old',
    '/assets/png',
    '/assets/../hero.png',
    '/assets/folder//hero.png',
    '/assets/a.txt',
    '/api/v1/assets/serve/../a.png',
  ])('unsafe or non-image value %s stays unchanged and loads nothing', async (url) => {
    const wrapped = withDraftMediaRendering(config);
    expect(imageOf(wrapped, url)).toBe(url);
    await Bun.sleep(0);
    expect(loads).toEqual([]);
  });

  test('links follow the site media URL: /docs/assets/x.png loads, /assets/x.png does not', async () => {
    configureUI({ loadMedia, assetRefBase: '/docs/assets' });
    const wrapped = withDraftMediaRendering(config);
    imageOf(wrapped, '/docs/assets/x.png');
    expect(imageOf(wrapped, '/assets/x.png')).toBe('/assets/x.png');
    await Bun.sleep(0);
    expect(loads).toEqual([{ route: 'repo', path: 'x.png' }]);
  });

  test('a media folder served at the root makes /hero.png a repository image but not https://, //cdn or data: values', async () => {
    configureUI({ loadMedia, assetRefBase: '' });
    const wrapped = withDraftMediaRendering(config);
    for (const url of ['https://cdn.example/hero.png', '//cdn.example/hero.png', 'data:image/png;base64,AA==']) {
      expect(imageOf(wrapped, url)).toBe(url);
    }
    imageOf(wrapped, '/hero.png');
    await Bun.sleep(0);
    expect(loads).toEqual([{ route: 'repo', path: 'hero.png' }]);
  });
});

describe('page settings images in the canvas', () => {
  const published = new Date('2026-09-08T00:00:00.000Z');
  const page = {
    id: 'post',
    pathname: '/blog/post',
    meta: { title: 'Post', featuredImage: '/assets/cover.jpg', gallery: ['/api/v1/assets/serve/uploads/b.png'] },
    timestamps: { published },
  };
  const related = { id: 'other', pathname: '/blog/other', meta: { featuredImage: '/assets/other.png' } };
  const metadata = { page, pages: [related], siteName: 'site' };
  /** A block like the website's article header: no image field of its own, it shows the page settings it reads. */
  const pageConfig: Config = {
    components: {
      Cover: {
        fields: {},
        render: ({ puck }) => {
          // SAFETY: the test hands this block `metadata` below; Puck types metadata as an open record.
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see the SAFETY note.
          const context = puck.metadata as typeof metadata;
          return (
            <figure
              data-cover={context.page.meta.featuredImage}
              data-gallery={context.page.meta.gallery[0]}
              data-related={context.pages[0]?.meta.featuredImage}
              data-date={context.page.timestamps.published === published}
            />
          );
        },
      },
    },
  };
  const puck = { isEditing: true, metadata, dragRef: null, renderDropZone: () => null };
  const render = (wrapped: Config) =>
    renderToStaticMarkup(createElement(wrapped.components.Cover.render, { id: 'cover', puck }));

  test('a page setting image shows what its field would: placeholder, then the loaded bytes, from repo or serve', async () => {
    const wrapped = withDraftMediaRendering(pageConfig);
    expect(render(wrapped)).toContain(`data-cover="${DRAFT_IMAGE_PLACEHOLDER}"`);
    await Bun.sleep(0);
    const html = render(wrapped);
    expect(html).toMatch(/data-cover="blob:/);
    expect(html).toMatch(/data-gallery="blob:/);
    expect(html).toMatch(/data-related="blob:/);
    expect(html).toContain('data-date="true"');
    expect(loads).toEqual([
      { route: 'repo', path: 'cover.jpg' },
      { route: 'serve', path: 'uploads/b.png' },
      { route: 'repo', path: 'other.png' },
    ]);
    expect(page.meta.featuredImage).toBe('/assets/cover.jpg');
    expect(page.meta.gallery).toEqual(['/api/v1/assets/serve/uploads/b.png']);
    expect(related.meta.featuredImage).toBe('/assets/other.png');
  });

  test('a page setting repository image that fails to load keeps its stored link', async () => {
    failing = true;
    const wrapped = withDraftMediaRendering(pageConfig);
    render(wrapped);
    await Bun.sleep(0);
    const html = render(wrapped);
    expect(html).toContain('data-cover="/assets/cover.jpg"');
    expect(html).toContain(`data-gallery="${DRAFT_IMAGE_PLACEHOLDER}"`);
  });
});

describe('draft addresses', () => {
  test('shows the placeholder, then the loaded bytes, never the address itself', async () => {
    const loaded = Promise.withResolvers<Blob>();
    configureUI({
      loadMedia: (input) => {
        loads.push(input);
        return loaded.promise;
      },
    });
    const wrapped = withDraftMediaRendering(config);
    expect(imageOf(wrapped, '/api/v1/assets/serve/uploads/a b.png')).toBe(DRAFT_IMAGE_PLACEHOLDER);
    expect(loads).toEqual([{ route: 'serve', path: 'uploads/a b.png' }]);
    loaded.resolve(new Blob(['png']));
    await Bun.sleep(0);
    expect(imageOf(wrapped, '/api/v1/assets/serve/uploads/a b.png')).toStartWith('blob:');
  });

  test('MDX preview data covers draft addresses and repository images, with the placeholder only for a draft address not loaded in time', async () => {
    configureUI({ loadMedia: () => new Promise<Blob>(() => {}) });
    jest.useFakeTimers();
    const pending = draftImageData('x("/api/v1/assets/serve/a.png", "/assets/b.png")');
    jest.advanceTimersByTime(DRAFT_IMAGE_WAIT_MS);
    expect(await pending).toEqual({ '/api/v1/assets/serve/a.png': DRAFT_IMAGE_PLACEHOLDER });
  });

  test('MDX editor preview returns the placeholder for an unloaded draft address and the link for a repository image', async () => {
    failing = true;
    expect(await draftImagePreview('/api/v1/assets/serve/a.png')).toBe(DRAFT_IMAGE_PLACEHOLDER);
    expect(await draftImagePreview('/assets/a.png')).toBe('/assets/a.png');
    expect(await draftImagePreview('/api/v1/assets/serve/../a.png')).toBe('/api/v1/assets/serve/../a.png');
    expect(loads).toEqual([
      { route: 'serve', path: 'a.png' },
      { route: 'repo', path: 'a.png' },
    ]);
  });
});
