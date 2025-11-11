'use client';

import { useMDXEvaluation } from '@conloca/mdx-client';

interface MDXBlockProps {
  contentId: string;
  mdxContent?: string; // Pre-fetched MDX content (for SSR)
  etag: string; // ETag for cache key (format: "metaEtag.contentEtag")
}

/**
 * Component for rendering MDX content blocks in the website preview/public pages.
 *
 * Accepts pre-fetched MDX content from the server and evaluates it client-side
 * using the useMDXEvaluation hook. Uses ETag for proper cache invalidation.
 *
 * @param props - Component props
 * @param props.contentId - ID of the content block (used for error messages)
 * @param props.mdxContent - Pre-fetched MDX content string from server
 * @param props.etag - ETag from content API for cache key
 */
export function MDXBlock({ contentId, mdxContent, etag }: MDXBlockProps) {
  // Evaluate MDX using shared hook with ETag as cache key
  const {
    Component,
    error: compileError,
    isLoading,
    retry,
  } = useMDXEvaluation({
    mdxContent: mdxContent || null,
    cacheKey: etag,
  });

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8 text-gray-500">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500 mr-3" />
        Loading content...
      </div>
    );
  }

  // Error state
  if (compileError) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded text-red-600">
        <p className="font-semibold mb-2">MDX Error</p>
        <p className="text-sm mb-3">{compileError.message}</p>
        <button
          onClick={retry}
          className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  // No content provided
  if (!mdxContent) {
    return (
      <div className="p-4 bg-gray-100 border border-gray-300 rounded text-gray-600">
        <p>No content found for block: {contentId}</p>
      </div>
    );
  }

  // Render component
  if (!Component) {
    return (
      <div className="flex items-center justify-center p-8 text-gray-500">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500 mr-3" />
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
