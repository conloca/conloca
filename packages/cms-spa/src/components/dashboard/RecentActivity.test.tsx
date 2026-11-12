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
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RecentActivity } from './RecentActivity.js';

const LONG_AGO = '2026-01-10T09:00:00.000Z';
const RECENTLY = '2026-09-30T09:00:00.000Z';

function page(id: string, title: string, unpublished?: true): ContentManifest {
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
        ...(unpublished ? { unpublished } : {}),
      },
    },
  };
}

const PAGES = [page('live', 'Live page'), page('fresh', 'Fresh page', true)];

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

/** The status the dot of the activity row titled `title` announces. */
async function dotStatusOf(title: string): Promise<string> {
  const row = (await screen.findByText(title)).closest('a');
  if (!row) throw new Error(`no row for ${title}`);
  return within(row).getByText(/^Status:/).textContent ?? '';
}

describe('Dashboard recent activity status', () => {
  test('a page that was never published is marked draft, like the Pages list', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <RecentActivity />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await dotStatusOf('Fresh page')).toBe('Status: draft');
    expect(await dotStatusOf('Live page')).toBe('Status: published');
  });
});
