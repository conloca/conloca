import type { QueryClient } from '@tanstack/react-query';

/** The editor caches a host Save can change: stored docs and page lists, or image scopes and issues. */
export type StaleEditorQueries = 'content' | 'media';

type StaleForwarder = (stale: StaleEditorQueries) => void;

let forwarder: StaleForwarder | null = null;

declare global {
  interface Window {
    // oxlint-disable-next-line no-underscore-dangle -- `CmsSpaApp` commits its client under this existing browser-global name.
    __QUERY_CLIENT__?: QueryClient;
  }
}

/**
 * Register where {@link invalidateEditorQueries} also goes when the editor runs in another window (a framed editor
 * page). Returns unregister.
 */
export function registerEditorQueriesForwarder(fn: StaleForwarder): () => void {
  forwarder = fn;
  return () => {
    if (forwarder === fn) forwarder = null;
  };
}

/**
 * Refresh the editor's cached answers a host Save may have changed. A Publish rewrites every draft address to its
 * repo link in stored docs (new etags) and publishes the pages it committed, so a cached doc would turn the next save
 * into a false `stale_write` conflict and a cached page list would keep calling those pages Draft; it also flips an
 * upload's scope to `published`, and a refused image lights its issue badge. Reaches the editor's client through the
 * `window.__QUERY_CLIENT__` global `CmsSpaApp` commits, and a framed editor through the registered forwarder.
 */
export function invalidateEditorQueries(stale: StaleEditorQueries): void {
  forwarder?.(stale);
  if (typeof window === 'undefined') return;
  // oxlint-disable-next-line no-underscore-dangle -- the browser global declared above.
  const client = window.__QUERY_CLIENT__;
  if (!client) return;
  if (stale === 'media') {
    void client.invalidateQueries({ queryKey: ['asset-scope'] });
    void client.invalidateQueries({ queryKey: ['media-issue'] });
    return;
  }
  void client.invalidateQueries({ queryKey: ['content'] });
  // The page lists, `['sites', <site>, 'pages', <locale?>]`; the rest of `['sites']` does not depend on what a Save commits.
  void client.invalidateQueries({ predicate: ({ queryKey }) => queryKey[0] === 'sites' && queryKey[2] === 'pages' });
}
