import type { Config } from '@measured/puck';
import { useEffect, useState } from 'react';

/**
 * Shared state for Puck config across module instances.
 * Uses window to ensure virtual modules and bundled code share the same state.
 */

type PuckConfig = Config;

interface SharedPuckState {
  config: PuckConfig;
  subscribers: Set<(config: PuckConfig) => void>;
}

const getSharedState = (): SharedPuckState => {
  if (typeof window !== 'undefined') {
    if (!(window as any).__PUCK_STATE__) {
      (window as any).__PUCK_STATE__ = {
        config: { components: {} },
        subscribers: new Set(),
      };
    }
    return (window as any).__PUCK_STATE__;
  }
  // SSR fallback
  return { config: { components: {} }, subscribers: new Set() };
};

/**
 * Set the Puck config. Called by the virtual module that loads user's config.
 * Notifies all subscribers of the change (enables HMR).
 */
export function setPuckConfig(config: PuckConfig): void {
  const state = getSharedState();
  state.config = config;
  state.subscribers.forEach((fn) => fn(config));
}

/**
 * Get the current Puck config synchronously.
 */
export function getPuckConfig(): PuckConfig {
  return getSharedState().config;
}

/**
 * React hook to subscribe to Puck config changes.
 * Returns the current config and updates when it changes (HMR support).
 */
export function usePuckConfig(): PuckConfig {
  const [config, setConfig] = useState(() => getSharedState().config);

  useEffect(() => {
    const state = getSharedState();

    // Update immediately in case config changed between render and effect
    if (state.config !== config) {
      setConfig(state.config);
    }

    state.subscribers.add(setConfig);
    return () => {
      state.subscribers.delete(setConfig);
    };
  }, []);

  return config;
}
