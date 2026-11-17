import React, { useEffect, useState } from 'react';
import { useSiteRender } from '../../site-render.js';
import { getUIConfig } from '../../ui-config.js';
import { useFragmentRender } from '../puck/use-fragment-render.js';
import { FramedContent } from './EditorFrame.js';
import { InlinePreviewFrame } from './InlinePreviewFrame.js';

/** The site path a fragment previews at: the bindings' route, else the build's define, else `/`. */
export function fragmentPreviewPathname(): string {
  return getUIConfig().dataBindings?.fragmentPreviewRoute ?? import.meta.env.CONLOCA_FRAGMENT_PREVIEW_ROUTE ?? '/';
}

interface MDXLivePreviewProps {
  /** The raw MDX source the editor is currently holding. */
  markdown: string;
  /**
   * Debounce window in ms before re-compiling the editor content into a
   * preview component. ~300ms is the sweet spot — fast enough that the
   * preview feels live, slow enough that compile traffic doesn't pile up
   * mid-keystroke.
   */
  debounceMs?: number;
}

/**
 * Render an MDX string side-by-side with the editor.
 *
 * Renders with the same site renderer and vocabulary as `MDXContent.tsx`
 * (which renders saved fragments inside the Puck canvas). Differences:
 *
 * 1. Source is the editor's live `markdown` value rather than a saved
 *    `LocalizedEntry`, so we debounce updates while the user is typing.
 * 2. It renders inside `InlinePreviewFrame`, which carries the site styles
 *    and the prose floor without leaking them into the editor's own UI.
 * 3. Parse/eval errors render inline as a small banner (instead of the
 *    full-block error card MDXContent.tsx uses) so the preview pane stays
 *    readable while the author fixes their syntax.
 */
class PreviewErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error?: Error }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[MDXLivePreview] render error:', error, errorInfo);
  }

  override componentDidUpdate(prevProps: { children: React.ReactNode }) {
    // Reset the boundary whenever the source changes — the next render is
    // a fresh compile result, so a previously-thrown error shouldn't stick.
    if (prevProps.children !== this.props.children && this.state.hasError) {
      this.setState({ hasError: false, error: undefined });
    }
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="m-4 p-3 rounded-md border border-red-08 bg-red-11 dark:bg-red-02 dark:border-red-03 text-sm text-red-04 dark:text-red-08">
          <p className="font-semibold mb-1">Preview failed to render</p>
          <p className="text-xs">{this.state.error?.message ?? 'Unknown error'}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Detect ESM `import` / `export` statements at the top level. The renderer
 * rejects them outright: `remarkRestrictExpressions` throws on `mdxjsEsm`
 * nodes. Rather than surfacing that as a render error, we short-circuit with
 * a friendly message — the editor itself still works fine.
 *
 * Page-level content (which may `import` JSX components scoped by the host
 * site's MDX provider) no longer reaches this component — the page editor
 * renders without a preview pane. The guard remains for fragments, where a
 * user might paste in a stray import while drafting; the message below is
 * fragment-appropriate.
 */
function hasTopLevelImportsOrExports(source: string): boolean {
  return /^[ \t]*(?:import|export)\s/m.test(source);
}

function MDXLivePreviewInner({ markdown, debounceMs }: { markdown: string; debounceMs: number }) {
  const debouncedMarkdown = useDebouncedValue(markdown, debounceMs);
  const mdxContent = debouncedMarkdown.length > 0 ? debouncedMarkdown : null;
  const hasImports = mdxContent ? hasTopLevelImportsOrExports(mdxContent) : false;
  // Imports are rejected anyway; the friendly message below says why.
  const rendered = useFragmentRender(hasImports || !mdxContent ? '' : mdxContent);
  const { frames } = useSiteRender();

  if (!mdxContent) {
    return (
      <div className="p-6 text-sm text-grey-05 dark:text-grey-07">
        <p>Start writing to see a live preview.</p>
      </div>
    );
  }

  if (hasImports) {
    return (
      <div className="m-4 p-3 rounded-md border border-yellow-08 bg-yellow-11 dark:bg-yellow-02 dark:border-yellow-03 text-sm text-yellow-02 dark:text-yellow-09">
        <p className="font-semibold mb-1">Preview unavailable</p>
        <p className="text-xs">
          The preview can&apos;t compile <code>import</code> / <code>export</code> statements. Remove them so this
          fragment stays previewable.
        </p>
      </div>
    );
  }

  if (rendered.status === 'done' && (rendered.error || !rendered.Component)) {
    return (
      <div className="m-4 p-3 rounded-md border border-red-08 bg-red-11 dark:bg-red-02 dark:border-red-03 text-sm text-red-04 dark:text-red-08">
        <p className="font-semibold mb-1">MDX error</p>
        <p className="text-xs whitespace-pre-wrap">{rendered.error?.message}</p>
      </div>
    );
  }

  if (rendered.status === 'pending' || !rendered.Component) {
    return (
      <div className="p-6 text-sm text-grey-05 dark:text-grey-07 flex items-center gap-2">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-azure-04" />
        <span>Rendering preview…</span>
      </div>
    );
  }

  const { Component } = rendered;
  const content = (
    // The prose floor is scoped to this id; editor utility classes do not reach into the frame.
    <div id="__sandbox_root" className="mdx-content conloca-prose" style={{ padding: '1.5rem' }}>
      <Component />
    </div>
  );
  // A fragment has no route of its own: it previews inside the first entry that declares a frame.
  const route = getUIConfig().dataBindings?.entries?.find((e) => e.frame !== undefined)?.frame;
  const Frame = route === undefined ? undefined : frames[route];
  return (
    <InlinePreviewFrame title="Fragment preview">
      {route === undefined || Frame === undefined ? (
        content
      ) : (
        <FramedContent route={route} Frame={Frame} pathname={fragmentPreviewPathname()}>
          {content}
        </FramedContent>
      )}
    </InlinePreviewFrame>
  );
}

export function MDXLivePreview({ markdown, debounceMs = 300 }: MDXLivePreviewProps) {
  return (
    <PreviewErrorBoundary>
      <MDXLivePreviewInner markdown={markdown} debounceMs={debounceMs} />
    </PreviewErrorBoundary>
  );
}
