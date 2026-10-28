import type { Config } from '@puckeditor/core';
import { useEffect, useMemo } from 'react';
import {
  createBrowserRouter,
  createMemoryRouter,
  createRoutesFromElements,
  Route,
  RouterProvider,
  Routes,
} from 'react-router-dom';
import { CMSDashboard } from './components/CMSDashboard.js';
import { CMSLayout } from './components/CMSLayout.js';
import { FragmentEditor } from './components/editor/FragmentEditor.js';
import { PageEditorWrapper } from './components/editor/PageEditorWrapper.js';
import { DataList } from './components/pages/DataList.js';
import { FragmentList } from './components/pages/FragmentList.js';
import { MediaPage } from './components/pages/MediaPage.js';
import { PageList } from './components/pages/PageList.js';
import { RouteErrorPage } from './components/RouteErrorPage.js';
import { type DataSchemas, useDataSchemas } from './data-schemas.js';
import { syncMemoryRouter } from './frame/memory-router.js';
import { usePuckConfig } from './puck-config.js';
import type { MemoryRouterConfig } from './ui-config.js';

export interface RouteDeps {
  puckConfig: Config;
  dataSchemas: DataSchemas;
}

/**
 * Single source of truth for the SPA's route shape. Used by both the
 * production Data Router (default export) and tests rendering through
 * `<AppRoutes>` inside a legacy `<MemoryRouter>`.
 *
 * `/pages/:id` and `/fragments/:id` sit OUTSIDE the CMSLayout shell so the
 * editors occupy the full viewport — the page-route equivalent of "modal
 * takes over the screen". Each of the three top-level routes carries the
 * `RouteErrorPage` `errorElement`, so a failing screen never falls through to
 * react-router's developer screen. An address that matches no route is answered
 * by the FIRST route's `errorElement` (react-router's choice), so the layout
 * route must stay first and keep its `errorElement`.
 *
 * Exported so tests that need `useBlocker` (the unsaved-changes guard hooks
 * inside the page/fragment editors) can plug the same routes into
 * `createMemoryRouter` + `<RouterProvider>` instead of the legacy
 * `<MemoryRouter>` element.
 */
export function routeElements({ puckConfig, dataSchemas }: RouteDeps) {
  return (
    <>
      <Route path="/" element={<CMSLayout />} errorElement={<RouteErrorPage />}>
        <Route index element={<CMSDashboard />} />
        <Route path="pages" element={<PageList />} />
        <Route path="fragments" element={<FragmentList />} />
        <Route path="data" element={<DataList dataSchemas={dataSchemas} />} />
        <Route path="media" element={<MediaPage />} />
      </Route>
      <Route
        path="/pages/:id"
        element={<PageEditorWrapper puckConfig={puckConfig} />}
        errorElement={<RouteErrorPage />}
      />
      <Route path="/fragments/:id" element={<FragmentEditor />} errorElement={<RouteErrorPage />} />
    </>
  );
}

/**
 * Element-form router tree. Compatible with the legacy `<MemoryRouter>` test
 * harness. Hooks like `useBlocker` won't work under this; tests that need
 * `useBlocker` must build their own `createMemoryRouter` + `<RouterProvider>`.
 */
export function AppRoutes() {
  const puckConfig = usePuckConfig();
  const dataSchemas = useDataSchemas();
  return <Routes>{routeElements({ puckConfig, dataSchemas })}</Routes>;
}

/**
 * Production app entry. Uses the Data Router API so v7's `useBlocker` works
 * for the unsaved-changes navigation guard in MdxPageEditor / FragmentEditor.
 * With `memoryRouter` the route lives in memory and is mirrored to the parent
 * frame instead of the address bar.
 */
export default function App({ basename, memoryRouter }: { basename?: string; memoryRouter?: MemoryRouterConfig } = {}) {
  const puckConfig = usePuckConfig();
  const dataSchemas = useDataSchemas();

  const router = useMemo(() => {
    const routes = createRoutesFromElements(routeElements({ puckConfig, dataSchemas }));
    return memoryRouter
      ? createMemoryRouter(routes, { initialEntries: [memoryRouter.initialPath] })
      : createBrowserRouter(routes, { basename });
  }, [puckConfig, dataSchemas, basename, memoryRouter]);

  useEffect(() => (memoryRouter ? syncMemoryRouter(router, memoryRouter) : undefined), [router, memoryRouter]);

  return <RouterProvider router={router} />;
}
