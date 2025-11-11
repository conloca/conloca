import { evaluate } from '@mdx-js/mdx';
import type React from 'react';
import { useEffect, useState } from 'react';
import * as devRuntime from 'react/jsx-dev-runtime';
import * as runtime from 'react/jsx-runtime';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMdxFrontmatter from 'remark-mdx-frontmatter';

// Cache for compiled MDX components
const compiledCache = new Map<string, React.ComponentType>();

/**
 * Standalone function that creates MDX evaluation options.
 * Checks for development mode only once at startup to avoid repeated
 * environment checks during runtime.
 *
 * @returns Configuration object for MDX evaluation with appropriate JSX runtime
 */
function createMDXEvaluationOptions() {
  const isDevelopment = process.env.NODE_ENV === 'development';

  // Note: 'as any' is necessary due to @mdx-js/mdx type definitions not perfectly
  // matching the spread operator usage with JSX runtime objects
  return {
    ...(isDevelopment ? devRuntime : runtime),
    development: isDevelopment,
    remarkPlugins: [remarkFrontmatter, remarkMdxFrontmatter, remarkGfm],
  } as any;
}

// Call once at module load (startup)
const mdxEvaluationOptions = createMDXEvaluationOptions();

/**
 * Simple hash function for generating cache keys from MDX content.
 * Uses string hashing to avoid collisions when cacheKey isn't provided.
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(36);
}

interface UseMDXEvaluationOptions {
  mdxContent: string | null;
  cacheKey?: string;
}

interface UseMDXEvaluationResult {
  Component: React.ComponentType | null;
  error: Error | null;
  isLoading: boolean;
  retry: () => void;
}

/**
 * Hook for evaluating MDX content into React components.
 *
 * Features:
 * - Evaluates MDX strings into renderable React components using @mdx-js/mdx
 * - Caches compiled components to avoid re-evaluation of unchanged content
 * - Handles both development (jsx-dev-runtime) and production (jsx-runtime) environments
 * - Provides retry mechanism to clear cache and re-evaluate failed compilations
 * - Returns loading and error states for UI feedback
 *
 * @param options - Configuration options
 * @param options.mdxContent - The MDX string to evaluate. If null, returns null component
 * @param options.cacheKey - Optional cache key. If not provided, uses first 100 chars of content
 *
 * @returns Object containing:
 * - Component: The compiled React component (null if not yet compiled or error occurred)
 * - error: Error object if evaluation failed (null otherwise)
 * - isLoading: Boolean indicating if evaluation is in progress
 * - retry: Function to clear cache and retry evaluation
 *
 * @example
 * ```tsx
 * const { Component, error, isLoading, retry } = useMDXEvaluation({
 *   mdxContent: '# Hello\n\nThis is **MDX** content',
 *   cacheKey: 'my-unique-key'
 * });
 *
 * if (isLoading) return <Spinner />;
 * if (error) return <Error message={error.message} onRetry={retry} />;
 * if (Component) return <Component />;
 * ```
 */
export function useMDXEvaluation({ mdxContent, cacheKey }: UseMDXEvaluationOptions): UseMDXEvaluationResult {
  const [Component, setComponent] = useState<React.ComponentType | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(!!mdxContent);
  const [retryCount, setRetryCount] = useState(0);

  // Retry function that clears cache and retries evaluation
  const retry = () => {
    if (mdxContent) {
      const key = cacheKey || `mdx-${hashString(mdxContent)}`;
      compiledCache.delete(key);
    }
    setRetryCount((prev) => prev + 1);
  };

  useEffect(() => {
    if (!mdxContent) {
      setComponent(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    // Check cache first - use hash of full content to prevent collisions
    const key = cacheKey || `mdx-${hashString(mdxContent)}`;
    const cached = compiledCache.get(key);
    if (cached) {
      setComponent(() => cached);
      setError(null);
      setIsLoading(false);
      return;
    }

    // Evaluate MDX
    const evaluateMDX = async () => {
      try {
        setError(null);
        setIsLoading(true);

        // Evaluate MDX with proper JSX runtime
        const { default: MDXComponent } = await evaluate(mdxContent, mdxEvaluationOptions);

        // Cache the component
        compiledCache.set(key, MDXComponent);
        setComponent(() => MDXComponent);
      } catch (err) {
        const evaluationError = err instanceof Error ? err : new Error('MDX evaluation failed');
        setError(evaluationError);
        setComponent(null);
      } finally {
        setIsLoading(false);
      }
    };

    evaluateMDX();
  }, [mdxContent, cacheKey, retryCount]);

  return { Component, error, isLoading, retry };
}
