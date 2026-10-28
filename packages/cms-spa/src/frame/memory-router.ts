import { createPath, type DataRouter, NavigationType, parsePath } from 'react-router-dom';
import type { MemoryRouterConfig } from '../ui-config.js';

/**
 * Mirrors the editor's in-memory route to a parent frame: each committed route
 * (`pathname + search`) goes to `onNavigate`, and each route the parent asks for
 * is navigated to without being reported back. Returns the function that stops
 * both directions.
 */
export function syncMemoryRouter(router: DataRouter, options: MemoryRouterConfig): () => void {
  const { location } = router.state;
  let current = location.pathname + location.search;
  let parentPath: string | undefined;

  const stopRouter = router.subscribe((state) => {
    if (state.navigation.state !== 'idle') return;
    const path = state.location.pathname + state.location.search;
    if (path === current) return;
    current = path;
    // Any commit settles the parent's request, so an interrupted one cannot swallow a later route.
    const fromParent = path === parentPath;
    parentPath = undefined;
    if (!fromParent) options.onNavigate(path, state.historyAction === NavigationType.Replace);
  });

  const stopParent = options.subscribe((path) => {
    // In the router's own spelling (`/media?` is `/media`), or the commit would not match and be echoed back.
    const normalized = createPath(parsePath(path));
    // Already there: navigating would only push a duplicate entry.
    if (normalized === current) return;
    parentPath = normalized;
    void router.navigate(path);
  });

  return () => {
    stopRouter();
    stopParent();
  };
}
