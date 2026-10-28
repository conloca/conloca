/// <reference lib="dom" />
/**
 * Route smoke: every route of the CMS shell is opened through the real route table and its
 * primary action is performed, the way an author does.
 *
 * Component tests feed one well-formed fixture into one component, so a button that goes
 * nowhere or a form that crashes once its data arrives passes them all. Here the whole app is
 * mounted at each route over the real content API, and a render error that reaches a route's
 * error boundary counts as a failure wherever it happens.
 *
 * Adding a route to `routeElements` fails the last test until the route gets a case here.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContentAPIRouter, InMemoryContentAPI } from '@conloca/content-api/node';
import { ContentAPIClient, setContentAPIClient } from '@conloca/content-api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, waitForElementToBeRemoved } from '@testing-library/react';
import {
  createMemoryRouter,
  createRoutesFromElements,
  type RouteObject,
  RouterProvider,
  type RouterProviderProps,
  useRouteError,
} from 'react-router-dom';
import { routeElements } from '../src/App.js';
import { CmsSpaApp } from '../src/CmsSpaApp.js';
import { getDataSchemas, setDataSchemas } from '../src/data-schemas.js';
import { ThemeProvider } from '../src/hooks/useTheme.js';
import type { HostSchema } from '../src/host-schema.js';
import { getPuckConfig } from '../src/puck-config.js';
import { configureUI } from '../src/ui-config.js';
import { bioFields } from './fixtures/typia/host-schemas.js';
import { setupTestAPI, testApi } from './test-utils.js';

const ROUTE_CRASHED_TEST_ID = 'route-crashed';

/**
 * Stands in for the app's error screen on every route: whatever that screen looks like (react-router's
 * developer page or the app's own), a render error that reaches it fails the case with its message.
 */
function RouteCrashed() {
  const error = useRouteError();
  return (
    <div data-testid={ROUTE_CRASHED_TEST_ID}>
      Route crashed: {error instanceof Error ? error.message : String(error)}
    </div>
  );
}

/** The routes that have a smoke case, filled in as the cases below are declared. */
const smokedRoutes = new Set<string>();

function describeRoute(path: string, cases: () => void) {
  smokedRoutes.add(path);
  describe(`the ${path} route`, cases);
}

/** Every page a route of the table can show, as the full path of its route: layouts only nest. */
function pathsOfRoutes(routes: RouteObject[], parent = ''): string[] {
  return routes.flatMap((route) => {
    const own = route.path ? `${parent.replace(/\/$/, '')}/${route.path.replace(/^\//, '')}` : parent;
    if (route.children) return pathsOfRoutes(route.children, own);
    return [own || '/'];
  });
}

/** Gives each route, nested ones too, the sentinel as its error boundary; returns the routes it was given. */
function withCrashSentinel(routes: RouteObject[]): RouteObject[] {
  for (const route of routes) {
    route.errorElement = <RouteCrashed />;
    if (route.children) withCrashSentinel(route.children);
  }
  return routes;
}

/** The table `App` mounts, each route's boundary swapped for the sentinel so no crash is caught by anything else. */
function mountedRoutes(): RouteObject[] {
  return withCrashSentinel(
    createRoutesFromElements(routeElements({ puckConfig: getPuckConfig(), dataSchemas: getDataSchemas() })),
  );
}

/** The CMS as the SPA mounts it, opened at `path`; the router is returned to read where a click led. */
function openCms(path: string): RouterProviderProps['router'] {
  const router = createMemoryRouter(mountedRoutes(), { initialEntries: [path] });
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: Number.POSITIVE_INFINITY, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return router;
}

/** Throws with the crash's own message when a route's render error was caught by a boundary. */
function failOnRouteCrash() {
  const crashed = screen.queryByTestId(ROUTE_CRASHED_TEST_ID);
  if (crashed) throw new Error(crashed.textContent ?? 'a route crashed');
}

/**
 * Polls `check` until it passes. A route that crashed meanwhile fails the poll at once with the crash's message,
 * where it would otherwise time out on whatever the crashed page no longer shows.
 */
function settled<T>(check: () => T) {
  return waitFor(() => {
    failOnRouteCrash();
    return check();
  });
}

function showing(testId: string) {
  return settled(() => screen.getByTestId(testId));
}

function showingHeading(name: string | RegExp) {
  return settled(() => screen.getByRole('heading', { level: 1, name }));
}

/**
 * Whether the button is disabled. Not jest-dom's toBeDisabled inside a poll: each failing poll makes bun's
 * expect pretty-print the happy-dom element. A control that is no button is a wrong test id, not an enabled one.
 */
function isDisabled(control: HTMLElement) {
  if (!(control instanceof HTMLButtonElement)) throw new Error(`${control.tagName} is not a button`);
  return control.disabled;
}

/** The localized entry a page, fragment or data entry has; fails with the reason when it was never written. */
async function savedEntry(id: string) {
  const entry = await testApi.getLocalized(id, 'en');
  if (!entry) throw new Error(`${id} has no English version`);
  return entry.localized;
}

/** The id a created fixture got, or why it got none. */
function idOf(created: { id?: string; reason?: string }, what: string) {
  if (!created.id) throw new Error(`fixture ${what} was not created: ${created.reason}`);
  return created.id;
}

/** The id the editor route of the open page or fragment carries. */
function openedId(router: RouterProviderProps['router']) {
  const id = router.state.location.pathname.split('/').at(-1);
  if (!id) throw new Error(`no id in ${router.state.location.pathname}`);
  return id;
}

async function seedPage(title: string, pathname: string) {
  const created = await testApi.createContent({
    kind: 'page',
    site: 'default',
    collection: 'pages',
    type: 'puck',
    meta: { title },
    locales: { en: { meta: { title }, pathname, content: { puckData: { root: {}, content: [], zones: {} } } } },
  });
  return idOf(created, 'page');
}

async function seedFragment(title: string, name: string) {
  const created = await testApi.createContent({
    kind: 'fragment',
    collection: 'fragments',
    type: 'mdx',
    name,
    meta: { title },
    locales: { en: { meta: { title }, content: { mdx: `# ${title}` } } },
  });
  return idOf(created, 'fragment');
}

async function seedData(collection: string, name: string, title: string) {
  const created = await testApi.createContent({
    kind: 'data',
    collection,
    type: 'json',
    name,
    meta: { title },
    locales: { en: { meta: { title }, content: { data: {} } } },
  });
  return idOf(created, 'data entry');
}

/** Fill in and submit the New Entry dialog for an author titled Anna Schmidt; the entry's editor opens after it. */
async function submitNewAuthor() {
  await showingHeading('Data');
  fireEvent.click(screen.getByTestId('new-data-button'));
  await showing('create-data-dialog');
  fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Anna Schmidt' } });
  fireEvent.click(screen.getByTestId('create-data-submit'));
}

beforeEach(() => {
  setupTestAPI();
  setDataSchemas({ authors: bioFields });
});

afterEach(() => {
  cleanup();
  testApi?.clear();
  setDataSchemas({});
  configureUI({});
});

describeRoute('/', () => {
  test('shows the dashboard with the counts of what the site has', async () => {
    await seedPage('Home', '/');
    openCms('/');

    await showingHeading('Dashboard');
    await settled(() => expect(screen.getByTestId('section-card-pages-count').textContent).toMatch(/^1\b/));
  });

  test('New Page opens the new-page dialog', async () => {
    openCms('/');
    await showingHeading('Dashboard');

    // By its text, not its role: what matters is the dialog it opens, whatever element the control is.
    fireEvent.click(screen.getByText('New Page'));

    await showing('create-page-dialog');
  });

  test('Upload leads to the media library', async () => {
    const router = openCms('/');
    await showingHeading('Dashboard');

    fireEvent.click(screen.getByRole('link', { name: 'Upload' }));

    await showingHeading('Media');
    expect(router.state.location.pathname).toBe('/media');
  });

  test.each([
    ['pages', '/pages', 'Pages'],
    ['fragments', '/fragments', 'Fragments'],
    ['data', '/data', 'Data'],
    ['media', '/media', 'Media'],
  ])('the %s card leads to its section', async (card, path, heading) => {
    const router = openCms('/');
    await showingHeading('Dashboard');

    fireEvent.click(screen.getByTestId(`section-card-${card}`));

    await showingHeading(heading);
    expect(router.state.location.pathname).toBe(path);
  });

  test('a page in the recent activity opens in the page editor', async () => {
    const id = await seedPage('Recently edited', '/recent');
    const router = openCms('/');

    await showingHeading('Dashboard');

    fireEvent.click(await settled(() => screen.getByText('Recently edited')));

    await showing('mock-puck-editor');
    expect(router.state.location.pathname).toBe(`/pages/${id}`);
  });
});

describeRoute('/pages', () => {
  test('lists the pages of the site', async () => {
    const id = await seedPage('About us', '/about');
    openCms('/pages');

    await showingHeading('Pages');
    await showing(`page-title-${id}`);
  });

  test('New Page creates the page and lands in its editor', async () => {
    const router = openCms('/pages');
    await showingHeading('Pages');

    fireEvent.click(screen.getByTestId('new-page-button'));
    await showing('create-page-dialog');
    fireEvent.change(screen.getByTestId('page-title-input'), { target: { value: 'Smoke page' } });
    fireEvent.change(screen.getByTestId('page-path-input'), { target: { value: '/smoke-page' } });
    await settled(() => expect(isDisabled(screen.getByTestId('create-page-submit'))).toBe(false));
    fireEvent.click(screen.getByTestId('create-page-submit'));

    await showing('mock-puck-editor');
    const created = await savedEntry(openedId(router));
    expect(created.pathname).toBe('/smoke-page');
    expect(created.meta.title).toBe('Smoke page');
  });
});

describeRoute('/pages/:id', () => {
  test('opens the page in the editor and saves an edit', async () => {
    const id = await seedPage('Editable', '/editable');
    openCms(`/pages/${id}`);

    await showing('preview-button');
    fireEvent.click(screen.getByTestId('mock-puck-change'));
    await settled(() => expect(isDisabled(screen.getByRole('button', { name: 'Save' }))).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await settled(async () => {
      expect(JSON.stringify((await savedEntry(id)).content)).toContain('"changed"');
    });
  });
});

describeRoute('/fragments', () => {
  test('lists the fragments of the site', async () => {
    const id = await seedFragment('Footer', 'footer');
    openCms('/fragments');

    await showingHeading('Fragments');
    await showing(`fragment-title-${id}`);
  });

  test('New Fragment creates the fragment and lands in its editor', async () => {
    const router = openCms('/fragments');
    await showingHeading('Fragments');

    fireEvent.click(screen.getByTestId('new-fragment-button'));
    await showing('create-fragment-dialog');
    fireEvent.change(screen.getByTestId('fragment-title-input'), { target: { value: 'Smoke fragment' } });
    await settled(() => expect(isDisabled(screen.getByTestId('create-fragment-submit'))).toBe(false));
    fireEvent.click(screen.getByTestId('create-fragment-submit'));

    await showingHeading(/^Edit: /);
    expect((await savedEntry(openedId(router))).meta.title).toBe('Smoke fragment');
  });
});

describeRoute('/fragments/:id', () => {
  test('opens the fragment in the editor and goes back to the list', async () => {
    const id = await seedFragment('Banner', 'banner');
    const router = openCms(`/fragments/${id}`);

    fireEvent.click(await settled(() => screen.getByRole('button', { name: 'Back to fragments' })));

    await showingHeading('Fragments');
    expect(router.state.location.pathname).toBe('/fragments');
  });
});

describeRoute('/data', () => {
  test('lists the entries of the collections the site defines', async () => {
    openCms('/data');

    await showingHeading('Data');
    await showing('new-data-button');
  });

  test('New Entry creates the entry and opens its form', async () => {
    openCms('/data');

    await submitNewAuthor();

    const editor = await showing('edit-data-dialog');
    expect(editor.contains(await settled(() => screen.getByLabelText(/^Bio/)))).toBe(true);
    expect(Array.from(testApi.listAllContent({ kind: 'data', collection: 'authors' }))).toHaveLength(1);
  });

  test('Save in the entry editor keeps what was typed', async () => {
    openCms('/data');
    await submitNewAuthor();

    fireEvent.change(await settled(() => screen.getByLabelText(/^Bio/)), { target: { value: 'Writes about tests' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    // Not waitFor(() => expect(dialog).toBeNull()): each failing poll makes bun's expect pretty-print the
    // happy-dom element, which blocked the event loop for seconds.
    await waitForElementToBeRemoved(() => screen.queryByTestId('edit-data-dialog'));
    // The removal also happens when the route crashes and the sentinel takes the page over.
    failOnRouteCrash();
    const [entry] = Array.from(testApi.listAllContent({ kind: 'data', collection: 'authors' }));
    if (!entry) throw new Error('the entry was not created');
    expect((await savedEntry(entry.id)).content).toMatchObject({ data: { bio: 'Writes about tests' } });
  });

  test('New Entry on a collection whose schema is not a generated host schema shows a notice, not a crash', async () => {
    // A site bundle built before the generated contract exports a validator-library object with no
    // `metadata`. The editor gets it from the bundle at runtime, so parsing JSON stands in for that
    // untyped boundary: the types promise a HostSchema that nothing checks.
    const outdatedSchema: HostSchema = JSON.parse('{"shape":{"name":{"type":"string"}}}');
    setDataSchemas({ authors: outdatedSchema });
    openCms('/data');

    await submitNewAuthor();

    // The crash came after the entry loaded, so the dialog alone proves nothing: wait for the notice.
    await showing('schema-form-outdated-schema');
    expect(Array.from(testApi.listAllContent({ kind: 'data', collection: 'authors' }))).toHaveLength(1);
  });

  test('an entry of a collection with no schema explains that instead of showing a form', async () => {
    const id = await seedData('notes', 'first-note', 'First note');
    openCms('/data');
    await showingHeading('Data');

    fireEvent.click(await showing(`data-title-${id}`));
    fireEvent.click(screen.getByTitle('Edit data'));

    await settled(() => expect(screen.getByTestId('edit-data-dialog').textContent).toContain('No Schema Defined'));
  });
});

describeRoute('/media', () => {
  let root: string;
  let assetsPath: string;
  let mediaClient: ContentAPIClient;

  /**
   * The media routes need an assets folder, which the shared in-memory API does not serve: use a real one.
   * It replaces the content client the outer `beforeEach` installed; the next case's outer `beforeEach`
   * installs the shared one again.
   */
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'conloca-route-smoke-'));
    assetsPath = join(root, 'assets');
    const contentRoot = join(root, 'content');
    await Promise.all([mkdir(assetsPath), mkdir(contentRoot)]);
    const api = new InMemoryContentAPI({
      sites: { default: { locales: ['en'], defaultLocale: 'en' } },
      globalLocales: ['en'],
    });
    const router = createContentAPIRouter(api, { assetsPath, contentRoot });
    const fetchRouter = async (input: RequestInfo | URL, init?: RequestInit) => router.request(input, init);
    mediaClient = new ContentAPIClient({
      baseUrl: 'http://localhost:4321',
      // Bun's `typeof fetch` also carries `preconnect`, which the client never calls.
      fetch: Object.assign(fetchRouter, { preconnect: () => {} }),
    });
    setContentAPIClient(mediaClient);
  });

  afterEach(async () => {
    // Unmount first: a mounted library would list the folders while they are removed. This hook runs before
    // the file's own `afterEach`, which would otherwise unmount after the removal.
    cleanup();
    await rm(root, { recursive: true, force: true });
  });

  test('shows the media library', async () => {
    openCms('/media');

    await showingHeading('Media');
    await showing('folder-tree-sidebar');
  });

  test('Upload opens the upload dialog', async () => {
    openCms('/media');
    await showingHeading('Media');

    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    await settled(() => screen.getByRole('heading', { name: 'Upload Assets' }));
  });

  test('New Folder creates the folder and lists it', async () => {
    openCms('/media');
    await showingHeading('Media');

    fireEvent.click(screen.getByTitle('New Folder'));
    fireEvent.change(await showing('folder-name-input'), { target: { value: 'Campaign' } });
    fireEvent.click(screen.getByTestId('create-folder-submit'));

    await settled(() => screen.getByTitle('Campaign'));
    expect((await stat(join(assetsPath, 'Campaign'))).isDirectory()).toBe(true);
  });

  describe('in an editor inside a parent frame', () => {
    test('opens at the path the parent gave and leaves the address bar alone', async () => {
      const addressBefore = window.location.pathname;
      configureUI({
        contentClient: mediaClient,
        memoryRouter: { initialPath: '/media', onNavigate() {}, subscribe: () => () => {} },
      });
      render(<CmsSpaApp />);

      await showingHeading('Media');
      expect(window.location.pathname).toBe(addressBefore);
    });
  });
});

describe('the smoke cases', () => {
  test('cover every route of the route table, and only those', () => {
    const tablePaths = pathsOfRoutes(mountedRoutes());

    expect(tablePaths.filter((path) => !smokedRoutes.has(path))).toEqual([]);
    expect([...smokedRoutes].filter((path) => !tablePaths.includes(path))).toEqual([]);
  });
});
