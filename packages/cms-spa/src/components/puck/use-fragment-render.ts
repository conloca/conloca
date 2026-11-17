import type { MDXHeading as FragmentHeading } from '@conloca/content-api';
import { type ComponentType, useEffect, useRef, useState } from 'react';
import { type SiteRender, useSiteRender } from '../../site-render.js';
import { withShownImages } from '../editor/draft-media-config.js';

type Rendered = { Component: ComponentType | null; error?: Error; outline: readonly FragmentHeading[] };

export type FragmentRender = { status: 'pending' } | ({ status: 'done' } & Rendered);

interface CacheEntry {
  render: SiteRender;
  key: string;
  promise: Promise<Rendered>;
  result?: Rendered;
}

const CACHE_LIMIT = 32;

// shortcut: a per-session cache; upgrade it if editors keep many large fragments open.
const cache = new WeakMap<SiteRender, Map<string, CacheEntry>>();

/** The cached render of `mdx`; on a miss, `mounted` (what the caller already shows) when it is the same render. */
function renderOf(render: SiteRender, mdx: string, mounted: CacheEntry | undefined): CacheEntry {
  let entries = cache.get(render);
  if (!entries) {
    entries = new Map();
    cache.set(render, entries);
  }
  const vocabulary = withShownImages(render.vocabulary);
  // A loader configured later changes how images show, so it is part of the key.
  const key = `${vocabulary === render.vocabulary ? 0 : 1}:${mdx}`;
  const hit = entries.get(key);
  if (hit) {
    // Refresh recency: a Map iterates in insertion order, so the first key is the least recently used.
    entries.delete(key);
    entries.set(key, hit);
    return hit;
  }
  // An entry a mounted fragment still shows, evicted by others: put it back instead of evaluating again.
  const entry: CacheEntry =
    mounted?.render === render && mounted.key === key
      ? mounted
      : {
          render,
          key,
          promise: render.evaluate(mdx, vocabulary).catch((error: unknown) => ({
            Component: null,
            error: error instanceof Error ? error : new Error(String(error)),
            outline: [],
          })),
        };
  if (!entry.result) {
    void entry.promise.then((result) => {
      entry.result = result;
    });
  }
  entries.set(key, entry);
  if (entries.size > CACHE_LIMIT) {
    for (const oldest of entries.keys()) {
      entries.delete(oldest);
      break;
    }
  }
  return entry;
}

/** `mdx` rendered with the site's renderer and vocabulary (or the editor's fallback), cached per registry snapshot. */
export function useFragmentRender(mdx: string): FragmentRender {
  const render = useSiteRender();
  const mounted = useRef<CacheEntry | undefined>(undefined);
  const entry = renderOf(render, mdx, mounted.current);
  mounted.current = entry;
  const [, settled] = useState(0);
  useEffect(() => {
    // Always subscribe: the result may land between this render and the effect, and only a re-render shows it.
    let live = true;
    void entry.promise.then(() => {
      if (live) settled((count) => count + 1);
    });
    return () => {
      live = false;
    };
  }, [entry]);
  return entry.result ? { status: 'done', ...entry.result } : { status: 'pending' };
}
