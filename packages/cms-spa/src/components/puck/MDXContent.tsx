import type { LocalizedEntry } from '@conloca/content-api-client';
import React from 'react';
import { preventLinkNavigation } from '../editor/InlinePreviewFrame.js';
import { useFragmentRender } from './use-fragment-render.js';

/** The helper line under a fragment that cannot render: what to do about it. */
export function fragmentRenderErrorHelper(error: Error): string {
  if (error.message.startsWith('Unknown component <')) {
    return `${error.message} Declare it in the site's fragmentComponentsPath module.`;
  }
  return `This fragment cannot be rendered: ${error.message}`;
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
 * Error Boundary for a site component that throws while the fragment renders.
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
 * Renders a fragment's MDX inline in the CMS editor with the site's renderer
 * and components (or the editor's fallback). Nothing shows while it renders.
 *
 * @param props.entry - LocalizedEntry containing the content
 */
function MDXContentInner({ entry, wrapped = true }: MDXContentProps) {
  const mdx = entry?.localized?.content?.mdx || '';
  const rendered = useFragmentRender(mdx);

  if (!mdx) {
    return (
      <div className="p-4 bg-yellow-11 dark:bg-yellow-02 border border-yellow-08 dark:border-yellow-03 rounded-md text-yellow-02 dark:text-yellow-09">
        <p className="font-semibold mb-1">Empty Fragment Content</p>
        <p className="text-sm">
          This fragment ({entry.id}) doesn't have any content yet. Click to edit and add some MDX content.
        </p>
      </div>
    );
  }

  if (rendered.status === 'pending') return null;

  if (rendered.error || !rendered.Component) {
    const error = rendered.error ?? new Error('the renderer returned no component');
    return (
      <div className="p-4 bg-red-11 dark:bg-red-02 border border-red-08 dark:border-red-03 rounded-md text-red-04 dark:text-red-08">
        <p className="font-semibold mb-2">Cannot Render Fragment Content</p>
        <p className="text-sm">{fragmentRenderErrorHelper(error)}</p>
      </div>
    );
  }

  const { Component } = rendered;
  if (!wrapped) return <Component />;

  return (
    <div
      className="mdx-content conloca-prose"
      data-conloca-content-root=""
      onClickCapture={preventLinkNavigation}
      onAuxClickCapture={preventLinkNavigation}
      onSubmitCapture={preventLinkNavigation}
    >
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
