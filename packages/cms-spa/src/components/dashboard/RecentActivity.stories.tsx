import {
  ContentAPIClient,
  type ContentListResult,
  type ContentManifest,
  setContentAPIClient,
} from '@conloca/content-api-client';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { expect, within } from 'storybook/test';
import '../../main.css';
import { ThemeProvider } from '../../hooks/useTheme.js';
import { RecentActivity } from './RecentActivity.js';

/**
 * The Dashboard's recent pages against the real content-API client, whose
 * `fetch` answers the page listing in memory. Each row's dot says whether the
 * page is live, scheduled or a draft, the same status the Pages list shows.
 */

const LONG_AGO = '2026-01-10T09:00:00.000Z';

function page(
  id: string,
  title: string,
  pathname: string,
  modified: string,
  schedule: { publishAt?: string; unpublished?: true } = {},
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
        modified,
        meta: { title },
        ...schedule,
      },
    },
  };
  return entry;
}

const PAGES: ContentManifest[] = [
  page('vx-new', 'homepage 2', '/homepage-2', '2026-10-21T10:00:00.000Z', { unpublished: true }),
  page('vx-home', 'Home', '/', '2026-10-19T10:00:00.000Z'),
  page('vx-launch', 'Launch announcement', '/blog/launch', '2026-10-18T10:00:00.000Z', {
    publishAt: '2099-01-01T00:00:00.000Z',
  }),
];

function listingFetch(): typeof fetch {
  const body: ContentListResult = { items: PAGES, total: PAGES.length };
  const respond = async () =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  return Object.assign(respond, { preconnect: fetch.preconnect });
}

function RecentActivityStory() {
  const [queryClient] = useState(() => {
    setContentAPIClient(new ContentAPIClient({ fetch: listingFetch() }));
    return new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  });
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MemoryRouter>
          <div className="max-w-xl p-6">
            <RecentActivity />
          </div>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

const meta = {
  component: RecentActivity,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof RecentActivity>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A page created and not yet published is marked draft beside a live page and a scheduled one. */
export const DraftLiveAndScheduled: Story = {
  render: () => <RecentActivityStory />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const statusOf = async (title: string) => {
      const row = (await canvas.findByText(title)).closest('a');
      if (!row) throw new Error(`no row for ${title}`);
      return within(row).getByText(/^Status:/).textContent;
    };
    await expect(await statusOf('homepage 2')).toBe('Status: draft');
    await expect(await statusOf('Home')).toBe('Status: published');
    await expect(await statusOf('Launch announcement')).toBe('Status: scheduled');
  },
};
