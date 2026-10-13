import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContentAPIRouter, InMemoryContentAPI } from '@conloca/content-api/node';
import { ContentAPIClient, setContentAPIClient } from '@conloca/content-api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, waitForElementToBeRemoved } from '@testing-library/react';
import { MediaPage } from '../src/components/pages/MediaPage.js';

/**
 * The details panel the media library opens for a clicked picture. It edits what is saved for that
 * picture, so it has to follow each save, and leave alone what is being typed when a save comes back.
 */
describe('the details panel of the media library', () => {
  let assetsPath: string;
  let contentRoot: string;
  let client: ContentAPIClient;
  let queryClient: QueryClient;
  // While set, folder listings wait for it, the way a slow reply does
  let listingHeld: Promise<void> | null = null;
  let releaseListing = () => {};

  beforeEach(async () => {
    assetsPath = join(tmpdir(), `conloca-detail-panel-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    contentRoot = `${assetsPath}-content`;
    await Promise.all([mkdir(assetsPath, { recursive: true }), mkdir(contentRoot, { recursive: true })]);
    await writeFile(join(assetsPath, 'beach.png'), new Uint8Array([0x89, 0x50]));
    await writeFile(
      join(assetsPath, '.asset-manifest.json'),
      JSON.stringify({ 'beach.png': { originalName: 'beach.png', alt: 'Yellow sand', tags: ['beach'] } }),
    );

    const api = new InMemoryContentAPI({
      sites: { default: { locales: ['en'], defaultLocale: 'en' } },
      globalLocales: ['en'],
    });
    const router = createContentAPIRouter(api, { assetsPath, contentRoot });
    const fetchRouter = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (listingHeld && url.includes('/assets/folders') && (init?.method ?? 'GET') === 'GET') await listingHeld;
      return router.request(input, init);
    };
    client = new ContentAPIClient({
      baseUrl: 'http://localhost:4321',
      fetch: Object.assign(fetchRouter, { preconnect: () => {} }),
    });
    setContentAPIClient(client);
  });

  afterEach(async () => {
    releaseListing();
    listingHeld = null;
    await Promise.all([
      rm(assetsPath, { recursive: true, force: true }),
      rm(contentRoot, { recursive: true, force: true }),
    ]);
  });

  async function openBeach() {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<MediaPage />, {
      wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
    });
    fireEvent.click(await screen.findByTitle('beach.png'));
    return screen.findByLabelText('Alt Text');
  }

  function holdListings() {
    listingHeld = new Promise((resolve) => {
      releaseListing = resolve;
    });
  }

  async function releaseListings() {
    await act(async () => {
      releaseListing();
      listingHeld = null;
    });
  }

  // How this tab learns of a change made in another one
  async function refreshListings() {
    await act(() => queryClient.invalidateQueries({ queryKey: ['asset-folders'] }));
  }

  async function savedBeach(): Promise<{ alt?: string; tags?: string[] } | undefined> {
    return (await client.getAsset('beach.png')) ?? undefined;
  }

  test('saves alt text changed back to what it was', async () => {
    const alt = await openBeach();
    fireEvent.change(alt, { target: { value: 'Golden sand' } });
    fireEvent.blur(alt);
    // The grid shows the saved text once the folder's listing comes back
    await screen.findAllByAltText('Golden sand');

    fireEvent.change(alt, { target: { value: 'Yellow sand' } });
    fireEvent.blur(alt);

    await waitFor(async () => expect((await savedBeach())?.alt).toBe('Yellow sand'));
  });

  test('keeps and then saves what is typed again in a field while its last save comes back', async () => {
    const alt = await openBeach();
    holdListings();
    fireEvent.change(alt, { target: { value: 'Golden sand' } });
    fireEvent.blur(alt);
    await waitFor(async () => expect((await savedBeach())?.alt).toBe('Golden sand'));

    fireEvent.focus(alt);
    fireEvent.change(alt, { target: { value: 'Golden sand at dusk' } });
    await releaseListings();
    await screen.findAllByAltText('Golden sand');
    expect(alt).toHaveValue('Golden sand at dusk');

    fireEvent.blur(alt);
    await waitFor(async () => expect((await savedBeach())?.alt).toBe('Golden sand at dusk'));
  });

  test('keeps tags being typed while an alt text save comes back', async () => {
    const alt = await openBeach();
    fireEvent.change(alt, { target: { value: 'Golden sand' } });
    fireEvent.blur(alt);
    fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'beach, sea' } });

    await screen.findAllByAltText('Golden sand');

    expect(screen.getByLabelText('Tags')).toHaveValue('beach, sea');
  });

  test('keeps the Move dialog open while an alt text saved just before comes back', async () => {
    const alt = await openBeach();
    fireEvent.change(alt, { target: { value: 'Golden sand' } });
    fireEvent.blur(alt);
    fireEvent.click(screen.getByText('Move to Folder'));

    await screen.findAllByAltText('Golden sand');

    expect(screen.queryByTestId('move-folder-dialog')).not.toBeNull();
  });

  test('stays closed once its picture is deleted elsewhere, even when a new picture then takes its name', async () => {
    await openBeach();
    await client.deleteAsset('beach.png');
    await refreshListings();
    await waitForElementToBeRemoved(() => screen.queryByLabelText('Alt Text'));

    const upload = new FormData();
    upload.append('file', new File([new Uint8Array([0x89, 0x50])], 'beach.png', { type: 'image/png' }));
    await client.uploadAsset(upload);
    await refreshListings();
    await screen.findAllByTitle('beach.png');

    expect(screen.queryByLabelText('Alt Text')).toBeNull();
  });
});
