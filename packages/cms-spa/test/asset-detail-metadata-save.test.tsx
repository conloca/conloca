/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ContentAPIClient, setContentAPIClient } from '@conloca/content-api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AssetDetailSidebar } from '../src/components/media/AssetDetailSidebar.js';
import { MediaPage } from '../src/components/pages/MediaPage.js';
import type { AssetEntry } from '../src/hooks/index.js';

const rootAsset: AssetEntry = {
  filename: 'hero.png',
  originalName: 'hero.png',
  mimeType: 'image/png',
  size: 4096,
  folder: '/',
  uploadedAt: '2026-01-01T00:00:00.000Z',
  alt: 'old alt',
  tags: ['old-tag'],
};

const nestedAsset: AssetEntry = { ...rootAsset, folder: '/uploads' };

/** What the fake server stores, keyed by the path that names each asset. */
let stored = new Map<string, AssetEntry>();
/** Every metadata request the page put on the wire, in order. */
let saves: { url: string; patch: Record<string, unknown> }[] = [];
let deletes: string[] = [];
let moves: unknown[] = [];
/** The next metadata save answers with a server error. */
let failNextSave = false;

const API = '/__cms/api';
const pathOf = (asset: AssetEntry) =>
  asset.folder && asset.folder !== '/' ? `${asset.folder.slice(1)}/${asset.filename}` : asset.filename;

function store(...assets: AssetEntry[]) {
  stored = new Map(assets.map((asset) => [pathOf(asset), asset]));
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const recordingFetch = async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const { pathname, searchParams } = new URL(url, 'http://cms.test');
  const metaPath = pathname.startsWith(`${API}/assets/meta/`)
    ? decodeURIComponent(pathname.slice(`${API}/assets/meta/`.length))
    : undefined;

  if (init?.method === 'PATCH' && metaPath !== undefined) {
    const patch = JSON.parse(String(init.body ?? '{}')) as { alt?: string | null; tags?: string[] | null };
    saves.push({ url, patch });
    if (failNextSave) {
      failNextSave = false;
      return json({ error: { code: 'INTERNAL_ERROR', message: 'the store is unavailable' } }, 500);
    }
    const current = stored.get(metaPath);
    if (!current) return json({ error: { code: 'NOT_FOUND', message: metaPath } }, 404);
    // The store's merge: a field the patch leaves out keeps what is stored, null clears it.
    const { alt = current.alt, tags = current.tags } = patch;
    const next: AssetEntry = { ...current, alt: alt ?? undefined, tags: tags ?? undefined };
    stored.set(metaPath, next);
    return json(next);
  }
  if (init?.method === 'DELETE' && metaPath !== undefined) {
    deletes.push(url);
    stored.delete(metaPath);
    return json({ success: true });
  }
  if (init?.method === 'POST' && pathname === `${API}/assets/move`) {
    const body = JSON.parse(String(init.body)) as { filenames: string[]; sourceFolder: string; targetFolder: string };
    moves.push(body);
    for (const filename of body.filenames) {
      const asset = [...stored.values()].find((a) => a.filename === filename && a.folder === body.sourceFolder);
      if (!asset) continue;
      stored.delete(pathOf(asset));
      const moved = { ...asset, folder: body.targetFolder };
      stored.set(pathOf(moved), moved);
    }
    return json({ success: true, moved: body.filenames.length });
  }
  if (pathname === `${API}/assets/folders`) {
    const folder = searchParams.get('path') ?? '/';
    return json({ assets: [...stored.values()].filter((a) => a.folder === folder), folders: [] });
  }
  if (pathname === `${API}/assets/folder-tree`) {
    const count = (folder: string) => [...stored.values()].filter((a) => a.folder === folder).length;
    return json({
      tree: [
        {
          name: 'Root',
          path: '/',
          assetCount: count('/'),
          children: [{ name: 'uploads', path: '/uploads', assetCount: count('/uploads'), children: [] }],
        },
      ],
    });
  }
  if (pathname.startsWith(`${API}/assets/usage/`)) return json([]);
  return json({ error: { code: 'NOT_FOUND', message: url } }, 404);
};
// Bun's `typeof fetch` carries preconnect, which the client option asks for.
recordingFetch.preconnect = () => {};

const newQueryClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

/** Waits long enough for any save a blur would have started to reach the wire. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

function renderSidebar(asset: AssetEntry = rootAsset) {
  const queryClient = newQueryClient();
  const panel = (record: AssetEntry) => (
    <QueryClientProvider client={queryClient}>
      <AssetDetailSidebar asset={record} onClose={() => {}} />
    </QueryClientProvider>
  );
  const { rerender } = render(panel(asset));
  return {
    altField: screen.getByLabelText('Alt Text'),
    tagsField: screen.getByLabelText('Tags'),
    /** Hands the open panel the same asset's record as a reloaded listing would. */
    reload: (record: AssetEntry) => rerender(panel(record)),
  };
}

beforeEach(() => {
  store(rootAsset, nestedAsset);
  saves = [];
  deletes = [];
  moves = [];
  failNextSave = false;
  setContentAPIClient(new ContentAPIClient({ baseUrl: API, fetch: recordingFetch }));
});

afterEach(cleanup);

/**
 * The panel is handed the asset's record as the folder listing last loaded
 * it. That record lags the panel's own saves by a reload, and a reload can
 * carry someone else's save. So a blur saves only the field the person left,
 * and only when they changed it since this panel last saved it — measured
 * against the panel's own last save, never against the record. The store
 * merges a save into the stored record, so a one-field save is complete.
 */
describe('AssetDetailSidebar metadata save', () => {
  test('a save of the alt text carries the alt text and nothing else', async () => {
    const { altField } = renderSidebar();

    fireEvent.change(altField, { target: { value: 'our team at work' } });
    fireEvent.blur(altField);

    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]?.patch).toEqual({ alt: 'our team at work' });
  });

  test('a save of the tags carries the tags and nothing else', async () => {
    const { tagsField } = renderSidebar();

    fireEvent.change(tagsField, { target: { value: 'hero, banner' } });
    fireEvent.blur(tagsField);

    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]?.patch).toEqual({ tags: ['hero', 'banner'] });
  });

  test('editing both fields sends each field on its own, never the stale copy of the other', async () => {
    const { altField, tagsField } = renderSidebar();

    fireEvent.change(altField, { target: { value: 'our team at work' } });
    fireEvent.blur(altField);
    fireEvent.change(tagsField, { target: { value: 'hero, banner' } });
    fireEvent.blur(tagsField);

    await waitFor(() => expect(saves).toHaveLength(2));
    expect(saves.map((save) => save.patch)).toEqual([{ alt: 'our team at work' }, { tags: ['hero', 'banner'] }]);
  });

  test('clearing the alt text sends null for the alt text alone', async () => {
    const { altField } = renderSidebar();

    fireEvent.change(altField, { target: { value: '' } });
    fireEvent.blur(altField);

    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]?.patch).toEqual({ alt: null });
  });

  test('clearing the tags sends null for the tags alone', async () => {
    const { tagsField } = renderSidebar();

    fireEvent.change(tagsField, { target: { value: '' } });
    fireEvent.blur(tagsField);

    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]?.patch).toEqual({ tags: null });
  });

  test('leaving a field untouched saves nothing', async () => {
    const { altField, tagsField } = renderSidebar();

    fireEvent.blur(altField);
    fireEvent.blur(tagsField);

    await settle();
    expect(saves).toEqual([]);
  });

  test('alt text put back to its first value after a save is saved as well', async () => {
    const { altField } = renderSidebar();

    fireEvent.change(altField, { target: { value: 'our team at work' } });
    fireEvent.blur(altField);
    await waitFor(() => expect(saves).toHaveLength(1));
    fireEvent.change(altField, { target: { value: 'old alt' } });
    fireEvent.blur(altField);

    await waitFor(() => expect(saves).toHaveLength(2));
    expect(saves.map((save) => save.patch)).toEqual([{ alt: 'our team at work' }, { alt: 'old alt' }]);
    expect(stored.get('hero.png')?.alt).toBe('old alt');
  });

  test('tags put back to their first value after a save are saved as well', async () => {
    const { tagsField } = renderSidebar();

    fireEvent.change(tagsField, { target: { value: 'hero, banner' } });
    fireEvent.blur(tagsField);
    await waitFor(() => expect(saves).toHaveLength(1));
    fireEvent.change(tagsField, { target: { value: 'old-tag' } });
    fireEvent.blur(tagsField);

    await waitFor(() => expect(saves).toHaveLength(2));
    expect(saves.map((save) => save.patch)).toEqual([{ tags: ['hero', 'banner'] }, { tags: ['old-tag'] }]);
    expect(stored.get('hero.png')?.tags).toEqual(['old-tag']);
  });

  test('a blur with no edit after a save sends nothing more', async () => {
    const { altField } = renderSidebar();

    fireEvent.change(altField, { target: { value: 'our team at work' } });
    fireEvent.blur(altField);
    await waitFor(() => expect(saves).toHaveLength(1));
    fireEvent.blur(altField);

    await settle();
    expect(saves).toHaveLength(1);
  });

  test('a save that failed is sent again on the next blur', async () => {
    failNextSave = true;
    const { altField } = renderSidebar();

    fireEvent.change(altField, { target: { value: 'our team at work' } });
    fireEvent.blur(altField);
    await waitFor(() => expect(saves).toHaveLength(1));
    await settle();
    fireEvent.blur(altField);

    await waitFor(() => expect(saves).toHaveLength(2));
    expect(stored.get('hero.png')?.alt).toBe('our team at work');
  });

  test('a failed save is sent again even when the other field was saved while it was on its way', async () => {
    failNextSave = true;
    const { altField, tagsField } = renderSidebar();

    fireEvent.change(altField, { target: { value: 'our team at work' } });
    fireEvent.blur(altField);
    fireEvent.change(tagsField, { target: { value: 'hero, banner' } });
    fireEvent.blur(tagsField);
    await waitFor(() => expect(saves).toHaveLength(2));
    await settle();
    fireEvent.blur(altField);

    await waitFor(() => expect(saves).toHaveLength(3));
    expect(saves.map((save) => save.patch)).toEqual([
      { alt: 'our team at work' },
      { tags: ['hero', 'banner'] },
      { alt: 'our team at work' },
    ]);
    expect(stored.get('hero.png')?.alt).toBe('our team at work');
  });

  test('a reloaded record carrying another save does not make an untouched field save over it', async () => {
    const { altField, reload } = renderSidebar();

    reload({ ...rootAsset, alt: 'their alt' });
    fireEvent.blur(altField);

    await settle();
    expect(saves).toEqual([]);
  });

  test('text typed in one field survives the record reloading after the other field was saved', async () => {
    const { altField, tagsField, reload } = renderSidebar();

    fireEvent.change(altField, { target: { value: 'our team at work' } });
    fireEvent.blur(altField);
    await waitFor(() => expect(saves).toHaveLength(1));
    fireEvent.change(tagsField, { target: { value: 'hero, ban' } });
    reload({ ...rootAsset, alt: 'our team at work' });

    expect(tagsField).toHaveValue('hero, ban');
    expect(altField).toHaveValue('our team at work');
  });
});

/**
 * A bare filename does not name one picture: two folders may hold a `hero.png`.
 * The server answers such a save with "say which folder" and no longer guesses,
 * so a panel that sends only the filename can never save that picture at all.
 */
describe('AssetDetailSidebar asset addressing', () => {
  test('a save names a subfolder picture by its folder and filename', async () => {
    const { altField } = renderSidebar(nestedAsset);

    fireEvent.change(altField, { target: { value: 'our team at work' } });
    fireEvent.blur(altField);

    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]?.url).toBe('/__cms/api/assets/meta/uploads/hero.png');
  });

  test('a save of a root picture keeps the bare filename, inventing no folder', async () => {
    const { altField } = renderSidebar();

    fireEvent.change(altField, { target: { value: 'our team at work' } });
    fireEvent.blur(altField);

    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]?.url).toBe('/__cms/api/assets/meta/hero.png');
  });

  test('a delete names a subfolder picture by its folder and filename', async () => {
    renderSidebar(nestedAsset);

    fireEvent.click(screen.getByText('Delete Asset'));
    fireEvent.click(screen.getByText('Yes, Delete'));

    await waitFor(() => expect(deletes).toHaveLength(1));
    expect(deletes[0]).toBe('/__cms/api/assets/meta/uploads/hero.png');
  });

  test('a delete of a root picture keeps the bare filename', async () => {
    renderSidebar();

    fireEvent.click(screen.getByText('Delete Asset'));
    fireEvent.click(screen.getByText('Yes, Delete'));

    await waitFor(() => expect(deletes).toHaveLength(1));
    expect(deletes[0]).toBe('/__cms/api/assets/meta/hero.png');
  });
});

/**
 * The media page remembers which asset its detail panel shows, by folder and
 * filename, and hands the panel that asset's record from the folder listing.
 * A panel holding a copy made when it opened keeps an asset that has moved or
 * gone, and every later save or delete names a path that no longer exists.
 */
describe('MediaPage detail panel', () => {
  beforeEach(() => store(rootAsset));

  function renderMediaPage() {
    const queryClient = newQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MediaPage />
      </QueryClientProvider>,
    );
    return queryClient;
  }

  async function openPanel() {
    fireEvent.click(await screen.findByTitle(rootAsset.originalName));
    return screen.getByLabelText('Alt Text');
  }

  test('moving the open asset to another folder closes its panel for good', async () => {
    const queryClient = renderMediaPage();
    await openPanel();

    fireEvent.click(screen.getByText('Move to Folder'));
    const dialog = await screen.findByTestId('move-folder-dialog');
    fireEvent.click(await within(dialog).findByText('uploads'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));

    await waitFor(() => expect(moves).toHaveLength(1));
    expect(moves[0]).toEqual({ filenames: ['hero.png'], sourceFolder: '/', targetFolder: '/uploads' });
    await waitFor(() => expect(screen.queryByLabelText('Alt Text')).not.toBeInTheDocument());

    // A new picture taking the name in the old folder is not the one the person
    // had open, and must not open a panel by itself.
    stored.set('hero.png', { ...rootAsset, alt: 'a different picture' });
    await queryClient.invalidateQueries();
    await screen.findByTitle(rootAsset.originalName);
    expect(screen.queryByLabelText('Alt Text')).not.toBeInTheDocument();
  });

  test('an asset gone from its folder closes its open panel once the listing reloads', async () => {
    const queryClient = renderMediaPage();
    await openPanel();

    stored.clear();
    await queryClient.invalidateQueries();

    await waitFor(() => expect(screen.queryByLabelText('Alt Text')).not.toBeInTheDocument());
  });
});
