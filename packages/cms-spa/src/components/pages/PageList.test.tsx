/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  ContentAPIClient,
  type ContentListResult,
  type ContentManifest,
  contentEtag,
  type DeleteResult,
  getContentAPIClient,
  setContentAPIClient,
} from '@conloca/content-api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { configureUI } from '../../ui-config.js';
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
let listedPages: ContentManifest[];
let deleteRequests: { locale: string | null; etag: string | null }[];
let deleteResult: DeleteResult;

function CurrentLocation() {
  const location = useLocation();
  return <output data-testid="current-location">{location.pathname + location.search}</output>;
}

beforeEach(() => {
  previousClient = getContentAPIClient();
  previousFetch = globalThis.fetch;
  listedPages = PAGES;
  deleteRequests = [];
  deleteResult = { success: true };
  const answer = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input, 'http://localhost');
    if (init?.method === 'DELETE') {
      deleteRequests.push({ locale: url.searchParams.get('locale'), etag: new Headers(init.headers).get('If-Match') });
      return new Response(JSON.stringify(deleteResult), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const body: ContentListResult = { items: listedPages, total: listedPages.length };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  globalThis.fetch = Object.assign(answer, { preconnect: () => {} });
  setContentAPIClient(new ContentAPIClient());
});

afterEach(() => {
  cleanup();
  globalThis.fetch = previousFetch;
  setContentAPIClient(previousClient);
  configureUI({ readOnly: undefined });
});

async function renderPageList(selectedLocale?: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PageList selectedLocale={selectedLocale} />
        <CurrentLocation />
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

describe('Pages list conversion offer', () => {
  test('keeps offering conversion while some routes are not Conloca pages yet', async () => {
    configureUI({
      hosted: true,
      pageConversion: { cliVersion: '0.2.4', site: 'default', routes: ['/live', '/team'] },
      readOnly: undefined,
    });
    await renderPageList();
    expect(screen.getByRole('button', { name: 'Make an existing page editable' })).toBeTruthy();
  });

  test('stops offering conversion once every route is a Conloca page', async () => {
    configureUI({
      hosted: true,
      pageConversion: { cliVersion: '0.2.4', site: 'default', routes: ['/live', '/fresh/'] },
      readOnly: undefined,
    });
    await renderPageList();
    expect(screen.queryByRole('button', { name: 'Make an existing page editable' })).toBeNull();
  });
});

function multilingualPage(): ContentManifest {
  const entry = page('live', 'Live page');
  const english = entry.locales.en;
  if (!english) throw new Error('English fixture is missing');
  return {
    ...entry,
    locales: {
      fr: { ...english, locale: 'fr', pathname: '/fr/live', etag: 'live.fr.1' },
      en: english,
    },
  };
}

function openMenu(testId: string) {
  fireEvent.keyDown(screen.getByTestId(testId), { key: 'ArrowDown' });
}

describe('Pages list action menus', () => {
  test('Edit opens the first available locale and the locale menu opens the chosen version', async () => {
    listedPages = [multilingualPage()];
    await renderPageList();
    fireEvent.click(screen.getByTestId('edit-live'));
    expect(screen.getByTestId('current-location').textContent).toBe('/pages/live?locale=fr');
    openMenu('edit-locales-live');
    const choices = await screen.findAllByRole('menuitem');
    expect(choices.map((choice) => choice.textContent)).toEqual(['fr', 'en']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'en' }));
    expect(screen.getByTestId('current-location').textContent).toBe('/pages/live?locale=en');
  });

  test('the primary Edit action keeps the first available locale when the list is filtered', async () => {
    listedPages = [multilingualPage()];
    await renderPageList('en');
    fireEvent.click(screen.getByTestId('edit-live'));
    expect(screen.getByTestId('current-location').textContent).toBe('/pages/live?locale=fr');
  });

  test('the first overflow action deletes the whole multilingual page only after confirmation', async () => {
    listedPages = [multilingualPage()];
    await renderPageList();
    openMenu('page-actions-live');
    const choices = await screen.findAllByRole('menuitem');
    expect(choices.map((choice) => choice.textContent)).toEqual(['Delete', 'Delete fr version', 'Delete en version']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(deleteRequests).toEqual([]);
    expect(screen.getByTestId('delete-confirm-message').textContent).toContain('entire page');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(deleteRequests).toEqual([]);
    openMenu('page-actions-live');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Delete' }));
    await waitFor(() =>
      expect(deleteRequests).toEqual([{ locale: null, etag: contentEtag({ fr: 'live.fr.1', en: 'live.1' }) }]),
    );
  });

  test('deleting a language version sends only its locale and current etag', async () => {
    listedPages = [multilingualPage()];
    await renderPageList();
    openMenu('page-actions-live');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete en version' }));
    expect(screen.getByTestId('delete-confirm-message').textContent).toContain('en version');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Delete' }));
    await waitFor(() => expect(deleteRequests).toEqual([{ locale: 'en', etag: 'live.1' }]));
  });

  test('deleting the last language version confirms deletion of the entire page', async () => {
    await renderPageList();
    openMenu('page-actions-live');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete en version' }));
    expect(screen.getByTestId('delete-confirm-message').textContent).toContain('entire page');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Delete' }));
    await waitFor(() => expect(deleteRequests).toEqual([{ locale: null, etag: contentEtag({ en: 'live.1' }) }]));
  });

  test('whole-page deletion requires an etag value for every displayed locale', async () => {
    const entry = multilingualPage();
    const english = entry.locales.en;
    if (!english) throw new Error('English fixture is missing');
    // A malformed listing is different from a valid deferred empty etag.
    Reflect.deleteProperty(english, 'etag');
    listedPages = [entry];
    await renderPageList();
    openMenu('page-actions-live');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    expect(screen.queryByTestId('delete-confirm-message')).toBeNull();
    expect(deleteRequests).toEqual([]);
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });

  test.each(['single', 'multi'] as const)(
    'whole-page deletion accepts a deferred etag on a %s-locale page',
    async (locales) => {
      const entry = locales === 'multi' ? multilingualPage() : page('live', 'Live page');
      const english = entry.locales.en;
      if (!english) throw new Error('English fixture is missing');
      english.etag = '';
      listedPages = [entry];
      await renderPageList();
      openMenu('page-actions-live');
      fireEvent.click(
        await screen.findByRole('menuitem', {
          name: locales === 'multi' ? 'Delete' : 'Delete en version',
        }),
      );
      expect(screen.getByTestId('delete-confirm-message').textContent).toContain('entire page');
      fireEvent.click(screen.getByRole('button', { name: 'Confirm Delete' }));
      const etags: Record<string, string> = locales === 'multi' ? { fr: 'live.fr.1', en: '' } : { en: '' };
      await waitFor(() => expect(deleteRequests).toEqual([{ locale: null, etag: contentEtag(etags) }]));
    },
  );

  test('a refused whole-page deletion keeps the page and reports the stale write', async () => {
    listedPages = [multilingualPage()];
    deleteResult = { success: false, reason: 'stale_write' };
    await renderPageList();
    openMenu('page-actions-live');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Delete' }));
    await waitFor(() => expect(screen.queryByTestId('delete-confirm-message')).toBeNull());
    expect(screen.getByTestId('page-title-live')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
    expect(deleteRequests).toEqual([{ locale: null, etag: contentEtag({ fr: 'live.fr.1', en: 'live.1' }) }]);
  });
});
