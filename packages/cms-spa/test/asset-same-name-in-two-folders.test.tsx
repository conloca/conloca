import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContentAPIRouter, InMemoryContentAPI } from '@conloca/content-api/node';
import { type AssetEntry, ContentAPIClient, setContentAPIClient } from '@conloca/content-api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ImageFieldRender } from '../src/components/fields/ImageField.js';
import { AssetDetailSidebar } from '../src/components/media/AssetDetailSidebar.js';
import { MediaPage } from '../src/components/pages/MediaPage.js';
import { buildAssetPath } from '../src/utils/asset-url.js';

/**
 * Two pictures with the same name in different folders: `beach.png` at the top of the assets folder
 * and `trip/beach.png`. Uploading only avoids a clash inside one folder, so this is an ordinary
 * library. The editor named the picture it edited or deleted by its file name alone, and the
 * server took the first manifest entry with that name, so changing the alt text of one picture
 * could change the other's, and deleting one could delete the other.
 */
describe('a picture that shares its name with one in another folder', () => {
  let assetsPath: string;
  let contentRoot: string;
  let api: InMemoryContentAPI;
  let client: ContentAPIClient;

  beforeEach(async () => {
    assetsPath = join(tmpdir(), `conloca-same-name-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    contentRoot = `${assetsPath}-content`;
    await Promise.all([mkdir(join(assetsPath, 'trip'), { recursive: true }), mkdir(contentRoot, { recursive: true })]);
    await writeFile(join(assetsPath, 'beach.png'), new Uint8Array([0x89, 0x50]));
    await writeFile(join(assetsPath, 'trip', 'beach.png'), new Uint8Array([0x89, 0x50]));
    // The manifest lists the top-level picture first, so a lookup by name alone finds it.
    await writeFile(
      join(assetsPath, '.asset-manifest.json'),
      JSON.stringify({ 'beach.png': { originalName: 'beach.png' }, 'trip/beach.png': { originalName: 'beach.png' } }),
    );

    api = new InMemoryContentAPI({
      sites: { default: { locales: ['en'], defaultLocale: 'en' } },
      globalLocales: ['en'],
    });
    const router = createContentAPIRouter(api, { assetsPath, contentRoot });
    // The router serves its routes from its own root, where the dev server mounts it under a prefix.
    const fetchRouter = async (input: RequestInfo | URL, init?: RequestInit) => router.request(input, init);
    client = new ContentAPIClient({
      baseUrl: 'http://localhost:4321',
      fetch: Object.assign(fetchRouter, { preconnect: () => {} }),
    });
    setContentAPIClient(client);
  });

  afterEach(async () => {
    await Promise.all([
      rm(assetsPath, { recursive: true, force: true }),
      rm(contentRoot, { recursive: true, force: true }),
    ]);
  });

  function renderWithQueries(ui: ReactElement) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    return render(ui, {
      wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
    });
  }

  async function beachIn(folder: string): Promise<AssetEntry> {
    const { assets } = await client.listFolder(folder);
    const asset = assets.find((a) => a.filename === 'beach.png');
    if (!asset) throw new Error(`beach.png is missing from the listing of ${folder}`);
    return asset;
  }

  const tripBeach = () => beachIn('/trip');

  async function assetAt(path: string): Promise<AssetEntry | null> {
    return client.getAsset(path);
  }

  test('alt text typed in the sidebar is saved on that picture only', async () => {
    renderWithQueries(<AssetDetailSidebar asset={await tripBeach()} onClose={() => {}} />);

    const alt = screen.getByLabelText('Alt Text');
    fireEvent.change(alt, { target: { value: 'Sunset over the bay' } });
    fireEvent.blur(alt);

    await waitFor(async () => expect((await assetAt('trip/beach.png'))?.alt).toBe('Sunset over the bay'));
    expect((await assetAt('beach.png'))?.alt).toBeUndefined();
  });

  test('tags typed in the sidebar are saved on that picture only', async () => {
    renderWithQueries(<AssetDetailSidebar asset={await tripBeach()} onClose={() => {}} />);

    const tags = screen.getByLabelText('Tags');
    fireEvent.change(tags, { target: { value: 'holiday, sea' } });
    fireEvent.blur(tags);

    await waitFor(async () => expect((await assetAt('trip/beach.png'))?.tags).toEqual(['holiday', 'sea']));
    expect((await assetAt('beach.png'))?.tags).toBeUndefined();
  });

  test('deleting it from the sidebar deletes that picture and keeps the other', async () => {
    let closed = false;
    renderWithQueries(
      <AssetDetailSidebar
        asset={await tripBeach()}
        onClose={() => {
          closed = true;
        }}
      />,
    );

    fireEvent.click(screen.getByText('Delete Asset'));
    fireEvent.click(screen.getByText('Yes, Delete'));

    await waitFor(() => expect(closed).toBe(true));
    expect(existsSync(join(assetsPath, 'trip', 'beach.png'))).toBe(false);
    expect(existsSync(join(assetsPath, 'beach.png'))).toBe(true);
  });

  test('the sidebar switched to it from its namesake shows its own fields, not what was typed there', async () => {
    const rootAsset = await beachIn('/');
    const { rerender } = renderWithQueries(
      <AssetDetailSidebar
        key={buildAssetPath(rootAsset.folder, rootAsset.filename)}
        asset={rootAsset}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText('Alt Text'), { target: { value: 'Yellow sand' } });
    fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'home' } });
    fireEvent.click(screen.getByText('Delete Asset'));

    const nestedAsset = await tripBeach();
    rerender(
      <AssetDetailSidebar
        key={buildAssetPath(nestedAsset.folder, nestedAsset.filename)}
        asset={nestedAsset}
        onClose={() => {}}
      />,
    );

    // Leaving a field saves what it shows, so a carried-over value would land on this picture.
    expect(screen.getByLabelText('Alt Text')).toHaveValue('');
    expect(screen.getByLabelText('Tags')).toHaveValue('');
    expect(screen.queryByText('Yes, Delete')).toBeNull();
  });

  test('the sidebar lists the pages that use it, not those that use its namesake', async () => {
    for (const [pathname, ogImage] of [
      ['/sand', '/assets/beach.png'],
      ['/trip-report', '/assets/trip/beach.png'],
    ]) {
      await api.createContent({
        kind: 'page',
        site: 'default',
        collection: 'pages',
        type: 'puck',
        locales: { en: { pathname, meta: { title: pathname, ogImage }, content: { puckData: {} } } },
      });
    }

    renderWithQueries(<AssetDetailSidebar asset={await tripBeach()} onClose={() => {}} />);

    expect(await screen.findByText('/trip-report (en)')).toBeInTheDocument();
    expect(screen.queryByText('/sand (en)')).toBeNull();
  });

  test('picking either one in an image field links it by its folder and name, where the site serves it', async () => {
    // A link to the top one used to name an `uploads` folder: a missing file, or a namesake there.
    const picked: string[] = [];
    renderWithQueries(<ImageFieldRender value="" onChange={(link) => picked.push(link)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Browse images' }));
    fireEvent.click(await screen.findByTitle('beach.png'));
    fireEvent.click(screen.getByRole('button', { name: 'Browse images' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Folder: trip' }));
    fireEvent.click(await screen.findByTitle('beach.png'));

    expect(picked).toEqual(['/assets/beach.png', '/assets/trip/beach.png']);
  });

  test('moving it from the sidebar closes the sidebar, which would still name the folder it left', async () => {
    await mkdir(join(assetsPath, 'archive'));
    let closed = false;
    renderWithQueries(
      <AssetDetailSidebar
        asset={await tripBeach()}
        onClose={() => {
          closed = true;
        }}
      />,
    );

    fireEvent.click(screen.getByText('Move to Folder'));
    fireEvent.click(await screen.findByRole('button', { name: /archive/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));

    await waitFor(() => expect(closed).toBe(true));
    expect(existsSync(join(assetsPath, 'archive', 'beach.png'))).toBe(true);
  });

  test('the sidebar asks again where it is used each time it opens, so a page saved meanwhile shows', async () => {
    // One cache for both openings, as in the editor
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const asset = await tripBeach();
    const open = () =>
      render(
        <QueryClientProvider client={queryClient}>
          <AssetDetailSidebar asset={asset} onClose={() => {}} />
        </QueryClientProvider>,
      );

    const first = open();
    expect(await screen.findByText('Not used in any pages')).toBeInTheDocument();
    first.unmount();
    await api.createContent({
      kind: 'page',
      site: 'default',
      collection: 'pages',
      type: 'puck',
      locales: {
        en: {
          pathname: '/trip-report',
          meta: { title: 'Trip', ogImage: '/assets/trip/beach.png' },
          content: { puckData: {} },
        },
      },
    });
    open();

    expect(await screen.findByText('/trip-report (en)')).toBeInTheDocument();
  });

  test('selecting it does not select its namesake once another folder is opened', async () => {
    // Bulk move and delete act on the selected names in the folder on screen.
    renderWithQueries(<MediaPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(await screen.findByTitle('beach.png'));
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'Folder: trip' }));

    await waitFor(() => expect(screen.queryByText('1 selected')).toBeNull());
  });

  test('its details panel closes when the other folder opens, instead of showing the namesake there', async () => {
    await writeFile(
      join(assetsPath, '.asset-manifest.json'),
      JSON.stringify({
        'beach.png': { originalName: 'beach.png', alt: 'Yellow sand' },
        'trip/beach.png': { originalName: 'beach.png', alt: 'Sunset' },
      }),
    );
    renderWithQueries(<MediaPage />);
    fireEvent.click(await screen.findByTitle('beach.png'));
    await screen.findByLabelText('Alt Text');

    fireEvent.click(screen.getByRole('button', { name: 'Folder: trip' }));
    // The grid shows the other folder's picture once its listing is in
    await screen.findAllByAltText('Sunset');

    expect(screen.queryByLabelText('Alt Text')).toBeNull();
  });

  test('clicking the folder already open keeps the selection', async () => {
    renderWithQueries(<MediaPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(await screen.findByTitle('beach.png'));
    fireEvent.click(await screen.findByRole('button', { name: 'Folder: Root' }));

    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });

  test('deleting it from a selection in its folder deletes that picture and keeps the other', async () => {
    renderWithQueries(<MediaPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Folder: trip' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(await screen.findByTitle('beach.png'));
    fireEvent.click(screen.getByRole('button', { name: /^Delete/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Delete' }));

    await screen.findByText(/1 deleted/);
    expect(existsSync(join(assetsPath, 'trip', 'beach.png'))).toBe(false);
    expect(existsSync(join(assetsPath, 'beach.png'))).toBe(true);
  });
});
