import type { LocalizedEntry } from '@conloca/content-api-client';
import { useMDXEvaluation } from '@conloca/mdx';
import React, { useMemo } from 'react';
import { getUIConfig } from '../../ui-config';

interface MDXContentProps {
  entry: LocalizedEntry;
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
        <div className="p-4 bg-red-50 border border-red-200 rounded text-red-600">
          <p className="font-semibold mb-2">MDXContent Rendering Error</p>
          <p className="text-sm mb-2">{this.state.error?.message || 'Unknown error occurred'}</p>
          <p className="text-xs text-red-500 mb-2">Block ID: {this.props.contentId}</p>
          <details className="text-xs">
            <summary className="cursor-pointer font-medium">Stack Trace</summary>
            <pre className="mt-2 p-2 bg-red-100 rounded overflow-auto whitespace-pre-wrap">
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
 * Component for rendering MDX content blocks in the CMS editor.
 *
 * Receives a LocalizedEntry and renders its MDX content using the useMDXEvaluation hook.
 * Displays appropriate loading, error, and empty states.
 *
 * @param props - Component props
 * @param props.entry - LocalizedEntry containing the content and ETag
 */
function MDXContentInner({ entry }: MDXContentProps) {
  // Get MDX content from localized entry
  const actualMdxContent = useMemo(() => {
    if (!entry?.localized?.content) return null;

    const content = entry.localized.content as { mdx?: string };
    return content.mdx || null;
  }, [entry]);

  // Evaluate MDX using shared hook with ETag as cache key
  const config = getUIConfig();
  const {
    Component,
    error: compileError,
    isLoading: isCompiling,
    retry,
  } = useMDXEvaluation({
    mdxContent: actualMdxContent,
    cacheKey: entry.localized.etag,
    apiBaseUrl: config.apiBaseUrl || '/__cms/api',
  });

  // Loading state
  if (isCompiling) {
    return (
      <div className="flex items-center justify-center p-8 text-grey-04">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-azure-04 mr-3" />
        Loading content...
      </div>
    );
  }

  // Evaluation error
  if (compileError) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded text-red-600">
        <p className="font-semibold mb-2">Cannot Render Block Content</p>
        <p className="text-sm mb-2">{compileError.message}</p>
        <p className="text-xs text-red-500 mb-3">
          The block content contains invalid MDX syntax. Please edit the block to fix any syntax errors.
        </p>
        <button
          onClick={retry}
          className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  // No content
  if (!actualMdxContent) {
    return (
      <div className="p-4 bg-yellow-50 border border-yellow-200 rounded text-yellow-700">
        <p className="font-semibold mb-1">Empty Block Content</p>
        <p className="text-sm">
          This block ({entry.id}) doesn't have any content yet. Click to edit and add some MDX content.
        </p>
      </div>
    );
  }

  // Render evaluated component
  if (!Component) {
    return (
      <div className="flex items-center justify-center p-8 text-grey-04">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-azure-04 mr-3" />
        Loading MDX...
      </div>
    );
  }

  return (
    <div className="mdx-content prose prose-sm max-w-none">
      <Component />
    </div>
  );
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
