import {
  ContentAPIClient,
  type ContentListResult,
  type ContentManifest,
  setContentAPIClient,
} from '@conloca/content-api-client';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, userEvent, within } from 'storybook/test';
import '../main.css';
import { ThemeProvider } from '../hooks/useTheme.js';
import { CMSDashboard } from './CMSDashboard.js';

/**
 * The CMS Dashboard against the real content-API client, whose `fetch` is answered in memory.
 * A `/pages` route that renders only a marker stands in for the Pages list, so a click that
 * navigates away is visible as the marker replacing the Dashboard.
 */

const MODIFIED = '2026-09-30T09:00:00.000Z';

function page(id: string, title: string, pathname: string): ContentManifest {
  return {
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
        created: MODIFIED,
        modified: MODIFIED,
        meta: { title },
      },
    },
  };
}

const PAGES = [page('vx-home', 'Home', '/'), page('vx-pricing', 'Pricing', '/pricing')];

type StoryResponseBody = ContentListResult | { tree: never[] } | { success: false; error: string };

function json(body: StoryResponseBody): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

async function respond(input: RequestInfo | URL): Promise<Response> {
  const { pathname } = new URL(requestUrl(input), window.location.origin);
  if (pathname === '/__conloca/api/default/pages') {
    const body: ContentListResult = { items: PAGES, total: PAGES.length };
    return json(body);
  }
  if (pathname === '/__conloca/api/assets/folder-tree') return json({ tree: [] });
  if (pathname === '/__conloca/api/fragments' || pathname === '/__conloca/api/data') {
    const body: ContentListResult = { items: [], total: 0 };
    return json(body);
  }
  return new Response(JSON.stringify({ success: false, error: 'Not found' }), { status: 404 });
}

function contentApiFetch(): typeof fetch {
  // Bun's `typeof fetch` carries `preconnect`; the client never calls it, but
  // the shape has to be honest rather than asserted past.
  return Object.assign(respond, { preconnect: fetch.preconnect });
}

function DashboardStory() {
  const [queryClient] = useState(() => {
    setContentAPIClient(new ContentAPIClient({ fetch: contentApiFetch() }));
    return new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  });
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<CMSDashboard />} />
            <Route path="/pages" element={<div data-testid="pages-route">Pages list</div>} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

const meta = {
  component: CMSDashboard,
  parameters: { layout: 'fullscreen' },
  render: () => <DashboardStory />,
} satisfies Meta<typeof CMSDashboard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The Dashboard with its stats and recent activity. */
export const Overview: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('Home')).toBeVisible();
    await expect(canvas.getByTestId('section-card-pages-count')).toHaveTextContent('2');
  },
};

/** New Page opens the create-page dialog over the Dashboard instead of navigating to the Pages list. */
export const NewPageOpensDialog: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'New Page' }));
    await expect(await within(document.body).findByTestId('page-title-input')).toBeVisible();
    await expect(canvas.getByTestId('dashboard-title')).toBeVisible();
    await expect(canvas.queryByTestId('pages-route')).toBeNull();
  },
};
