/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  ContentAPIClient,
  type ContentListResult,
  type ContentManifest,
  getContentAPIClient,
  setContentAPIClient,
} from '@conloca/content-api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PageList } from './PageList.js';

const LONG_AGO = '2026-01-10T09:00:00.000Z';
const RECENTLY = '2026-09-30T09:00:00.000Z';
const FAR_FUTURE = '2099-01-01T00:00:00.000Z';

type Schedule = { publishAt?: string; unpublishAt?: string; unpublished?: true };

function page(id: string, title: string, schedule: Schedule = {}): ContentManifest {
  return {
    id,
    type: 'puck',
    kind: 'page',
    site: 'default',
    collection: 'pages',
    locales: {
      en: {
        locale: 'en',
        pathname: `/${id}`,
        etag: `${id}.1`,
        created: LONG_AGO,
        modified: RECENTLY,
        meta: { title },
        ...schedule,
      },
    },
  };
}

const PAGES = [
  page('live', 'Live page'),
  page('fresh', 'Fresh page', { unpublished: true }),
  page('launch', 'Launch page', { publishAt: FAR_FUTURE }),
  page('expired', 'Expired page', { unpublishAt: LONG_AGO }),
];

let previousClient: ContentAPIClient;
let previousFetch: typeof fetch;

beforeEach(() => {
  previousClient = getContentAPIClient();
  previousFetch = globalThis.fetch;
  const body: ContentListResult = { items: PAGES, total: PAGES.length };
  const answer = async () =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = Object.assign(answer, { preconnect: () => {} });
  setContentAPIClient(new ContentAPIClient());
});

afterEach(() => {
  cleanup();
  globalThis.fetch = previousFetch;
  setContentAPIClient(previousClient);
});

async function renderPageList() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PageList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByTestId('page-title-live');
}

/** The status the Status column shows for the row of `id`. */
function statusOf(id: string): string {
  const row = screen.getByTestId(`page-title-${id}`).closest('tr');
  if (!row) throw new Error(`no row for ${id}`);
  const cells = within(row).getAllByRole('cell');
  return cells[2]?.textContent?.trim() ?? '';
}

function filterByStatus(value: 'all' | 'published' | 'draft' | 'scheduled') {
  fireEvent.change(screen.getByDisplayValue('All Status'), { target: { value } });
}

describe('Pages list status', () => {
  test('a page that was never published reads Draft, not Published', async () => {
    await renderPageList();
    expect(statusOf('fresh')).toBe('draft');
  });

  test('a page without a schedule that is already published reads Published', async () => {
    await renderPageList();
    expect(statusOf('live')).toBe('published');
  });

  test('a page whose publish time is ahead reads Scheduled and one past its unpublish time reads Draft', async () => {
    await renderPageList();
    expect(statusOf('launch')).toBe('scheduled');
    expect(statusOf('expired')).toBe('draft');
  });
});

describe('Pages list Status filter', () => {
  test('Draft lists the never-published page and leaves the published one out', async () => {
    await renderPageList();
    filterByStatus('draft');
    await waitFor(() => expect(screen.queryByTestId('page-title-live')).toBeNull());
    expect(screen.getByTestId('page-title-fresh')).toBeTruthy();
    expect(screen.getByTestId('page-title-expired')).toBeTruthy();
  });

  test('Published leaves the never-published page out', async () => {
    await renderPageList();
    filterByStatus('published');
    await waitFor(() => expect(screen.queryByTestId('page-title-fresh')).toBeNull());
    expect(screen.getByTestId('page-title-live')).toBeTruthy();
  });
});
