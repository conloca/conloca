import { useEffect, useState } from 'react';
import type { HostWrappers } from './site-styles.js';

/**
 * Registered style-discovery results, written by a host app that embeds the
 * editor and read by the MDX editor.
 *
 * The astro-cms dev server discovers the same facts at runtime
 * (`/api/styles`, `/api/content-wrapper`, the computed-style probe); those
 * mechanisms need a Vite graph and a same-origin page, which an editor served
 * from another origin does not have. A host app that learns the same facts
 * some other way writes them into this registry — the editor's consumption
 * chain then treats them as the same tier, one layer below live discovery.
 *
 * astro-cms never writes this, so the chain simply skips it there.
 */

export interface HostDiscovery {
  /** The discovery route's collected CSS. */
  routeCss?: string;
  /** The discovery route's content-wrapper shape, same contract as the endpoint's. */
  wrappers?: HostWrappers;
}

interface DiscoveryState {
  value: HostDiscovery;
  subscribers: Set<(value: HostDiscovery) => void>;
}

declare global {
  interface Window {
    __HOST_DISCOVERY_STATE__?: DiscoveryState;
  }
}

const getState = (): DiscoveryState => {
  if (typeof window !== 'undefined') {
    if (!window.__HOST_DISCOVERY_STATE__) {
      window.__HOST_DISCOVERY_STATE__ = { value: {}, subscribers: new Set() };
    }
    return window.__HOST_DISCOVERY_STATE__;
  }
  return { value: {}, subscribers: new Set() };
};

/**
 * Replace the registered discovery wholesale. Wholesale on purpose: the
 * registry is process-global, so a switch to another site that carried only
 * SOME fields forward would leak the previous site's wrapper or CSS into the new
 * one — the same clear-semantics `setSiteStyles([])` has.
 */
export function setHostDiscovery(value: HostDiscovery): void {
  const state = getState();
  state.value = value;
  state.subscribers.forEach((fn) => {
    fn(value);
  });
}

export function getHostDiscovery(): HostDiscovery {
  return getState().value;
}

export function useHostDiscovery(): HostDiscovery {
  const [value, setValue] = useState(() => getState().value);

  useEffect(() => {
    const state = getState();
    setValue((current) => (state.value === current ? current : state.value));
    state.subscribers.add(setValue);
    return () => {
      state.subscribers.delete(setValue);
    };
  }, []);

  return value;
}
