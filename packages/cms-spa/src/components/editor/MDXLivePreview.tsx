import { useCompileMDX } from '@conloca/content-api-client';
import { useMDXEvaluation } from '@conloca/mdx';
import React, { useEffect, useState } from 'react';

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
 * Reuses the same compile + evaluate chain that powers `MDXContent.tsx`
 * (which renders saved blocks inside the Puck preview). Three differences:
 *
 * 1. Source is the editor's live `markdown` value rather than a saved
 *    `LocalizedEntry`, so we debounce updates to keep the compile
 *    pipeline calm while the user is typing.
 * 2. The cache key follows the markdown content rather than the entry's
 *    etag — every distinct snapshot gets its own cache slot, so toggling
 *    the preview off/on doesn't re-compile identical source.
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
 * Detect ESM `import` / `export` statements at the top level. The server-side
 * `compileMDX` runs with `outputFormat: 'function-body'`, which can't resolve
 * those without a `baseUrl`. Rather than letting MDX bubble up a cryptic
 * "missing options.baseUrl" error, we short-circuit with a friendly message
 * — the editor itself still works fine.
 *
 * Page-level content (which may `import` JSX components scoped by the host
 * site's MDX provider) no longer reaches this component — the page editor
 * renders without a preview pane. The guard remains for blocks, where a
 * user might paste in a stray import while drafting; the message below is
 * block-appropriate.
 */
function hasTopLevelImportsOrExports(source: string): boolean {
  return /^[ \t]*(?:import|export)\s/m.test(source);
}

function MDXLivePreviewInner({ markdown, debounceMs }: { markdown: string; debounceMs: number }) {
  const debouncedMarkdown = useDebouncedValue(markdown, debounceMs);
  const mdxContent = debouncedMarkdown.length > 0 ? debouncedMarkdown : null;
  const hasImports = mdxContent ? hasTopLevelImportsOrExports(mdxContent) : false;
  // Hash-free cache key. The compile hook treats this purely as an identity
  // marker, so a substring suffix is enough to avoid collisions in practice
  // while keeping the key cheap to compute.
  const cacheKey = `live:${debouncedMarkdown.length}:${debouncedMarkdown.slice(0, 64)}`;

  // Skip the server compile call when we know it'll fail (top-level imports
  // need a baseUrl that `function-body` output doesn't get) — keeps the
  // network panel clean and shows the friendly message immediately below.
  const {
    data: compiledResult,
    error: compileError,
    isLoading: isCompiling,
  } = useCompileMDX({ mdxContent: hasImports ? null : mdxContent, cacheKey });

  const {
    Component,
    error: evaluationError,
    isLoading: isEvaluating,
  } = useMDXEvaluation({
    compiledCode: compiledResult?.code ?? null,
    cacheKey,
  });

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
          The preview can&apos;t compile <code>import</code> / <code>export</code> statements. Remove them, or use MDX
          directives (like <code>:::note</code>) for callouts so this block stays previewable.
        </p>
      </div>
    );
  }

  if (compileError || evaluationError) {
    const error = compileError ?? evaluationError;
    return (
      <div className="m-4 p-3 rounded-md border border-red-08 bg-red-11 dark:bg-red-02 dark:border-red-03 text-sm text-red-04 dark:text-red-08">
        <p className="font-semibold mb-1">MDX error</p>
        <p className="text-xs whitespace-pre-wrap">{error?.message}</p>
      </div>
    );
  }

  if (isCompiling || isEvaluating || !Component) {
    return (
      <div className="p-6 text-sm text-grey-05 dark:text-grey-07 flex items-center gap-2">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-azure-04" />
        <span>Compiling preview…</span>
      </div>
    );
  }

  return (
    <div className="mdx-content conloca-prose max-w-none p-6">
      <Component />
    </div>
  );
}

export function MDXLivePreview({ markdown, debounceMs = 300 }: MDXLivePreviewProps) {
  return (
    <PreviewErrorBoundary>
      <MDXLivePreviewInner markdown={markdown} debounceMs={debounceMs} />
    </PreviewErrorBoundary>
  );
}
