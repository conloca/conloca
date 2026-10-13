import type { Config } from '@puckeditor/core';
import { useMemo } from 'react';
import { createBrowserRouter, createRoutesFromElements, Route, RouterProvider, Routes } from 'react-router-dom';
import { CMSDashboard } from './components/CMSDashboard.js';
import { CMSLayout } from './components/CMSLayout.js';
import { FragmentEditor } from './components/editor/FragmentEditor.js';
import { PageEditorWrapper } from './components/editor/PageEditorWrapper.js';
import { DataList } from './components/pages/DataList.js';
import { FragmentList } from './components/pages/FragmentList.js';
import { MediaPage } from './components/pages/MediaPage.js';
import { PageList } from './components/pages/PageList.js';
import { type DataSchemas, useDataSchemas } from './data-schemas.js';
import { usePuckConfig } from './puck-config.js';

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
 * takes over the screen".
 *
 * Exported so tests that need `useBlocker` (the unsaved-changes guard hooks
 * inside the page/fragment editors) can plug the same routes into
 * `createMemoryRouter` + `<RouterProvider>` instead of the legacy
 * `<MemoryRouter>` element.
 */
export function routeElements({ puckConfig, dataSchemas }: RouteDeps) {
  return (
    <>
      <Route path="/" element={<CMSLayout />}>
        <Route index element={<CMSDashboard />} />
        <Route path="pages" element={<PageList />} />
        <Route path="fragments" element={<FragmentList />} />
        <Route path="data" element={<DataList dataSchemas={dataSchemas} />} />
        <Route path="media" element={<MediaPage />} />
      </Route>
      <Route path="/pages/:id" element={<PageEditorWrapper puckConfig={puckConfig} />} />
      <Route path="/fragments/:id" element={<FragmentEditor />} />
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
 */
export default function App({ basename }: { basename?: string } = {}) {
  const puckConfig = usePuckConfig();
  const dataSchemas = useDataSchemas();

  const router = useMemo(
    () =>
      createBrowserRouter(createRoutesFromElements(routeElements({ puckConfig, dataSchemas })), {
        basename,
      }),
    [puckConfig, dataSchemas, basename],
  );

  return <RouterProvider router={router} />;
}
