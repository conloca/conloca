/// <reference lib="dom" />
/**
 * A new page from a template whose pages live under a path prefix.
 *
 * The author may type a path without the prefix. The dialog checked that path,
 * and the page list then added the prefix, so the check could call '/hello'
 * free while the page was created at a taken '/blog/hello'. The dialog now
 * works out the path the page is created at, checks that one, and hands it to
 * the page list as it is.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { PageList } from '../src/components/pages/PageList.js';
import { setTemplates } from '../src/ui-config.js';
import { renderWithProviders, setupTestAPI, testApi } from './test-utils.js';

afterEach(() => {
  cleanup();
  testApi?.clear();
  setTemplates(undefined);
});

/** Open the create dialog on the content-API router `setupTestAPI` serves, then type '/hello'. */
async function openCreateDialogWithBlogTemplate() {
  setTemplates({ blog: { label: 'Blog Post', component: 'BlogPostTemplate', pathPrefix: '/blog/' } });
  renderWithProviders(<PageList />, undefined, false);
  fireEvent.click(await screen.findByTestId('new-page-button'));
  fireEvent.change(await screen.findByLabelText('Template'), { target: { value: 'blog' } });
  fireEvent.change(screen.getByTestId('page-title-input'), { target: { value: 'Hello' } });
  fireEvent.change(screen.getByTestId('page-path-input'), { target: { value: '/hello' } });
}

function createButton() {
  return screen.getByTestId('create-page-submit') as HTMLButtonElement;
}

describe('a new page under a template path prefix, typed without it', () => {
  test('is created at the prefixed path the dialog checked', async () => {
    setupTestAPI();
    await openCreateDialogWithBlogTemplate();

    // A plain boolean keeps each poll cheap.
    await waitFor(() => expect(createButton().disabled).toBe(false));
    fireEvent.click(createButton());

    await waitFor(() => expect(testApi.getSite('default')?.getByPathname('/blog/hello', 'en')).not.toBeNull());
    expect(testApi.getSite('default')?.getByPathname('/hello', 'en')).toBeNull();
  });

  test('is refused in the dialog when another page has the prefixed path', async () => {
    setupTestAPI();
    await testApi.createContent({
      kind: 'page',
      site: 'default',
      collection: 'pages',
      type: 'puck',
      meta: { title: 'Hello' },
      locales: {
        en: { pathname: '/blog/hello', meta: { title: 'Hello' }, content: { puckData: { content: [], root: {} } } },
      },
    });

    await openCreateDialogWithBlogTemplate();

    expect(await screen.findByText('This pathname is already in use')).toBeDefined();
    expect(screen.getByText('The page will be created at /blog/hello')).toBeDefined();
    expect(createButton().disabled).toBe(true);
  });
});
