import {
  ContentAPIClient,
  type ContentListResult,
  type ContentManifest,
  contentEtag,
  ErrorCodes,
  localesOf,
  setContentAPIClient,
} from '@conloca/content-api-client';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { expect, fn, spyOn, userEvent, waitFor, within } from 'storybook/test';
import '../../main.css';
import { ThemeProvider } from '../../hooks/useTheme.js';
import { configureUI } from '../../ui-config.js';
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
  schedule: { publishAt?: string; unpublishAt?: string; unpublished?: true } = {},
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
  const remove = (url: URL, init?: RequestInit): Response => {
    const id = url.pathname.slice('/__conloca/api/content/'.length);
    const target = items.find((item) => item.id === id);
    const etag = new Headers(init?.headers).get('If-Match');
    const locale = url.searchParams.get('locale');
    if (!target) return json({ success: false, error: 'Content not found' }, 404);
    const expectedEtag = locale
      ? target.locales[locale]?.etag
      : contentEtag(Object.fromEntries(Array.from(localesOf(target), (version) => [version.locale, version.etag])));
    if (onDelete === 'deleted' && etag === expectedEtag) {
      items = locale
        ? items.map((item) =>
            item.id === id
              ? {
                  ...item,
                  locales: Object.fromEntries(Object.entries(item.locales).filter(([key]) => key !== locale)),
                }
              : item,
          )
        : items.filter((item) => item.id !== id);
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
  };
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
    if (method === 'DELETE' && url.pathname.startsWith('/__conloca/api/content/')) return remove(url, init);
    return json({ success: false, error: 'Not found' }, 404);
  };
  // Bun's `typeof fetch` carries `preconnect`; the client never calls it, but
  // the shape has to be honest rather than asserted past.
  return Object.assign(respond, { preconnect: fetch.preconnect });
}

function CurrentLocation() {
  const location = useLocation();
  return (
    <output hidden data-testid="page-route">
      {location.pathname + location.search}
    </output>
  );
}

/** Stands in for the page editor route, so a story can see where the list sent the author. */
function EditorRoute() {
  const { id } = useParams();
  return <p data-testid="editor-route">Editor for {id}</p>;
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
          <Routes>
            <Route path="/pages" element={<PageList />} />
            <Route path="/pages/:id" element={<EditorRoute />} />
          </Routes>
          <CurrentLocation />
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

/** A site with no Conloca pages explains why, and its Create Page action opens the create dialog. */
export const NoPagesYet: Story = {
  render: () => <PageListStory pages={{ kind: 'pages', items: [] }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('heading', { name: 'No Conloca pages yet' })).toBeVisible();
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

const NEW_WORKSPACE_PAGES = [
  page('vx-home', 'Home', '/'),
  page('vx-new', 'homepage 2', '/homepage-2', { unpublished: true }),
];

/** A page created and not yet published reads Draft in the list, beside a live page that reads Published. */
export const NeverPublishedPageReadsDraft: Story = {
  render: () => <PageListStory pages={{ kind: 'pages', items: NEW_WORKSPACE_PAGES }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const statusBadges = async (id: string) => {
      const row = (await canvas.findByTestId(`page-title-${id}`)).closest('tr');
      if (!row) throw new Error(`${id} has no row`);
      return within(row);
    };
    await expect((await statusBadges('vx-new')).getAllByText('Draft').length).toBeGreaterThan(0);
    await expect((await statusBadges('vx-new')).queryByText('Published')).toBeNull();
    await expect((await statusBadges('vx-home')).getAllByText('Published').length).toBeGreaterThan(0);
  },
};

/** The Draft filter lists the never-published page and leaves the live one out. */
export const DraftFilterListsNeverPublishedPage: Story = {
  render: () => <PageListStory pages={{ kind: 'pages', items: NEW_WORKSPACE_PAGES }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const table = await canvas.findByRole('table');
    await userEvent.selectOptions(canvas.getByDisplayValue('All Status'), 'draft');
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(2));
    await expect(canvas.getByTestId('page-title-vx-new')).toBeVisible();
    await expect(canvas.queryByTestId('page-title-vx-home')).toBeNull();
  },
};

/** Delete asks first; confirming removes the page through the client. */
export const DeleteAsksFirst: Story = {
  render: () => <PageListStory pages={{ kind: 'pages', items: PAGES }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByTestId('page-actions-vx-pricing'));
    const body = within(document.body);
    await userEvent.click(await body.findByRole('menuitem', { name: 'Delete' }));
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
    await userEvent.click(await canvas.findByTestId('page-actions-vx-pricing'));
    const body = within(document.body);
    await userEvent.click(await body.findByRole('menuitem', { name: 'Delete' }));
    await userEvent.click(await body.findByRole('button', { name: 'Confirm Delete' }));
    await expect(await body.findByText('Failed to delete page. Please try again.')).toBeVisible();
    await userEvent.click(body.getByRole('button', { name: 'Close error dialog' }));
    await waitFor(() => expect(body.queryByText('Failed to delete page. Please try again.')).toBeNull());
    await expect(canvas.getByTestId('page-title-vx-pricing')).toBeVisible();
  },
};

/*
 * Row actions: the row opens the page editor, the eye opens the preview.
 *
 * The editor route is a stand-in element, so a story reads where the list sent the author. The parent app that
 * opens the live site is a recorded `openSiteUrl`; `window.open` is replaced in every story here so a regression
 * that opens a tab again shows as a failed assertion instead of a stray tab in the test browser.
 */

const previewed: string[] = [];

/** A parent app that opens the live site: the story reads the paths Preview asked it for. */
function parentOpensPreview() {
  previewed.length = 0;
  configureUI({
    openSiteUrl: async ({ path }) => {
      previewed.push(path);
    },
  });
  const open = spyOn(window, 'open').mockImplementation(() => null);
  return () => {
    open.mockRestore();
    configureUI({});
  };
}

async function rowOf(canvasElement: HTMLElement, id: string): Promise<HTMLElement> {
  const row = (await within(canvasElement).findByTestId(`page-title-${id}`)).closest('tr');
  if (!row) throw new Error(`${id} has no row`);
  return row;
}

/** What a real pointer would hit at the centre of `element` (a click helper dispatches on the element it is given). */
function elementUnderCentreOf(element: HTMLElement): Element {
  element.scrollIntoView({ block: 'nearest' });
  const box = element.getBoundingClientRect();
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  if (!hit) throw new Error('nothing is under the centre of the element');
  return hit;
}

/** A click anywhere on a row, not just on its title text, opens that page's editor and opens no tab. */
export const RowClickOpensEditor: Story = {
  render: () => <PageListStory pages={{ kind: 'pages', items: PAGES }} />,
  beforeEach: parentOpensPreview,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = await rowOf(canvasElement, 'vx-pricing');
    const title = canvas.getByTestId('page-title-vx-pricing');
    await expect(canvas.getByRole('button', { name: 'Pricing' })).toBe(title);

    // Every visible cell except Actions hands a pointer to the title button: it is the row's click target.
    const cells = within(row)
      .getAllByRole('cell')
      .filter((cell) => cell.checkVisibility());
    await expect(cells.length).toBeGreaterThan(1);
    const hits = cells.slice(0, -1).map(elementUnderCentreOf);
    await expect(hits.every((hit) => hit === title)).toBe(true);

    // The gap between action buttons is part of the row too, not a dead zone.
    const eyeBox = within(row).getByRole('button', { name: 'Preview Pricing' }).getBoundingClientRect();
    const copyBox = within(row).getByRole('button', { name: 'Copy path for Pricing' }).getBoundingClientRect();
    await expect(copyBox.left).toBeGreaterThan(eyeBox.right);
    const gap = document.elementFromPoint((eyeBox.right + copyBox.left) / 2, eyeBox.top + eyeBox.height / 2);
    await expect(gap).toBe(title);

    const [, ...otherCells] = cells.slice(0, -1);
    const navigationCell = otherCells[0] ?? cells[0];
    if (!navigationCell) throw new Error('the row has no visible primary cell');
    await userEvent.click(elementUnderCentreOf(navigationCell));

    await expect(await canvas.findByTestId('editor-route')).toHaveTextContent('Editor for vx-pricing');
    await expect(canvas.queryByRole('table')).toBeNull();
    await expect(window.open).not.toHaveBeenCalled();
    await expect(previewed).toEqual([]);
  },
};

/** The eye opens preview through the parent app independently of the row and locale editor controls. */
export const EyeOpensPreviewNotEditor: Story = {
  render: () => <PageListStory pages={{ kind: 'pages', items: PAGES }} />,
  beforeEach: parentOpensPreview,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, 'vx-pricing');
    await expect(canvas.getByTestId('edit-vx-pricing')).toBeVisible();

    const eye = canvas.getByRole('button', { name: 'Preview Pricing' });
    await expect(eye.contains(elementUnderCentreOf(eye))).toBe(true);
    await userEvent.click(eye);

    await waitFor(() => expect(previewed).toEqual(['/pricing']));
    await expect(canvas.queryByTestId('editor-route')).toBeNull();
    await expect(canvas.getByTestId('page-title-vx-pricing')).toBeVisible();
    await expect(window.open).not.toHaveBeenCalled();
  },
};

/** Without a parent app to open it, Preview opens the page's cache-busted live-site URL in a new tab. */
export const EyeOpensNewTabWithoutParent: Story = {
  render: () => <PageListStory pages={{ kind: 'pages', items: PAGES }} />,
  beforeEach: () => {
    configureUI({ siteBaseUrl: 'https://site.example' });
    const open = spyOn(window, 'open').mockImplementation(() => null);
    return () => {
      open.mockRestore();
      configureUI({});
    };
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Preview Launch announcement' }));
    await expect(window.open).toHaveBeenCalledTimes(1);
    await expect(window.open).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/site\.example\/blog\/launch\?_t=\d+$/),
      '_blank',
    );
    await expect(canvas.queryByTestId('editor-route')).toBeNull();
  },
};

/**
 * Keyboard: the title button is the row's tab stop and Enter on it opens the editor; the eye is the next stop and
 * Enter or Space on it previews without opening the editor.
 */
export const KeyboardReachesEditorButtonThenPreview: Story = {
  render: () => <PageListStory pages={{ kind: 'pages', items: PAGES }} />,
  beforeEach: parentOpensPreview,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const title = await canvas.findByTestId('page-title-vx-home');
    // Tab from the search box: status filter, sort, then the first row's title button.
    await userEvent.click(canvas.getByPlaceholderText('Search pages...'));
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    await expect(title).toHaveFocus();

    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Preview Home' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(previewed).toEqual(['/']));
    await userEvent.keyboard(' ');
    await waitFor(() => expect(previewed).toEqual(['/', '/']));
    await expect(canvas.queryByTestId('editor-route')).toBeNull();

    await userEvent.tab({ shift: true });
    await expect(title).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect(await canvas.findByTestId('editor-route')).toHaveTextContent('Editor for vx-home');
  },
};

/** Regression: Delete still asks first and does not open the editor, and cancelling leaves the row in place. */
export const DeleteDoesNotOpenEditor: Story = {
  render: () => <PageListStory pages={{ kind: 'pages', items: PAGES }} />,
  beforeEach: parentOpensPreview,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const actions = await canvas.findByTestId('page-actions-vx-pricing');
    await expect(actions.contains(elementUnderCentreOf(actions))).toBe(true);
    await userEvent.click(actions);
    await expect(canvas.queryByTestId('editor-route')).toBeNull();

    const body = within(document.body);
    await userEvent.click(await body.findByRole('menuitem', { name: 'Delete' }));
    await expect(await body.findByTestId('delete-item-name')).toHaveTextContent('Pricing');
    await expect(canvas.queryByTestId('editor-route')).toBeNull();
    await userEvent.click(body.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(body.queryByTestId('delete-confirm-message')).toBeNull());
    await expect(canvas.queryByTestId('editor-route')).toBeNull();
    await expect(within(await canvas.findByRole('table')).getAllByRole('row')).toHaveLength(1 + PAGES.length);
  },
};

const ABOUT = page('vx-about', 'About', '/about');
const TRANSLATED_ABOUT: ContentManifest = {
  ...ABOUT,
  locales: {
    ...ABOUT.locales,
    nl: {
      locale: 'nl',
      pathname: '/nl/over-ons',
      etag: 'vx-about.nl.1',
      created: LONG_AGO,
      modified: RECENTLY,
      meta: { title: 'Over ons' },
    },
  },
};

/** A translated page keeps one row title and one preview eye beside a single locale editor control. */
export const TranslatedPageHasOneEye: Story = {
  render: () => <PageListStory pages={{ kind: 'pages', items: [TRANSLATED_ABOUT, ...PAGES] }} />,
  beforeEach: parentOpensPreview,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = await rowOf(canvasElement, 'vx-about');
    await expect(within(row).getAllByTestId('locale-indicator')).toHaveLength(2);
    await expect(within(row).getAllByRole('button', { name: /^Preview / })).toHaveLength(1);
    await expect(within(row).getAllByRole('button', { name: /^Edit$/ })).toHaveLength(1);
    await expect(within(row).getAllByRole('button', { name: 'About' })).toHaveLength(1);
    await userEvent.click(within(row).getByRole('button', { name: 'Preview About' }));
    await waitFor(() => expect(previewed).toEqual(['/about']));
    await expect(canvas.queryByTestId('editor-route')).toBeNull();
  },
};

/** Space on the focused title opens the editor, as Enter does. */
export const SpaceOnTitleOpensEditor: Story = {
  render: () => <PageListStory pages={{ kind: 'pages', items: PAGES }} />,
  beforeEach: parentOpensPreview,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const title = await canvas.findByTestId('page-title-vx-launch');
    title.focus();
    await expect(title).toHaveFocus();
    await userEvent.keyboard(' ');
    await expect(await canvas.findByTestId('editor-route')).toHaveTextContent('Editor for vx-launch');
    await expect(previewed).toEqual([]);
  },
};

/** Regression: the row's raised action buttons stay beneath the New Page dialog and cannot be clicked through it. */
export const NewPageDialogCoversRowActions: Story = {
  render: () => <PageListStory pages={{ kind: 'pages', items: PAGES }} />,
  beforeEach: parentOpensPreview,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const eye = await canvas.findByRole('button', { name: 'Preview Pricing' });
    await expect(eye.contains(elementUnderCentreOf(eye))).toBe(true);
    await userEvent.click(canvas.getByTestId('new-page-button'));
    await expect(await within(document.body).findByTestId('page-title-input')).toBeVisible();
    await expect(eye.contains(elementUnderCentreOf(eye))).toBe(false);
    await expect(previewed).toEqual([]);
  },
};

/** The actual title selector used by staging opens the editor through its real pointer target. */
export const TitleSelectorOpensEditor: Story = {
  render: () => <PageListStory pages={{ kind: 'pages', items: PAGES }} />,
  beforeEach: parentOpensPreview,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const title = await canvas.findByTestId('page-title-vx-pricing');
    await userEvent.click(elementUnderCentreOf(title));
    await expect(await canvas.findByTestId('editor-route')).toHaveTextContent('Editor for vx-pricing');
    await expect(previewed).toEqual([]);
  },
};

export const RowOverlayWithoutPositionedTableRows: Story = {
  render: () => <PageListStory pages={{ kind: 'pages', items: PAGES }} />,
  beforeEach: parentOpensPreview,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, 'vx-pricing');
    // The overlay must stay within its row even when table-row positioning is ignored.
    for (const row of canvasElement.querySelectorAll('tbody tr')) {
      if (row instanceof HTMLElement) row.style.position = 'static';
    }
    const title = canvas.getByTestId('page-title-vx-home');
    await expect(elementUnderCentreOf(title)).toBe(title);
    const create = canvas.getByTestId('new-page-button');
    await expect(create.contains(elementUnderCentreOf(create))).toBe(true);
    await userEvent.click(title);
    await expect(await canvas.findByTestId('editor-route')).toHaveTextContent('Editor for vx-home');
    await expect(previewed).toEqual([]);
    await expect(window.open).not.toHaveBeenCalled();
  },
};

/** Every action must fit inside the scroll viewport and receive a real pointer hit. */
async function assertMobileActionsFit(row: HTMLElement, title: HTMLElement) {
  const wrapper = row.closest('table')?.parentElement;
  if (!wrapper) throw new Error('The page table has no scroll wrapper.');
  const bounds = wrapper.getBoundingClientRect();
  await Promise.all(
    within(row)
      .getAllByRole('button')
      .filter((action) => action !== title)
      .map(async (action) => {
        const box = action.getBoundingClientRect();
        await expect(box.left).toBeGreaterThanOrEqual(bounds.left);
        await expect(box.right).toBeLessThanOrEqual(bounds.right);
        await expect(action.contains(elementUnderCentreOf(action))).toBe(true);
      }),
  );
  await expect(wrapper.scrollWidth).toBeLessThanOrEqual(wrapper.clientWidth);
}

/** A narrow row still has a background click target when the other columns are hidden. */
export const MobileRowClickOpensEditor: Story = {
  render: () => <PageListStory pages={{ kind: 'pages', items: PAGES }} />,
  beforeEach: parentOpensPreview,
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  play: async ({ canvasElement }) => {
    const row = await rowOf(canvasElement, 'vx-pricing');
    await assertMobileActionsFit(row, within(row).getByRole('button', { name: 'Pricing' }));
    const cell = within(row).getAllByRole('cell')[0];
    if (!cell) throw new Error('The page has no title cell.');
    await userEvent.click(elementUnderCentreOf(cell));
    await expect(await within(canvasElement).findByTestId('editor-route')).toHaveTextContent('Editor for vx-pricing');
    await expect(previewed).toEqual([]);
  },
};

const clipboardWrite = fn<Clipboard['writeText']>();

/** Copy path is independent of both editor navigation and preview. */
export const CopyPathKeepsThePageList: Story = {
  render: () => <PageListStory pages={{ kind: 'pages', items: PAGES }} />,
  beforeEach: () => {
    const restorePreview = parentOpensPreview();
    clipboardWrite.mockReset();
    clipboardWrite.mockResolvedValue(undefined);
    const copy = spyOn(navigator.clipboard, 'writeText').mockImplementation(clipboardWrite);
    return () => {
      copy.mockRestore();
      restorePreview();
    };
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const copy = await canvas.findByRole('button', { name: 'Copy path for Pricing' });
    copy.focus();
    await userEvent.keyboard('{Enter}');
    await expect(clipboardWrite).toHaveBeenCalledWith('/pricing');
    await expect(
      canvas.getAllByRole('status').find((status) => status.textContent === 'Copied page path.'),
    ).toBeDefined();
    await expect(canvas.getByTestId('page-title-vx-pricing')).toBeVisible();
    await expect(canvas.queryByTestId('editor-route')).toBeNull();
    await expect(previewed).toEqual([]);
    await expect(window.open).not.toHaveBeenCalled();
  },
};

/** A narrow row contains its editor and preview controls, and its menu exposes every locale safely. */
export const MobileTranslatedActionsFit: Story = {
  render: () => <PageListStory pages={{ kind: 'pages', items: [TRANSLATED_ABOUT] }} />,
  beforeEach: parentOpensPreview,
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  play: async ({ canvasElement }) => {
    const row = await rowOf(canvasElement, 'vx-about');
    await expect(within(row).getByRole('button', { name: /^Edit$/ })).toBeVisible();
    await expect(within(row).getByRole('button', { name: 'Choose locale for About' })).toBeVisible();
    await assertMobileActionsFit(row, within(row).getByRole('button', { name: 'About' }));
    await userEvent.click(within(row).getByRole('button', { name: 'More actions for About' }));
    const body = within(document.body);
    await expect(await body.findByRole('menuitem', { name: 'Delete en version' })).toBeVisible();
    await expect(body.getByRole('menuitem', { name: 'Delete nl version' })).toBeVisible();
    await expect(within(canvasElement).queryByTestId('editor-route')).toBeNull();
  },
};

const MULTILINGUAL_PAGES = structuredClone(PAGES);
for (const entry of MULTILINGUAL_PAGES) {
  const english = entry.locales.en;
  if (!english) throw new Error('English fixture is missing');
  entry.locales.rs = { ...english, locale: 'rs', pathname: `/rs${english.pathname}`, etag: `${entry.id}.rs.1` };
  entry.locales.ru = { ...english, locale: 'ru', pathname: `/ru${english.pathname}`, etag: `${entry.id}.ru.1` };
}

/** The locale menu offers every language and opens the chosen version through the actual editor route. */
export const LocaleActions: Story = {
  render: () => <PageListStory pages={{ kind: 'pages', items: MULTILINGUAL_PAGES }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByTestId('edit-locales-vx-home'));
    const body = within(document.body);
    await expect((await body.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual(['en', 'rs', 'ru']);
    await userEvent.click(body.getByRole('menuitem', { name: 'rs' }));
    await expect(canvas.getByTestId('page-route')).toHaveTextContent('/pages/vx-home?locale=rs');
  },
};

/** The primary Edit control opens the first locale through the actual editor route. */
export const PrimaryEditOpensFirstLocale: Story = {
  render: () => <PageListStory pages={{ kind: 'pages', items: MULTILINGUAL_PAGES }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByTestId('edit-vx-home'));
    await expect(canvas.getByTestId('page-route')).toHaveTextContent('/pages/vx-home?locale=en');
    await expect(await canvas.findByTestId('editor-route')).toHaveTextContent('Editor for vx-home');
  },
};

/** Locale deletion preserves the page and its remaining versions. */
export const DeleteLocaleKeepsOtherVersions: Story = {
  render: () => <PageListStory pages={{ kind: 'pages', items: MULTILINGUAL_PAGES }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByTestId('page-actions-vx-home'));
    const body = within(document.body);
    await expect((await body.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual([
      'Delete',
      'Delete en version',
      'Delete rs version',
      'Delete ru version',
    ]);
    await userEvent.click(body.getByRole('menuitem', { name: 'Delete rs version' }));
    await expect(body.getByTestId('delete-confirm-message')).toHaveTextContent('rs version');
    await userEvent.click(body.getByRole('button', { name: 'Confirm Delete' }));
    await waitFor(() => expect(body.queryByTestId('delete-confirm-message')).toBeNull());
    const row = canvas.getByTestId('page-title-vx-home').closest('tr');
    if (!row) throw new Error('Home has no row');
    await waitFor(() =>
      expect(
        within(row)
          .getAllByTestId('locale-indicator')
          .map((item) => item.textContent),
      ).toEqual(['en', 'ru']),
    );
  },
};

/** The leading Delete action removes all language versions after confirmation. */
export const DeleteAllLocales: Story = {
  ...DeleteAsksFirst,
  render: () => <PageListStory pages={{ kind: 'pages', items: MULTILINGUAL_PAGES }} />,
};
