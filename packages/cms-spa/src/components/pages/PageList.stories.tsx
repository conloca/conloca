import {
  ContentAPIClient,
  type ContentListResult,
  type ContentManifest,
  ErrorCodes,
  setContentAPIClient,
} from '@conloca/content-api-client';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import '../../main.css';
import { ThemeProvider } from '../../hooks/useTheme.js';
import { PageList } from './PageList.js';

/**
 * The CMS page list against the real content-API client, whose `fetch` is
 * answered in memory with the responses the content API's own routes send.
 * That `fetch` is the integration boundary: nothing leaves the browser, and
 * every row, empty state and failure is the fixture the story names.
 *
 * Recorded, not invented: the search box and the filter selects have no
 * accessible labels (placeholder and selected option only), so the stories
 * reach them by their visible values; and a delete refused as a stale write
 * arrives from the client as a thrown error, so the list shows its generic
 * delete failure rather than its stale-write prompt.
 */

const LONG_AGO = '2026-01-10T09:00:00.000Z';
const RECENTLY = '2026-09-30T09:00:00.000Z';
const FAR_FUTURE = '2099-01-01T00:00:00.000Z';

function page(
  id: string,
  title: string,
  pathname: string,
  schedule: { publishAt?: string; unpublishAt?: string } = {},
) {
  const entry: ContentManifest = {
    id,
    type: 'puck',
    kind: 'page',
    site: 'default',
    collection: 'pages',
    locales: {
      en: {
        locale: 'en',
        pathname,
        etag: `${id}.1`,
        created: LONG_AGO,
        modified: RECENTLY,
        meta: { title },
        ...schedule,
      },
    },
  };
  return entry;
}

const PAGES: ContentManifest[] = [
  page('vx-home', 'Home', '/'),
  page('vx-pricing', 'Pricing', '/pricing', { unpublishAt: LONG_AGO }),
  page('vx-launch', 'Launch announcement', '/blog/launch', { publishAt: FAR_FUTURE }),
];

type PagesResponse = { kind: 'pages'; items: ContentManifest[] } | { kind: 'failed' } | { kind: 'pending' };
type DeleteResponse = 'deleted' | 'stale';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * The content API's answers, as `middleware.ts` shapes them. The listing is
 * live: a delete the API accepts removes the page from the next listing, and a
 * delete is accepted only for an id it knows with that entry's current etag.
 */
function contentApiFetch(pages: PagesResponse, onDelete: DeleteResponse): typeof fetch {
  let items = pages.kind === 'pages' ? pages.items : [];
  const respond = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input), window.location.origin);
    const method = init?.method ?? 'GET';
    if (method === 'GET' && url.pathname === '/__conloca/api/default/pages') {
      if (pages.kind === 'pending') return Promise.withResolvers<Response>().promise;
      if (pages.kind === 'failed') {
        return json(
          {
            error: {
              code: ErrorCodes.INTERNAL_ERROR,
              message: "Failed to list pages for site 'default'",
              details: { site: 'default' },
            },
          },
          500,
        );
      }
      const body: ContentListResult = { items, total: items.length };
      return json(body, 200);
    }
    if (method === 'DELETE' && url.pathname.startsWith('/__conloca/api/content/')) {
      const id = url.pathname.slice('/__conloca/api/content/'.length);
      const target = items.find((item) => item.id === id);
      const etag = new Headers(init?.headers).get('If-Match');
      if (!target || etag !== target.locales.en?.etag) return json({ success: false, error: 'Content not found' }, 404);
      if (onDelete === 'deleted') {
        items = items.filter((item) => item.id !== id);
        return json({ success: true }, 200);
      }
      return json(
        {
          success: false,
          reason: 'stale_write',
          currentEtag: 'vx-pricing.2',
          message: 'Content has been modified',
          error: {
            code: ErrorCodes.STALE_WRITE,
            message: 'Content has been modified since you last loaded it',
            details: { currentEtag: 'vx-pricing.2' },
          },
        },
        412,
      );
    }
    return json({ success: false, error: 'Not found' }, 404);
  };
  // Bun's `typeof fetch` carries `preconnect`; the client never calls it, but
  // the shape has to be honest rather than asserted past.
  return Object.assign(respond, { preconnect: fetch.preconnect });
}

function PageListStory({ pages, onDelete = 'deleted' }: { pages: PagesResponse; onDelete?: DeleteResponse }) {
  const [queryClient] = useState(() => {
    setContentAPIClient(new ContentAPIClient({ fetch: contentApiFetch(pages, onDelete) }));
    return new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  });
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MemoryRouter initialEntries={['/pages']}>
          <PageList />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

const meta = {
  component: PageList,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof PageList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  render: () => <PageListStory pages={{ kind: 'pending' }} />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Loading pages...')).toBeVisible();
  },
};

/** A failed listing shows the API's own reason and offers Retry (a full reload, so it is not clicked). */
export const LoadFailed: Story = {
  render: () => <PageListStory pages={{ kind: 'failed' }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('heading', { name: 'Failed to load pages' })).toBeVisible();
    await expect(canvas.getByText("Failed to list pages for site 'default'")).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Retry' })).toBeEnabled();
  },
};

/** A site with no pages invites the first one, and the invitation opens the create dialog. */
export const NoPagesYet: Story = {
  render: () => <PageListStory pages={{ kind: 'pages', items: [] }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('heading', { name: 'No pages yet' })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Create Page' }));
    await expect(await within(document.body).findByTestId('page-title-input')).toBeVisible();
  },
};

/**
 * Published, unpublished and scheduled pages list together; the status filter
 * narrows to drafts, a search with no match says so, and the table drops its
 * Path and Status columns on narrow screens instead of overflowing.
 */
export const FilterAndSearch: Story = {
  render: () => <PageListStory pages={{ kind: 'pages', items: PAGES }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const table = await canvas.findByRole('table');
    await expect(within(table).getAllByRole('row')).toHaveLength(1 + PAGES.length);

    // The table hides Path below `lg` and Status below `md` instead of overflowing.
    // By text, not role: a role query skips the very headers that are hidden.
    const pathHeader = within(table).getByText('Path', { selector: 'th' });
    const statusHeader = within(table).getByText('Status', { selector: 'th' });
    await expect(pathHeader.checkVisibility()).toBe(window.matchMedia('(min-width: 1024px)').matches);
    await expect(statusHeader.checkVisibility()).toBe(window.matchMedia('(min-width: 768px)').matches);

    await userEvent.selectOptions(canvas.getByDisplayValue('All Status'), 'draft');
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(2));
    await expect(canvas.getByTestId('page-title-vx-pricing')).toBeVisible();

    await userEvent.selectOptions(canvas.getByDisplayValue('Draft'), 'all');
    await userEvent.type(canvas.getByPlaceholderText('Search pages...'), 'careers');
    await expect(await canvas.findByText('No pages match your search')).toBeVisible();
  },
};

/** At tablet width (834px) Path is hidden and Status still shows; the filters work the same. */
export const FilterAndSearchOnTablet: Story = {
  ...FilterAndSearch,
  globals: { viewport: { value: 'tablet', isRotated: false } },
};

/** At phone width (320px) both Path and Status are hidden. */
export const FilterAndSearchOnPhone: Story = {
  ...FilterAndSearch,
  globals: { viewport: { value: 'mobile1', isRotated: false } },
};

/** Delete asks first; confirming removes the page through the client. */
export const DeleteAsksFirst: Story = {
  render: () => <PageListStory pages={{ kind: 'pages', items: PAGES }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByTestId('delete-vx-pricing.en'));
    const body = within(document.body);
    await expect(await body.findByTestId('delete-item-name')).toHaveTextContent('Pricing');
    await userEvent.click(body.getByRole('button', { name: 'Confirm Delete' }));
    await waitFor(() => expect(body.queryByTestId('delete-confirm-message')).toBeNull());
    await expect(body.queryByText('Failed to delete page. Please try again.')).toBeNull();
    await waitFor(() => expect(canvas.queryByTestId('page-title-vx-pricing')).toBeNull());
    await expect(canvas.getByTestId('page-title-vx-home')).toBeVisible();
    await expect(canvas.getByTestId('page-title-vx-launch')).toBeVisible();
  },
};

/** Someone else changed the page first: the delete is refused and the list reports it. */
export const DeleteRefusedAsStale: Story = {
  render: () => <PageListStory pages={{ kind: 'pages', items: PAGES }} onDelete="stale" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByTestId('delete-vx-pricing.en'));
    const body = within(document.body);
    await userEvent.click(await body.findByRole('button', { name: 'Confirm Delete' }));
    await expect(await body.findByText('Failed to delete page. Please try again.')).toBeVisible();
    await userEvent.click(body.getByRole('button', { name: 'Close error dialog' }));
    await waitFor(() => expect(body.queryByText('Failed to delete page. Please try again.')).toBeNull());
    await expect(canvas.getByTestId('page-title-vx-pricing')).toBeVisible();
  },
};
