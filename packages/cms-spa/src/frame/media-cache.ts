/** Object URLs of media bytes loaded through `UIConfig.loadMedia`, for surfaces that cannot point `<img>` at a media route. */
import { useRef, useSyncExternalStore } from 'react';
import { getUIConfig } from '../ui-config.js';
import { assetPath, buildAssetServeUrl } from '../utils/asset-url.js';
import type { MediaLoadInput } from './protocol.js';

/** shortcut: count cap, not bytes; switch to a byte budget if large libraries show memory pressure. */
export const MEDIA_CACHE_LIMIT = 300;

/** No `url` means loading or failed; either way the key is not loaded again until the cache is cleared. */
interface MediaEntry {
  url?: string;
  blob?: Blob;
  /** Settles when the load does, whether it loaded, failed or was discarded. */
  loaded?: Promise<void>;
}

// Map order is recency: a read moves its entry to the end, eviction takes from the front.
const entries = new Map<string, MediaEntry>();
const listeners = new Set<() => void>();
let version = 0;
// Bumped by every clear, so a mounted hook stops holding on to a URL from before the clear.
let generation = 0;

function notify() {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function currentVersion() {
  return version;
}

/** The entry for `key`, moved to most recently used when it holds a URL. */
function touch(key: string): MediaEntry | undefined {
  const entry = entries.get(key);
  if (entry?.url) {
    entries.delete(key);
    entries.set(key, entry);
  }
  return entry;
}

function evict() {
  let held = 0;
  for (const entry of entries.values()) if (entry.url) held += 1;
  for (const [key, entry] of entries) {
    if (held <= MEDIA_CACHE_LIMIT) return;
    if (!entry.url) continue;
    URL.revokeObjectURL(entry.url);
    entries.delete(key);
    held -= 1;
  }
}

/** The entry of `path` on `route`: a hit refreshes its recency; a miss starts its one load. `undefined` without a loader. */
function entryFor(route: MediaLoadInput['route'], path: string): MediaEntry | undefined {
  const key = `${route}:${path}`;
  const entry = touch(key);
  if (entry) return entry;
  const loadMedia = getUIConfig().loadMedia;
  if (!loadMedia) return undefined;
  const pending: MediaEntry = {};
  entries.set(key, pending);
  pending.loaded = loadMedia({ route, path }).then(
    (blob) => {
      // Cleared (or replaced) while loading: these bytes may be stale.
      if (entries.get(key) !== pending) return;
      pending.url = URL.createObjectURL(blob);
      pending.blob = blob;
      touch(key);
      evict();
      notify();
    },
    () => {},
  );
  return pending;
}

/**
 * The object URL of `path` on `route`: a hit refreshes its recency; a miss starts one load and
 * returns `undefined` (so does a key that is loading or failed, and every key without a loader).
 */
export function mediaObjectUrl(route: MediaLoadInput['route'], path: string): string | undefined {
  return entryFor(route, path)?.url;
}

/** The object URL and bytes of `path` on `route` once loaded through the same cache; `undefined` if that fails or there is no loader. */
export async function loadedMedia(
  route: MediaLoadInput['route'],
  path: string,
): Promise<{ url: string; blob: Blob } | undefined> {
  const entry = entryFor(route, path);
  await entry?.loaded;
  return entry?.url && entry.blob ? { url: entry.url, blob: entry.blob } : undefined;
}

/** Revokes every URL and forgets every key, failed ones included; loads still running are discarded when they land. */
export function clearMediaCache(): void {
  for (const entry of entries.values()) if (entry.url) URL.revokeObjectURL(entry.url);
  entries.clear();
  generation += 1;
  notify();
}

/** A number that changes whenever a URL arrives or the cache is cleared; re-renders the caller then. */
export function useMediaCacheVersion(): number {
  return useSyncExternalStore(subscribe, currentVersion, currentVersion);
}

/**
 * The object URL of `path` on `route`, re-rendering when it arrives. Once shown, a URL stays
 * for the same key until the cache is cleared, even if eviction drops its entry meanwhile, so
 * a mounted thumbnail neither flickers nor loads again.
 */
export function useMediaObjectUrl(route: MediaLoadInput['route'], path: string): string | undefined {
  useMediaCacheVersion();
  const key = `${route}:${path}`;
  const shown = useRef<{ key: string; url: string; generation: number } | undefined>(undefined);
  if (shown.current?.key === key && shown.current.generation === generation) {
    touch(key);
    return shown.current.url;
  }
  const url = mediaObjectUrl(route, path);
  if (url) shown.current = { key, url, generation };
  return url;
}

/** The `src` of an asset thumbnail: an object URL of loaded bytes with a loader, else the serve URL. */
export function useAssetServeSrc(
  assetsBasePath: string,
  folder: string | undefined,
  filename: string,
): string | undefined {
  const loaded = useMediaObjectUrl('serve', assetPath(folder, filename));
  return getUIConfig().loadMedia ? loaded : buildAssetServeUrl(assetsBasePath, folder, filename);
}
