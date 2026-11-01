/// <reference lib="dom" />
/**
 * Moving or deleting an image some pages link leaves those links broken: nothing rewrites them. So before either
 * is confirmed, the dialog lists the pages that use the image, and its confirm button waits until that list is known.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { AssetEntry } from '@conloca/content-api-client';
import { ContentAPIClient, getContentAPIClient, setContentAPIClient } from '@conloca/content-api-client';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { AssetCard } from '../src/components/media/AssetCard.js';
import { AssetDetailSidebar } from '../src/components/media/AssetDetailSidebar.js';
import { MediaPage } from '../src/components/pages/MediaPage.js';
import { clearMediaCache } from '../src/frame/media-cache.js';
import type { MediaLoadInput } from '../src/frame/protocol.js';
import { configureUI } from '../src/ui-config.js';
import { renderWithProviders } from './test-utils.js';

const BASE_URL = '/__cms/api';
const USED = [
  { page: '/about (en)', field: 'content.puckData.content[0].props.image' },
  { page: '/team (en)', field: 'meta.featuredImage' },
];

const team: AssetEntry = {
  filename: 'team.png',
  originalName: 'team.png',
  mimeType: 'image/png',
  size: 1,
  uploadedAt: '2026-01-01T00:00:00.000Z',
  folder: '/',
};
const logo: AssetEntry = { ...team, filename: 'logo.png', originalName: 'logo.png' };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

let deleteCalls = 0;
let moveCalls = 0;
/** How the fake content API answers a usage question; each test may replace it. */
let answerUsage: (path: string) => Response | Promise<Response>;

async function serve(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    'http://localhost',
  );
  const route = url.pathname.slice(BASE_URL.length);
  const method = init?.method ?? 'GET';
  if (method === 'GET' && route.startsWith('/assets/usage/')) {
    return answerUsage(decodeURIComponent(route.slice('/assets/usage/'.length)));
  }
  switch (`${method} ${route}`) {
    case 'GET /assets/folders':
      return json({ assets: [team, logo], folders: [{ name: 'archive', path: '/archive' }] });
    case 'GET /assets/folder-tree':
      return json({ tree: [{ name: 'archive', path: '/archive', assetCount: 0, children: [] }] });
    case 'POST /assets/move':
      moveCalls++;
      return json({ success: true, moved: 1 });
  }
  if (method === 'DELETE') {
    deleteCalls++;
    return json({ success: true });
  }
  return new Response('Not found', { status: 404 });
}

let previousClient: ContentAPIClient;

beforeEach(() => {
  previousClient = getContentAPIClient();
  // Bun's `typeof fetch` also carries `preconnect`, which the client never calls.
  setContentAPIClient(
    new ContentAPIClient({ baseUrl: BASE_URL, fetch: Object.assign(serve, { preconnect: () => {} }) }),
  );
  deleteCalls = 0;
  moveCalls = 0;
  answerUsage = (path) => json({ usage: path === 'team.png' ? USED : [] });
});

afterEach(() => {
  cleanup();
  setContentAPIClient(previousClient);
});

/** Whether the button labelled `name` is disabled; a control that is no button is a wrong label, not an enabled one. */
function buttonDisabled(name: string) {
  const button = screen.getByRole('button', { name });
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${name} is not a button`);
  return button.disabled;
}

async function openDetails(name: string) {
  renderWithProviders(<MediaPage />, undefined, false);
  fireEvent.click(await screen.findByTitle(name));
}

describe('the pages using an image, before it is moved or deleted', () => {
  test('deleting an image used by two pages lists both pages before the delete is confirmed', async () => {
    await openDetails('team.png');
    fireEvent.click(await screen.findByText('Delete Asset'));

    const confirm = screen.getByTestId('asset-delete-confirm');
    expect(await within(confirm).findByText('/about (en)')).toBeTruthy();
    expect(within(confirm).getByText('/team (en)')).toBeTruthy();
    expect(
      within(confirm).getByText(
        'These pages use this image. Their links are not changed; they will show a broken image until you update them.',
      ),
    ).toBeTruthy();
    expect(deleteCalls).toBe(0);
  });

  test('moving selected images lists every page that uses any of them in the move dialog', async () => {
    renderWithProviders(<MediaPage />, undefined, false);
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(await screen.findByTitle('team.png'));
    fireEvent.click(await screen.findByTitle('logo.png'));
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));

    const dialog = within(screen.getByTestId('move-folder-dialog'));
    expect(await dialog.findByText('/about (en)')).toBeTruthy();
    expect(dialog.getByText('/team (en)')).toBeTruthy();
  });

  test('the confirm stays disabled while usage is loading and after it fails, until a retry succeeds', async () => {
    const held: ((response: Response) => void)[] = [];
    answerUsage = () =>
      new Promise((resolve) => {
        held.push(resolve);
      });
    renderWithProviders(<MediaPage />, undefined, false);
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(await screen.findByTitle('team.png'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('Checking which pages use this image…')).toBeTruthy();
    expect(buttonDisabled('Confirm Delete')).toBe(true);

    for (const release of held) release(json({ error: { code: 'INTERNAL_ERROR', message: 'boom' } }, 500));
    expect(await screen.findByText('Could not check which pages use this image.')).toBeTruthy();
    expect(buttonDisabled('Confirm Delete')).toBe(true);

    answerUsage = () => json({ usage: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(buttonDisabled('Confirm Delete')).toBe(false));
    expect(deleteCalls).toBe(0);
  });

  test('an unused image confirms without a usage list', async () => {
    await openDetails('logo.png');
    fireEvent.click(await screen.findByText('Delete Asset'));

    await waitFor(() => expect(buttonDisabled('Yes, Delete')).toBe(false));
    expect(screen.queryByText(/These pages use this image/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, Delete' }));
    await waitFor(() => expect(deleteCalls).toBe(1));
    expect(moveCalls).toBe(0);
  });
});

describe('library thumbnails and details', () => {
  let loads: MediaLoadInput[] = [];

  beforeEach(() => {
    loads = [];
    configureUI({
      loadMedia: async (input) => {
        loads.push(input);
        return new Blob(['png']);
      },
    });
  });

  afterEach(() => {
    clearMediaCache();
    configureUI({});
  });

  test('an image linked from the site folder loads through the repository route', async () => {
    renderWithProviders(
      <AssetCard asset={{ ...team, folder: '/library', ref: '/assets/library/team.png' }} />,
      undefined,
      false,
    );
    await screen.findByRole('img');
    expect(loads).toEqual([{ route: 'repo', path: 'library/team.png' }]);
  });

  test('a card names the file as stored, not the name it was uploaded under', () => {
    renderWithProviders(
      <AssetCard asset={{ ...team, filename: 'team-1.png', originalName: 'team.png' }} />,
      undefined,
      false,
    );
    expect(screen.getByText('team-1.png')).toBeTruthy();
    expect(screen.queryByText('team.png')).toBeNull();
  });

  test('an image with no known size or upload date shows neither', () => {
    renderWithProviders(
      <AssetDetailSidebar asset={{ ...team, size: 0, uploadedAt: '' }} onClose={() => {}} />,
      undefined,
      false,
    );
    expect(screen.queryByText('Size')).toBeNull();
    expect(screen.queryByText('Uploaded')).toBeNull();
  });
});
