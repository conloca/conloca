import { useEffect, useState } from 'react';
import type { z } from 'zod';

/**
 * Type for a collection of data schemas.
 * Each key is a collection name, value is the Zod schema for that collection's data.
 */
export type DataSchemas = Record<string, z.ZodObject<z.ZodRawShape>>;

/**
 * Shared state for data schemas across module instances.
 * Uses window to ensure virtual modules and bundled code share the same state.
 */

interface SharedDataState {
  schemas: DataSchemas;
  subscribers: Set<(schemas: DataSchemas) => void>;
}

const getSharedState = (): SharedDataState => {
  if (typeof window !== 'undefined') {
    if (!(window as any).__DATA_SCHEMAS_STATE__) {
      (window as any).__DATA_SCHEMAS_STATE__ = {
        schemas: {},
        subscribers: new Set(),
      };
    }
    return (window as any).__DATA_SCHEMAS_STATE__;
  }
  // SSR fallback
  return { schemas: {}, subscribers: new Set() };
};

/**
 * Set the data schemas for all collections.
 * Called by the virtual module that loads user's schema definitions.
 * Notifies all subscribers of the change (enables HMR).
 */
export function setDataSchemas(schemas: DataSchemas): void {
  const state = getSharedState();
  state.schemas = schemas;
  state.subscribers.forEach((fn) => fn(schemas));
}

/**
 * Get the current data schemas synchronously.
 */
export function getDataSchemas(): DataSchemas {
  return getSharedState().schemas;
}

/**
 * React hook to subscribe to data schema changes.
 * Returns the current schemas and updates when they change (HMR support).
 */
export function useDataSchemas(): DataSchemas {
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
  }, []);

  return schemas;
}
