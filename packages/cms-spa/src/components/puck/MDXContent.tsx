import { APIClientError, ErrorCodes, type LocalizedEntry, useCompileMDX } from '@conloca/content-api-client';
import React, { useMemo, useState } from 'react';
import { useSandboxPreviewStyles } from '../../sandbox-preview-styles.js';
import { ContentSandbox } from '../sandbox/ContentSandbox.js';

const SYNTAX_HELPER = "This fragment's MDX could not be compiled. Edit the fragment to fix the syntax.";
const SERVICE_HELPER = 'Preview could not reach the compile service. Retry, or reload the editor.';
const RENDER_HELPER = 'The compiled fragment failed while rendering.';

/** Honest helper copy: only blame MDX syntax when compile failed with MDX_COMPILE_FAILED. */
export function fragmentRenderErrorHelper(error: Error | null | undefined, isCompileError: boolean): string {
  if (!isCompileError) return RENDER_HELPER;
  if (error instanceof APIClientError && error.code === ErrorCodes.MDX_COMPILE_FAILED) {
    return SYNTAX_HELPER;
  }
  // @conloca/mdx's compile throws a plain Error with "MDX compilation failed: …"
  if (error?.message?.includes('MDX compilation failed')) {
    return SYNTAX_HELPER;
  }
  return SERVICE_HELPER;
}

interface MDXContentProps {
  entry: LocalizedEntry;
  /**
   * Set false when the caller already supplies the content-root element the
   * fragment sits in — without it the fragment ends up in a box inside an
   * identical box, which the published page never does.
   */
  wrapped?: boolean;
}

/**
 * Error Boundary for catching React errors in MDXContent rendering.
 */
class MDXContentErrorBoundary extends React.Component<
  { children: React.ReactNode; contentId: string },
  { hasError: boolean; error?: Error }
> {
  constructor(props: { children: React.ReactNode; contentId: string }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[MDXContent] Error boundary caught:', error, errorInfo);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 bg-red-11 dark:bg-red-02 border border-red-08 dark:border-red-03 rounded-md text-red-04 dark:text-red-08">
          <p className="font-semibold mb-2">MDXContent Rendering Error</p>
          <p className="text-sm mb-2">{this.state.error?.message || 'Unknown error occurred'}</p>
          <p className="text-xs text-red-04 dark:text-red-08 mb-2">Fragment ID: {this.props.contentId}</p>
          <details className="text-xs">
            <summary className="cursor-pointer font-medium">Stack Trace</summary>
            <pre className="mt-2 p-2 bg-red-08 dark:bg-red-03 rounded-md text-red-01 dark:text-red-11 overflow-auto whitespace-pre-wrap">
              {this.state.error?.stack}
            </pre>
          </details>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Component for rendering MDX content fragments in the CMS editor.
 *
 * Receives a LocalizedEntry, compiles its MDX, and renders the result inside
 * the sandboxed content frame.
 * Displays appropriate loading, error, and empty states.
 *
 * @param props - Component props
 * @param props.entry - LocalizedEntry containing the content and ETag
 */
function MDXContentInner({ entry, wrapped = true }: MDXContentProps) {
  const sandboxStyles = useSandboxPreviewStyles();
  // Get MDX content from localized entry
  const actualMdxContent = useMemo(() => {
    if (!entry?.localized?.content) return null;

    const content = entry.localized.content as { mdx?: string };
    return content.mdx || null;
  }, [entry]);

  const cacheKey = entry.localized.etag;
  const {
    data: compiledResult,
    error: compileError,
    isLoading: isCompiling,
    refetch: retryCompile,
  } = useCompileMDX({
    mdxContent: actualMdxContent,
    cacheKey,
  });

  // The MDX eval + render now happens inside the sandbox iframe, never in
  // this privileged document. Render failures surface as a message out.
  const [evaluationError, setEvaluationError] = useState<Error | null>(null);
  const compiledCode = compiledResult?.code || null;

  // A fresh compile clears a stale render error from the previous content.
  // biome-ignore lint/correctness/useExhaustiveDependencies: A new compiled artifact invalidates the prior render error.
  React.useEffect(() => {
    setEvaluationError(null);
  }, [compiledCode]);

  const retry = () => {
    setEvaluationError(null);
    void retryCompile();
  };

  // Loading state
  if (isCompiling) {
    return (
      <div className="flex items-center justify-center p-8 text-grey-04 dark:text-grey-07">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-azure-04 mr-3" />
        Loading content...
      </div>
    );
  }

  // Evaluation / compile error
  if (compileError || evaluationError) {
    const error = compileError || evaluationError;
    const helper = fragmentRenderErrorHelper(error, Boolean(compileError));

    return (
      <div className="p-4 bg-red-11 dark:bg-red-02 border border-red-08 dark:border-red-03 rounded-md text-red-04 dark:text-red-08">
        <p className="font-semibold mb-2">Cannot Render Fragment Content</p>
        <p className="text-sm mb-2">{error?.message}</p>
        <p className="text-xs text-red-04 dark:text-red-08 mb-3">{helper}</p>
        <button
          type="button"
          onClick={retry}
          className="px-3 py-1 text-sm bg-red-04 text-white rounded-md hover:bg-red-03 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  // No content
  if (!actualMdxContent) {
    return (
      <div className="p-4 bg-yellow-11 dark:bg-yellow-02 border border-yellow-08 dark:border-yellow-03 rounded-md text-yellow-02 dark:text-yellow-09">
        <p className="font-semibold mb-1">Empty Fragment Content</p>
        <p className="text-sm">
          This fragment ({entry.id}) doesn't have any content yet. Click to edit and add some MDX content.
        </p>
      </div>
    );
  }

  if (!compiledCode) {
    return (
      <div className="flex items-center justify-center p-8 text-grey-04 dark:text-grey-07">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-azure-04 mr-3" />
        Loading MDX...
      </div>
    );
  }

  // Non-interactive: this preview lives inside the Puck canvas, which
  // owns block selection and drag — the sandbox is display-only.
  const preview = (
    <ContentSandbox
      mode="mdx"
      content={compiledCode}
      styles={sandboxStyles}
      interactive={false}
      onError={setEvaluationError}
    />
  );

  if (!wrapped) return preview;

  return <div className="mdx-content conloca-prose max-w-none">{preview}</div>;
}

/**
 * MDXContent component wrapped with error boundary.
 */
export function MDXContent(props: MDXContentProps) {
  return (
    <MDXContentErrorBoundary contentId={props.entry.id}>
      <MDXContentInner {...props} />
    </MDXContentErrorBoundary>
  );
}
