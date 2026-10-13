import { useEffect, useState } from 'react';
import type { PageSchemas } from './page-schema-define.js';

// The declaration surface (types, definePageSchema, the resolver) lives in
// page-schema-define — editor-free so content configs and bare test runners
// can evaluate it. Re-exported here so existing importers keep working.
export * from './page-schema-define.js';

/**
 * Shared state for page schemas across module instances.
 * Uses window to ensure virtual modules and bundled code share the same state.
 */
interface SharedPageSchemaState {
  schemas: PageSchemas;
  subscribers: Set<(schemas: PageSchemas) => void>;
}

declare global {
  interface Window {
    __PAGE_SCHEMAS_STATE__?: SharedPageSchemaState;
  }
}

const getSharedState = (): SharedPageSchemaState => {
  if (typeof window !== 'undefined') {
    if (!window.__PAGE_SCHEMAS_STATE__) {
      window.__PAGE_SCHEMAS_STATE__ = {
        schemas: {},
        subscribers: new Set(),
      };
    }
    return window.__PAGE_SCHEMAS_STATE__;
  }
  // SSR fallback
  return { schemas: {}, subscribers: new Set() };
};

/**
 * Set the page schemas for all match keys.
 * Called by the virtual module that loads user's schema definitions.
 * Notifies all subscribers of the change (enables HMR).
 */
export function setPageSchemas(schemas: PageSchemas): void {
  const state = getSharedState();
  state.schemas = schemas;
  state.subscribers.forEach((fn) => {
    fn(schemas);
  });
}

/**
 * Get the current page schemas synchronously.
 */
export function getPageSchemas(): PageSchemas {
  return getSharedState().schemas;
}

/**
 * React hook to subscribe to page schema changes.
 * Returns the current schemas and updates when they change (HMR support).
 */
export function usePageSchemas(): PageSchemas {
  const [schemas, setSchemas] = useState(() => getSharedState().schemas);

  useEffect(() => {
    const state = getSharedState();

    // Update immediately in case schemas changed between render and effect
    if (state.schemas !== schemas) {
      setSchemas(state.schemas);
    }

    state.subscribers.add(setSchemas);
    return () => {
      state.subscribers.delete(setSchemas);
    };
  }, [schemas]);

  return schemas;
}
