import { useEffect } from 'react';
import { type Blocker, useBlocker } from 'react-router-dom';

/**
 * Guards against losing dirty content via either browser-level navigations
 * (reload, tab close, manual URL change) or in-app SPA navigations (back
 * button, sidebar clicks, programmatic navigate()).
 *
 * Returns the react-router-dom v7 Blocker so the consumer can render its own
 * confirmation UI when `blocker.state === 'blocked'`. Call `blocker.proceed()`
 * to allow the navigation, `blocker.reset()` to cancel and stay on the page.
 *
 * Requires the app to use the Data Router API (`createBrowserRouter` +
 * `<RouterProvider>`); v7's `useBlocker` is a no-op under the legacy
 * `<BrowserRouter>` element.
 */
export function useUnsavedChangesGuard(isDirty: boolean): Blocker {
  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Chrome / Edge still require setting returnValue to a non-empty value.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  return useBlocker(
    ({ currentLocation, nextLocation }) => isDirty && currentLocation.pathname !== nextLocation.pathname,
  );
}
