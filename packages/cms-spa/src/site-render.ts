import type { MDXHeading as FragmentHeading } from '@conloca/content-api';
import {
  EMPTY_FRAGMENT_VOCABULARY,
  evaluateMDXToComponent,
  type FragmentVocabulary,
  isFragmentVocabulary,
} from '@conloca/mdx/render';
import { type ComponentType, type ReactNode, useEffect, useState } from 'react';

/**
 * The site's own fragment renderer, vocabulary and editor frames, so the
 * inline canvas renders a fragment with the site's components and its copy of
 * the renderer. The dev entry (`${cmsRoute}/site-render-entry.js`) sets it from
 * the site's modules; until then the editor's own renderer and an empty
 * vocabulary stand in.
 *
 * Uses window so virtual modules and bundled code share the same state.
 */

export type FragmentEvaluate = (
  mdx: string,
  vocabulary?: FragmentVocabulary,
) => Promise<{ Component: ComponentType | null; error?: Error; outline: readonly FragmentHeading[] }>;

export type EditorFrame = ComponentType<{ pathname: string; children: ReactNode }>;

export interface SiteRender {
  evaluate: FragmentEvaluate;
  vocabulary: FragmentVocabulary;
  frames: Readonly<Record<string, EditorFrame>>;
  source: 'site' | 'editor';
}

interface SharedSiteRenderState {
  render: SiteRender;
  subscribers: Set<(render: SiteRender) => void>;
}

declare global {
  interface Window {
    __SITE_RENDER_STATE__?: SharedSiteRenderState;
  }
}

const FALLBACK: SiteRender = {
  evaluate: evaluateMDXToComponent,
  vocabulary: EMPTY_FRAGMENT_VOCABULARY,
  frames: {},
  source: 'editor',
};

const getSharedState = (): SharedSiteRenderState => {
  if (typeof window !== 'undefined') {
    // oxlint-disable-next-line no-underscore-dangle -- the browser global declared above.
    window.__SITE_RENDER_STATE__ ??= { render: FALLBACK, subscribers: new Set() };
    // oxlint-disable-next-line no-underscore-dangle -- the browser global declared above.
    return window.__SITE_RENDER_STATE__;
  }
  // SSR fallback
  return { render: FALLBACK, subscribers: new Set() };
};

const isPlainObject = (value: unknown): value is object =>
  typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;

// Shape checks only: site code supplies these, and a wrong signature surfaces as a render error.
const isFragmentEvaluate = (value: unknown): value is FragmentEvaluate => typeof value === 'function';
const isEditorFrame = (value: unknown): value is EditorFrame =>
  typeof value === 'function' || (typeof value === 'object' && value !== null && '$$typeof' in value);

/**
 * Register the site's render inputs. Each field is checked by shape, since it
 * comes from site code: a malformed one is replaced by the fallback and named
 * in one warning.
 */
export function setSiteRender(input: { evaluate?: unknown; vocabulary?: unknown; frames?: unknown }): void {
  const siteEvaluate = isFragmentEvaluate(input.evaluate) ? input.evaluate : undefined;
  if (input.evaluate !== undefined && siteEvaluate === undefined) {
    console.warn('[conloca] evaluate is not a function; using the editor renderer');
  }
  const vocabulary = isFragmentVocabulary(input.vocabulary) ? input.vocabulary : EMPTY_FRAGMENT_VOCABULARY;
  if (input.vocabulary !== undefined && vocabulary !== input.vocabulary) {
    console.warn('[conloca] fragmentComponents is not defineFragmentComponents(...) output; using no components');
  }
  const frames: Record<string, EditorFrame> = {};
  if (isPlainObject(input.frames)) {
    for (const [name, frame] of Object.entries(input.frames)) {
      if (isEditorFrame(frame)) frames[name] = frame;
    }
  } else if (input.frames !== undefined) {
    console.warn('[conloca] editorFrames is not an object; using no frames');
  }
  const render: SiteRender = {
    evaluate: siteEvaluate ?? evaluateMDXToComponent,
    vocabulary,
    frames,
    source: siteEvaluate ? 'site' : 'editor',
  };
  const state = getSharedState();
  state.render = render;
  state.subscribers.forEach((fn) => {
    fn(render);
  });
}

/** The current site render, or the editor's fallback until one is set. */
export function getSiteRender(): SiteRender {
  return getSharedState().render;
}

/** React hook for the current site render; re-renders the caller when it changes (HMR support). */
export function useSiteRender(): SiteRender {
  const [render, setRender] = useState(() => getSharedState().render);

  useEffect(() => {
    const state = getSharedState();
    // Re-sync in case it changed between render and effect
    if (state.render !== render) {
      setRender(state.render);
    }
    state.subscribers.add(setRender);
    return () => {
      state.subscribers.delete(setRender);
    };
  }, [render]);

  return render;
}
