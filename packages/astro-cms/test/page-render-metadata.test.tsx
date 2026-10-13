import { describe, expect, test } from 'bun:test';
import type { Config, Data } from '@puckeditor/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { createPageRendererWithFragments } from '../src/components/RenderWithFragments.js';
import { withHydration } from '../src/lib/withHydration.js';
import type { DataContext } from '../src/types.js';

const context: DataContext = {
  collections: {},
  locale: 'en',
  siteName: 'default',
  page: {
    id: 'vx-post',
    pathname: '/blog/post',
    title: 'Title from page settings',
    collection: 'pages',
    meta: { title: 'Title from page settings' },
  },
};

/** A block that shows the page's own title, read from the context at render time. */
const PageTitle: Config['components'][string] = {
  fields: {},
  render: ({ puck }) => <h1>{(puck.metadata as DataContext).page.title}</h1>,
};

/** A block the page hydrates in the browser, which sends the page down the hydrating renderer. */
const Counter: Config['components'][string] = {
  fields: {},
  render: withHydration(() => <button type="button">0</button>, 'load'),
};

function renderPage(config: Config, data: Data): string {
  const PageRenderer = createPageRendererWithFragments(config, data, [], context);
  return renderToStaticMarkup(<PageRenderer />);
}

describe("the published render hands every block's render the page's data context", () => {
  test('a block reads the page it renders from `puck.metadata`', () => {
    const html = renderPage(
      { components: { PageTitle } },
      { root: { props: {} }, content: [{ type: 'PageTitle', props: { id: 'title-1' } }] },
    );

    expect(html).toContain('<h1>Title from page settings</h1>');
  });

  test('so does a block on a page that hydrates another', () => {
    const html = renderPage(
      { components: { PageTitle, Counter } },
      {
        root: { props: {} },
        content: [
          { type: 'PageTitle', props: { id: 'title-1' } },
          { type: 'Counter', props: { id: 'counter-1' } },
        ],
      },
    );

    expect(html).toContain('data-hydrate="Counter"');
    expect(html).toContain('<h1>Title from page settings</h1>');
  });
});
