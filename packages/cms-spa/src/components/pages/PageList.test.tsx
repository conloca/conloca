/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
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
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { Page } from '../../types.js';
import { configureUI } from '../../ui-config.js';
import { PageList } from './PageList.js';
import { PageRow } from './PageRow.js';
import { PageTable } from './PageTable.js';

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

function servePages(items: ContentManifest[]) {
  listedPages = items;
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
}

beforeEach(() => {
  previousClient = getContentAPIClient();
  previousFetch = globalThis.fetch;
  deleteRequests = [];
  deleteResult = { success: true };
  servePages(PAGES);
});

afterEach(() => {
  cleanup();
  globalThis.fetch = previousFetch;
  setContentAPIClient(previousClient);
  configureUI({ hosted: undefined, readOnly: undefined });
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
    expect(statusOf('fresh')).toBe('Draft');
  });

  test('display overrides change both badges and filter labels, then reset with the next config', async () => {
    await renderPageList();
    expect(statusOf('live')).toBe('Published');
    cleanup();

    configureUI({ hosted: true });
    await renderPageList();
    expect(statusOf('live')).toBe('Published');
    cleanup();

    configureUI({
      hosted: true,
      pageStatusLabels: { published: 'Pushed to Github', draft: 'Needs publishing', scheduled: 'Ready later' },
    });
    await renderPageList();
    const row = screen.getByTestId('page-title-live').closest('tr');
    if (!row) throw new Error('Expected the row of the published page');
    expect(within(row).getAllByText('Pushed to Github')).toHaveLength(2);
    expect(screen.getByRole('option', { name: 'Pushed to Github' }).getAttribute('value')).toBe('published');
    expect(statusOf('fresh')).toBe('Needs publishing');
    expect(statusOf('launch')).toBe('Ready later');
    expect(screen.getByRole('option', { name: 'Needs publishing' }).getAttribute('value')).toBe('draft');
    expect(screen.getByRole('option', { name: 'Ready later' }).getAttribute('value')).toBe('scheduled');
    filterByStatus('published');
    await waitFor(() => expect(screen.queryByTestId('page-title-fresh')).toBeNull());
    expect(screen.getByTestId('page-title-live')).toBeTruthy();
    cleanup();

    configureUI({ hosted: false });
    await renderPageList();
    expect(statusOf('live')).toBe('Published');
    expect(screen.queryByText('Pushed to Github')).toBeNull();
    expect(screen.getByRole('option', { name: 'Published' }).getAttribute('value')).toBe('published');
    expect(statusOf('fresh')).toBe('Draft');
    expect(statusOf('launch')).toBe('Scheduled');
    expect(screen.getByRole('option', { name: 'Draft' }).getAttribute('value')).toBe('draft');
    expect(screen.getByRole('option', { name: 'Scheduled' }).getAttribute('value')).toBe('scheduled');
  });

  test('a page whose publish time is ahead reads Scheduled and one past its unpublish time reads Draft', async () => {
    await renderPageList();
    expect(statusOf('launch')).toBe('Scheduled');
    expect(statusOf('expired')).toBe('Draft');
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

  test('the title and primary Edit keep the first available locale when the list is filtered', async () => {
    listedPages = [multilingualPage()];
    await renderPageList('en');
    fireEvent.click(screen.getByTestId('edit-live'));
    expect(screen.getByTestId('current-location').textContent).toBe('/pages/live?locale=fr');
    openMenu('edit-locales-live');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'en' }));
    expect(screen.getByTestId('current-location').textContent).toBe('/pages/live?locale=en');
    fireEvent.click(screen.getByTestId('page-title-live'));
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

async function renderPageListWithEditorRoute() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/pages']}>
        <Routes>
          <Route path="/pages" element={<PageList />} />
          <Route path="/pages/:id" element={<p data-testid="editor-route">editor</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByTestId('page-title-live');
}

describe('Pages list row actions', () => {
  afterEach(() => {
    configureUI({});
  });

  test('the title is a button that opens the page editor', async () => {
    await renderPageListWithEditorRoute();
    const title = screen.getByRole('button', { name: 'Live page' });
    expect(title).toBe(screen.getByTestId('page-title-live'));
    fireEvent.click(title);
    expect(await screen.findByTestId('editor-route')).toBeTruthy();
  });

  test('the row exposes a single primary editor action', async () => {
    await renderPageListWithEditorRoute();
    const row = screen.getByTestId('page-title-live').closest('tr');
    if (!row) throw new Error('The page has no row.');
    expect(within(row).getAllByRole('button', { name: 'Live page' })).toHaveLength(1);
  });

  test('a translated page previews the selected language and keeps every locale action available', async () => {
    const original = page('live', 'Live page');
    const english = original.locales?.en;
    if (!english) throw new Error('The fixture page has no English locale.');
    servePages([
      {
        ...original,
        locales: {
          en: english,
          nl: { ...english, locale: 'nl', pathname: '/nl/live', etag: 'live.nl.1', meta: { title: 'Dutch page' } },
        },
      },
    ]);
    await renderPageListWithEditorRoute();
    expect(screen.getAllByTestId('page-title-live')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Live page' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Preview / })).toHaveLength(1);

    await act(async () => {
      fireEvent.change(screen.getByTestId('locale-selector'), { target: { value: 'nl' } });
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dutch page' })).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Live page' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Preview Dutch page' })).toBeTruthy();
    openMenu('page-actions-live');
    expect(await screen.findByRole('menuitem', { name: 'Delete nl version' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Delete en version' })).toBeTruthy();
    expect(screen.queryByTestId('editor-route')).toBeNull();
  });

  test('copying the path preserves the page list and opens no editor', async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const copied: string[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          copied.push(text);
        },
      },
    });
    try {
      await renderPageListWithEditorRoute();
      fireEvent.click(screen.getByRole('button', { name: 'Copy path for Live page' }));
      await waitFor(() => expect(copied).toEqual(['/live']));
      expect(screen.queryByTestId('editor-route')).toBeNull();
      expect(screen.getByTestId('page-title-live')).toBeTruthy();
    } finally {
      if (original) Object.defineProperty(navigator, 'clipboard', original);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  test('a refused clipboard write explains the failure and can be retried', async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    let attempts = 0;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error('Clipboard permission refused');
        },
      },
    });
    try {
      await renderPageListWithEditorRoute();
      const copy = screen.getByRole('button', { name: 'Copy path for Live page' });
      fireEvent.click(copy);
      await waitFor(() => expect(copy.nextElementSibling?.textContent).toContain('Could not copy'));
      fireEvent.click(copy);
      await waitFor(() => expect(copy.nextElementSibling?.textContent).toContain('Copied'));
      expect(attempts).toBe(2);
      expect(screen.queryByTestId('editor-route')).toBeNull();
    } finally {
      if (original) Object.defineProperty(navigator, 'clipboard', original);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  test('the path is plain text: the row, not the path, leads to the editor', async () => {
    await renderPageListWithEditorRoute();
    expect(screen.queryByRole('link', { name: '/live' })).toBeNull();
    expect(screen.queryByRole('button', { name: '/live' })).toBeNull();
  });

  test('each row has one named Preview button beside its locale editor controls', async () => {
    await renderPageListWithEditorRoute();
    const previews = screen.getAllByRole('button', { name: /^Preview / });
    const labels = previews.map((button) => button.getAttribute('aria-label'));
    labels.sort((left, right) => (left ?? '').localeCompare(right ?? ''));
    expect(labels).toEqual(['Preview Expired page', 'Preview Fresh page', 'Preview Launch page', 'Preview Live page']);
    expect(screen.getAllByRole('button', { name: /^Edit$/ })).toHaveLength(PAGES.length);
  });

  test('Preview asks the parent to open the live site and does not open the editor', async () => {
    const opened: { path: string }[] = [];
    configureUI({
      openSiteUrl: async (input) => {
        opened.push(input);
      },
    });
    await renderPageListWithEditorRoute();
    fireEvent.click(screen.getByRole('button', { name: 'Preview Live page' }));
    await waitFor(() => expect(opened).toEqual([{ path: '/live' }]));
    expect(screen.queryByTestId('editor-route')).toBeNull();
    expect(screen.getByTestId('page-title-live')).toBeTruthy();
  });

  test('without a parent, Preview opens the cache-busted live-site URL in a new tab', async () => {
    configureUI({ siteBaseUrl: 'https://site.example' });
    const opened: unknown[][] = [];
    const realOpen = window.open;
    window.open = (...args: unknown[]) => {
      opened.push(args);
      return null;
    };
    try {
      await renderPageListWithEditorRoute();
      fireEvent.click(screen.getByRole('button', { name: 'Preview Live page' }));
      expect(opened).toHaveLength(1);
      expect(String(opened[0]?.[0])).toMatch(/^https:\/\/site\.example\/live\?_t=\d+$/);
      expect(opened[0]?.[1]).toBe('_blank');
      expect(screen.queryByTestId('editor-route')).toBeNull();
    } finally {
      window.open = realOpen;
    }
  });
});

function clipboardRow(path: string) {
  const clipboardPage: Page = {
    id: 'same-page',
    title: 'Shared page',
    path,
    type: 'puck',
    status: 'published',
    modified: new Date(RECENTLY),
    locales: ['en', 'nl'],
  };
  return (
    <MemoryRouter>
      <table>
        <tbody>
          <PageRow page={clipboardPage} selectedLocale="en" isMultiLocale onPreview={() => {}} onDelete={() => {}} />
        </tbody>
      </table>
    </MemoryRouter>
  );
}

function missingClipboardWrite() {
  throw new Error('No pending clipboard write');
}

/** Locale changes can reuse a row, but clipboard feedback belongs to the path that was copied. */
describe('PageRow clipboard identity', () => {
  test.each(['copied', 'failed'] as const)('clears %s feedback when the path changes', async (outcome) => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          if (outcome === 'failed') throw new Error('Clipboard refused');
        },
      },
    });
    try {
      const view = render(clipboardRow('/about'));
      fireEvent.click(screen.getByRole('button', { name: 'Copy path for Shared page' }));
      await waitFor(() =>
        expect(screen.getByRole('status').textContent).toContain(outcome === 'failed' ? 'Could not copy' : 'Copied'),
      );
      view.rerender(clipboardRow('/nl/over-ons'));
      expect(screen.getAllByRole('status').every((region) => region.textContent === '')).toBe(true);
      expect(screen.getByRole('button', { name: 'Copy path for Shared page' }).title).toBe('Copy path');
    } finally {
      if (original) Object.defineProperty(navigator, 'clipboard', original);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  test('a pending write cannot mark a different path as copied', async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    let finish: () => void = missingClipboardWrite;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => pending } });
    try {
      const view = render(clipboardRow('/about'));
      fireEvent.click(screen.getByRole('button', { name: 'Copy path for Shared page' }));
      view.rerender(clipboardRow('/nl/over-ons'));
      await act(async () => {
        finish();
        await pending;
      });
      expect(screen.getAllByRole('status').every((region) => region.textContent === '')).toBe(true);
      expect(screen.getByRole('button', { name: 'Copy path for Shared page' }).title).toBe('Copy path');
    } finally {
      finish();
      if (original) Object.defineProperty(navigator, 'clipboard', original);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });
});

interface ClipboardCompletion {
  resolve?: () => void;
  reject?: (reason: Error) => void;
}

function deferredClipboardWrite() {
  const completion: ClipboardCompletion = {};
  const promise = new Promise<void>((resolve, reject) => {
    completion.resolve = resolve;
    completion.reject = reject;
  });
  if (!completion.resolve || !completion.reject) throw new Error('Missing promise completion');
  return { promise, resolve: completion.resolve, reject: completion.reject };
}

/** Clipboard writes and expiry timers are controlled independently to expose stale feedback. */
describe('PageRow clipboard feedback', () => {
  test.each(['copied', 'failed'] as const)(
    'guards pending clicks and announces a fresh copy after %s feedback',
    async (outcome) => {
      const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
      const first = deferredClipboardWrite();
      const second = deferredClipboardWrite();
      let attempts = 0;
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => (++attempts === 1 ? first.promise : second.promise) },
      });
      try {
        await renderPageList();
        const copy = screen.getByRole('button', { name: 'Copy path for Live page' });
        const status = copy.nextElementSibling;
        expect(status?.getAttribute('role')).toBe('status');
        expect(status?.getAttribute('aria-live')).toBe('polite');
        expect(status?.textContent).toBe('');
        fireEvent.click(copy);
        fireEvent.click(copy);
        expect(attempts).toBe(1);
        expect(copy.hasAttribute('disabled')).toBe(false);
        expect(copy.getAttribute('aria-disabled')).toBe('true');
        await act(async () => {
          if (outcome === 'failed') first.reject(new Error('Clipboard refused'));
          else first.resolve();
          await first.promise.catch(() => {});
        });
        expect(status?.textContent).toContain(outcome === 'failed' ? 'Could not copy' : 'Copied');
        fireEvent.click(copy);
        expect(
          within(screen.getByRole('table'))
            .getAllByRole('status')
            .every((region) => region.textContent === ''),
        ).toBe(true);
        expect(attempts).toBe(2);
        await act(async () => {
          second.resolve();
          await second.promise;
        });
        expect(status?.textContent).toBe('Copied page path.');
        expect(copy.hasAttribute('disabled')).toBe(false);
      } finally {
        await act(async () => {
          first.resolve();
          second.resolve();
          await Promise.allSettled([first.promise, second.promise]);
        });
        if (original) Object.defineProperty(navigator, 'clipboard', original);
        else Reflect.deleteProperty(navigator, 'clipboard');
      }
    },
  );

  test.each(['copied', 'failed'] as const)(
    'expires %s feedback independently across rows and clears timers on unmount',
    async (outcome) => {
      const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async () => {
            if (outcome === 'failed') throw new Error('Clipboard refused');
          },
        },
      });
      const pages: Page[] = ['Live', 'Fresh'].map((title) => ({
        id: title.toLowerCase(),
        title: `${title} page`,
        path: `/${title.toLowerCase()}`,
        type: 'puck',
        status: 'published',
        modified: new Date(RECENTLY),
        locales: ['en'],
      }));
      const table = () => (
        <MemoryRouter>
          <PageTable pages={pages} selectedLocale="en" isMultiLocale={false} onPreview={() => {}} onDelete={() => {}} />
        </MemoryRouter>
      );
      const view = render(table());
      const timers = new Map<number, () => void>();
      let nextId = 0;
      const clock: Pick<Window, 'setTimeout' | 'clearTimeout'> = window;
      const schedule = spyOn(clock, 'setTimeout').mockImplementation((handler, delay) => {
        if (typeof handler !== 'function' || delay !== 2000) throw new Error('Unexpected feedback timer');
        const id = ++nextId;
        timers.set(id, () => handler());
        return id;
      });
      const cancel = spyOn(clock, 'clearTimeout').mockImplementation((id) => {
        if (id !== undefined) timers.delete(id);
      });
      try {
        const first = screen.getByRole('button', { name: 'Copy path for Live page' });
        const second = screen.getByRole('button', { name: 'Copy path for Fresh page' });
        await act(async () => {
          fireEvent.click(first);
        });
        await act(async () => {
          fireEvent.click(second);
        });
        expect(screen.getAllByRole('status')).toHaveLength(2);
        expect(timers.size).toBe(2);
        const expireFirst = timers.get(1);
        if (!expireFirst) throw new Error('Missing first feedback timer');
        act(() => expireFirst());
        expect(first.title).toBe('Copy path');
        expect(screen.getAllByRole('status').filter((status) => status.textContent !== '')).toHaveLength(1);
        await act(async () => {
          fireEvent.click(first);
        });
        expect(screen.getAllByRole('status')).toHaveLength(2);
        expect(timers.size).toBe(2);
        const firstPage = pages[0];
        if (!firstPage) throw new Error('Missing first page');
        firstPage.path = '/changed';
        view.rerender(table());
        expect(timers.size).toBe(1);
        expect(screen.getByRole('button', { name: 'Copy path for Live page' }).title).toBe('Copy path');
        cleanup();
        expect(timers.size).toBe(0);
      } finally {
        cleanup();
        schedule.mockRestore();
        cancel.mockRestore();
        if (original) Object.defineProperty(navigator, 'clipboard', original);
        else Reflect.deleteProperty(navigator, 'clipboard');
      }
    },
  );
});
