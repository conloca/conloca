import type { Config } from '@puckeditor/core';
import { useMemo } from 'react';
import { createBrowserRouter, createRoutesFromElements, Route, RouterProvider, Routes } from 'react-router-dom';
import { CMSDashboard } from './components/CMSDashboard';
import { CMSLayout } from './components/CMSLayout';
import { BlockEditor } from './components/editor/BlockEditor';
import { PageEditorWrapper } from './components/editor/PageEditorWrapper';
import { BlockList } from './components/pages/BlockList';
import { ConflictsList } from './components/pages/ConflictsList';
import { ConflictsResolverPage } from './components/pages/ConflictsResolverPage';
import { DataList } from './components/pages/DataList';
import { MediaPage } from './components/pages/MediaPage';
import { PageList } from './components/pages/PageList';
import { type DataSchemas, useDataSchemas } from './data-schemas';
import { usePuckConfig } from './puck-config';

export interface RouteDeps {
  puckConfig: Config;
  dataSchemas: DataSchemas;
}

/**
 * Single source of truth for the SPA's route shape. Used by both the
 * production Data Router (default export) and tests rendering through
 * `<AppRoutes>` inside a legacy `<MemoryRouter>`.
 *
 * `/pages/:id` and `/blocks/:id` sit OUTSIDE the CMSLayout shell so the
 * editors occupy the full viewport — the page-route equivalent of "modal
 * takes over the screen".
 *
 * Exported so tests that need `useBlocker` (the unsaved-changes guard hooks
 * inside the page/block editors) can plug the same routes into
 * `createMemoryRouter` + `<RouterProvider>` instead of the legacy
 * `<MemoryRouter>` element.
 */
export function routeElements({ puckConfig, dataSchemas }: RouteDeps) {
  return (
    <>
      <Route path="/" element={<CMSLayout />}>
        <Route index element={<CMSDashboard />} />
        <Route path="pages" element={<PageList />} />
        <Route path="blocks" element={<BlockList />} />
        <Route path="data" element={<DataList dataSchemas={dataSchemas} />} />
        <Route path="media" element={<MediaPage />} />
        <Route path="conflicts" element={<ConflictsList />} />
        <Route path="conflicts/:pageId/:locale" element={<ConflictsResolverPage />} />
      </Route>
      <Route path="/pages/:id" element={<PageEditorWrapper puckConfig={puckConfig} />} />
      <Route path="/blocks/:id" element={<BlockEditor />} />
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
 * for the unsaved-changes navigation guard in MdxPageEditor / BlockEditor.
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
