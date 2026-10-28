/// <reference lib="dom" />
/**
 * With a media loader the media library never hands a media route to an `<img>`: the parent frame
 * loads the bytes and the thumbnail shows an object URL of them.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { AssetEntry } from '@conloca/content-api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { CmsSpaApp } from '../src/CmsSpaApp.js';
import { AssetCard } from '../src/components/media/AssetCard.js';
import { AssetDetailSidebar } from '../src/components/media/AssetDetailSidebar.js';
import { clearMediaCache, mediaObjectUrl } from '../src/frame/media-cache.js';
import type { MediaLoadInput } from '../src/frame/protocol.js';
import { configureUI } from '../src/ui-config.js';
import { setupTestAPI } from './test-utils.js';

const ASSET: AssetEntry = {
  filename: 'hero.png',
  originalName: 'hero.png',
  mimeType: 'image/png',
  size: 3,
  uploadedAt: '2026-01-01T00:00:00.000Z',
  folder: 'uploads',
};

let loads: MediaLoadInput[] = [];

function renderWithQueries(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  setupTestAPI();
  loads = [];
  configureUI({
    loadMedia: async (input) => {
      loads.push(input);
      return new Blob(['png']);
    },
  });
});

afterEach(() => {
  cleanup();
  clearMediaCache();
  configureUI({});
});

describe('media library thumbnails with a loader', () => {
  test.each([
    ['a library card', () => <AssetCard asset={ASSET} />],
    ['the details panel', () => <AssetDetailSidebar asset={ASSET} onClose={() => {}} />],
  ])('%s shows no image until the bytes arrive, then their object URL', async (_, element) => {
    renderWithQueries(element());
    expect(screen.queryByRole('img')).toBeNull();
    const image = await screen.findByRole('img');
    expect(image.getAttribute('src')).toStartWith('blob:');
    expect(loads).toEqual([{ route: 'serve', path: 'uploads/hero.png' }]);
  });

  test('unmounting the editor drops every loaded image', async () => {
    mediaObjectUrl('serve', 'uploads/hero.png');
    await waitFor(() => expect(mediaObjectUrl('serve', 'uploads/hero.png')).toStartWith('blob:'));
    const loaded = mediaObjectUrl('serve', 'uploads/hero.png');
    const revoke = spyOn(URL, 'revokeObjectURL');
    // The browser router needs an address under the editor's basename; tests share one window.
    const address = location.href;
    history.replaceState(null, '', '/__cms/media');
    try {
      const { unmount } = render(<CmsSpaApp />);
      unmount();
      expect(revoke).toHaveBeenCalledWith(loaded ?? '');
    } finally {
      history.replaceState(null, '', address);
      revoke.mockRestore();
    }
  });
});
