import type React from 'react';
import { useEffect, useState } from 'react';
import * as devRuntime from 'react/jsx-dev-runtime';
import * as runtime from 'react/jsx-runtime';

// Cache for compiled MDX components
const compiledCache = new Map<string, React.ComponentType>();

/**
 * Execute pre-compiled MDX code (compiled with outputFormat: 'function-body').
 * This is the same as @mdx-js/mdx's run() — inlined here to avoid importing
 * the full @mdx-js/mdx package (which pulls acorn + remark + unified into the browser).
 */
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
async function runMDX(code: string, options: Record<string, unknown>): Promise<{ default: React.ComponentType }> {
  return new AsyncFunction(String(code))(options);
}

/**
 * Create the JSX runtime options for runMDX().
 * Checked once at module load to avoid repeated environment checks.
 */
function createRunOptions() {
  const isDevelopment = process.env.NODE_ENV === 'development';
  return isDevelopment ? { ...devRuntime } : { ...runtime };
}

const runOptions = createRunOptions();

/**
 * Simple hash function for generating cache keys from MDX content.
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

export interface UseMDXEvaluationOptions {
  mdxContent: string | null;
  cacheKey?: string;
  apiBaseUrl: string;
}

export interface UseMDXEvaluationResult {
  Component: React.ComponentType | null;
  error: Error | null;
  isLoading: boolean;
  retry: () => void;
}

/**
 * Hook for evaluating MDX content into React components.
 *
 * Uses a server-side compile + browser-side run pattern:
 * 1. Sends raw MDX to the server's /mdx/compile endpoint
 * 2. Server compiles MDX → JavaScript function body (using acorn, remark, etc.)
 * 3. Browser executes the pre-compiled code with run() (zero dependencies)
 *
 * This keeps the full MDX compilation pipeline (~200KB) on the server and
 * only ships a 3-line run() function to the browser.
 *
 * @param options.mdxContent - The MDX string to evaluate. If null, returns null component
 * @param options.cacheKey - Optional cache key. If not provided, uses hash of content
 * @param options.apiBaseUrl - Base URL for the CMS API (e.g. '/__cms/api')
 *
 * @returns Object containing Component, error, isLoading, retry
 */
export function useMDXEvaluation({
  mdxContent,
  cacheKey,
  apiBaseUrl,
}: UseMDXEvaluationOptions): UseMDXEvaluationResult {
  const [Component, setComponent] = useState<React.ComponentType | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(!!mdxContent);
  const [retryCount, setRetryCount] = useState(0);

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

    const key = cacheKey || `mdx-${hashString(mdxContent)}`;
    const cached = compiledCache.get(key);
    if (cached) {
      setComponent(() => cached);
      setError(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const compileAndRun = async () => {
      try {
        setError(null);
        setIsLoading(true);

        // 1. Send MDX to server for compilation
        const res = await fetch(`${apiBaseUrl}/mdx/compile`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mdxContent }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `MDX compilation failed (${res.status})`);
        }

        const { code } = await res.json();

        if (cancelled) return;

        // 2. Run pre-compiled code in browser (zero dependencies)
        const { default: MDXComponent } = await runMDX(code, runOptions);

        if (cancelled) return;

        compiledCache.set(key, MDXComponent);
        setComponent(() => MDXComponent);
      } catch (err) {
        if (cancelled) return;
        const evaluationError = err instanceof Error ? err : new Error('MDX evaluation failed');
        setError(evaluationError);
        setComponent(null);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    compileAndRun();

    return () => {
      cancelled = true;
    };
  }, [mdxContent, cacheKey, apiBaseUrl, retryCount]);

  return { Component, error, isLoading, retry };
}
