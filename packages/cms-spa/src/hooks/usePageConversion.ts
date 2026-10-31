import { type ContentManifest, isEditorRoute, routesOf } from '@conloca/content-api-client';
import { useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { type PageConversionFacts, pageCollection, unconvertedRoutes } from '../convert-pages.js';
import { EDITOR_CONFIG_CHANGED_EVENT, getUIConfig } from '../ui-config.js';
import { editorWriteAccess } from '../write-access.js';

export interface PageConversionOffer {
  facts: PageConversionFacts;
  collection: string;
  /** Routes to offer; `undefined` while unknown, so the prompt asks the agent to list them. */
  candidates: string[] | undefined;
}

let configVersion = 0;

function subscribeToConfig(onChange: () => void): () => void {
  const changed = () => {
    configVersion++;
    onChange();
  };
  window.addEventListener(EDITOR_CONFIG_CHANGED_EVENT, changed);
  return () => window.removeEventListener(EDITOR_CONFIG_CHANGED_EVENT, changed);
}

/** What this editor offers for converting Astro pages; null when it offers nothing. Re-renders on EDITOR_CONFIG_CHANGED_EVENT. */
export function usePageConversion(pages: readonly ContentManifest[]): PageConversionOffer | null {
  useSyncExternalStore(
    subscribeToConfig,
    () => configVersion,
    () => configVersion,
  );
  const config = getUIConfig();
  const facts = config.pageConversion;
  const writable = editorWriteAccess(config).writable;
  const local = config.hosted !== true;
  // The local dev server lists the site's static routes; the workspace editor sends them with the facts.
  const staticRoutes = useQuery({
    queryKey: ['conloca', 'static-routes'],
    queryFn: async () => {
      const response = await fetch(`${config.apiBaseUrl ?? '/__cms/api'}/static-routes`);
      if (!response.ok) throw new Error(`Listing the site's routes failed with ${response.status}`);
      const body: unknown = await response.json();
      if (typeof body !== 'object' || body === null) throw new Error("The site's route list is not an object");
      return routesOf({ routes: Reflect.get(body, 'routes') }) ?? null;
    },
    enabled: writable && facts !== undefined && local,
  });
  if (!writable || facts === undefined) return null;
  if (local && staticRoutes.isPending) return null;
  const routes = local ? (staticRoutes.data ?? undefined) : facts.routes?.filter(isEditorRoute);
  const candidates = routes === undefined ? undefined : unconvertedRoutes(routes, pages);
  if (candidates?.length === 0) return null;
  return { facts, collection: pageCollection(config.dataBindings), candidates };
}
