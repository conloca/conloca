import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { configureUI } from '../ui-config.js';
import { clearMediaCache, loadedMedia, MEDIA_CACHE_LIMIT, mediaObjectUrl, useMediaObjectUrl } from './media-cache.js';
import type { MediaLoadInput } from './protocol.js';

let loads: MediaLoadInput[] = [];
let revoke: ReturnType<typeof spyOn<typeof URL, 'revokeObjectURL'>>;

/** Starts a load for each key, then lets every load land. */
async function loadKeys(keys: string[]) {
  for (const key of keys) mediaObjectUrl('serve', key);
  await Bun.sleep(0);
}

beforeEach(() => {
  loads = [];
  configureUI({
    loadMedia: async (input) => {
      loads.push(input);
      return new Blob(['png']);
    },
  });
  revoke = spyOn(URL, 'revokeObjectURL');
});

afterEach(() => {
  clearMediaCache();
  configureUI({});
  revoke.mockRestore();
});

describe('the media object-URL cache', () => {
  test('a miss starts one load; the URL arrives for every later reader', async () => {
    expect(mediaObjectUrl('draft', 'hero.png')).toBeUndefined();
    expect(mediaObjectUrl('draft', 'hero.png')).toBeUndefined();
    await Bun.sleep(0);
    expect(loads).toEqual([{ route: 'draft', path: 'hero.png' }]);
    expect(mediaObjectUrl('draft', 'hero.png')).toStartWith('blob:');
  });

  test('serve and draft bytes of one path are separate entries', async () => {
    mediaObjectUrl('serve', 'hero.png');
    mediaObjectUrl('draft', 'hero.png');
    await Bun.sleep(0);
    expect(loads).toEqual([
      { route: 'serve', path: 'hero.png' },
      { route: 'draft', path: 'hero.png' },
    ]);
    const served = mediaObjectUrl('serve', 'hero.png');
    const draft = mediaObjectUrl('draft', 'hero.png');
    expect(served).toStartWith('blob:');
    expect(draft).toStartWith('blob:');
    expect(served).not.toBe(draft);
  });

  test('the 301st image evicts the least recently used and revokes its URL', async () => {
    const created = spyOn(URL, 'createObjectURL');
    const keys = Array.from({ length: MEDIA_CACHE_LIMIT }, (_, index) => `k${index}`);
    await loadKeys(keys);
    // Read without refreshing: the URL k1's bytes got when they landed
    const second = String(created.mock.results[1]?.value);
    created.mockRestore();
    const first = mediaObjectUrl('serve', 'k0');
    await loadKeys([`k${MEDIA_CACHE_LIMIT}`]);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith(second);
    expect(mediaObjectUrl('serve', 'k0')).toBe(first);
    expect(mediaObjectUrl('serve', `k${MEDIA_CACHE_LIMIT}`)).toStartWith('blob:');
  });

  test('a failed load is not retried until the cache is cleared', async () => {
    let calls = 0;
    configureUI({
      loadMedia: async () => {
        calls += 1;
        throw new Error('404');
      },
    });
    mediaObjectUrl('draft', 'gone.png');
    await Bun.sleep(0);
    mediaObjectUrl('draft', 'gone.png');
    await Bun.sleep(0);
    expect(calls).toBe(1);
    clearMediaCache();
    mediaObjectUrl('draft', 'gone.png');
    await Bun.sleep(0);
    expect(calls).toBe(2);
  });

  test('clearing revokes every URL, and a load that lands after the clear is discarded', async () => {
    await loadKeys(['old.png']);
    const old = mediaObjectUrl('serve', 'old.png');
    const pending = Promise.withResolvers<Blob>();
    configureUI({
      loadMedia: (input) => {
        loads.push(input);
        return pending.promise;
      },
    });
    mediaObjectUrl('serve', 'hero.png');
    clearMediaCache();
    expect(revoke).toHaveBeenCalledWith(defined(old));
    pending.resolve(new Blob(['old bytes']));
    await Bun.sleep(0);
    expect(mediaObjectUrl('serve', 'hero.png')).toBeUndefined();
    expect(loads.filter((input) => input.path === 'hero.png')).toHaveLength(2);
  });

  test('without a loader nothing is loaded', () => {
    configureUI({});
    expect(mediaObjectUrl('serve', 'a.png')).toBeUndefined();
    expect(loads).toEqual([]);
  });

  test('awaiting the bytes shares the one load and URL of the synchronous readers', async () => {
    expect(mediaObjectUrl('draft', 'hero.png')).toBeUndefined();
    const loaded = await loadedMedia('draft', 'hero.png');
    expect(loads).toEqual([{ route: 'draft', path: 'hero.png' }]);
    expect(loaded?.url).toBe(mediaObjectUrl('draft', 'hero.png'));
    expect(await loaded?.blob.text()).toBe('png');
    configureUI({ loadMedia: undefined });
    expect(await loadedMedia('draft', 'other.png')).toBeUndefined();
  });

  test('a thumbnail whose entry was evicted keeps its URL and asks for no new load', async () => {
    const { result, rerender, unmount } = renderHook(() => useMediaObjectUrl('serve', 'k0'));
    expect(result.current).toBeUndefined();
    await act(() => Bun.sleep(0));
    const shown = result.current;
    expect(shown).toStartWith('blob:');
    await act(() => loadKeys(Array.from({ length: MEDIA_CACHE_LIMIT }, (_, index) => `other${index}`)));
    expect(revoke).toHaveBeenCalledWith(defined(shown));
    rerender();
    expect(result.current).toBe(shown);
    expect(loads.filter((input) => input.path === 'k0')).toHaveLength(1);
    unmount();
  });
});

/** Narrows a URL the test already read, so a missing one fails on the assertion that uses it. */
function defined(url: string | undefined): string {
  expect(url).toBeDefined();
  return url ?? '';
}
