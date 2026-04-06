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
 *
 * Note: Uses AsyncFunction constructor which requires CSP `unsafe-eval`.
 * This is acceptable since the CMS admin UI runs in a trusted environment.
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
  compiledCode: string | null;
  cacheKey?: string;
}

export interface UseMDXEvaluationResult {
  Component: React.ComponentType | null;
  error: Error | null;
  isLoading: boolean;
  retry: () => void;
}

/**
 * Hook for evaluating pre-compiled MDX code into React components.
 *
 * Uses the browser-side half of a server-compile + browser-run pattern:
 * 1. The server compiles MDX → JavaScript function body
 * 2. The browser executes the pre-compiled code with run() (zero compiler dependencies)
 *
 * This keeps the full MDX compilation pipeline on the server and only ships
 * a tiny runtime helper to the browser.
 *
 * @param options.compiledCode - The pre-compiled MDX function body. If null, returns null component
 * @param options.cacheKey - Optional cache key. If not provided, uses hash of code
 *
 * @returns Object containing Component, error, isLoading, retry
 */
export function useMDXEvaluation({ compiledCode, cacheKey }: UseMDXEvaluationOptions): UseMDXEvaluationResult {
  const [Component, setComponent] = useState<React.ComponentType | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(!!compiledCode);
  const [retryCount, setRetryCount] = useState(0);

  const retry = () => {
    if (compiledCode) {
      const key = cacheKey || `mdx-${hashString(compiledCode)}`;
      compiledCache.delete(key);
    }
    setRetryCount((prev) => prev + 1);
  };

  useEffect(() => {
    void retryCount;

    if (!compiledCode) {
      setComponent(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    const key = cacheKey || `mdx-${hashString(compiledCode)}`;
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

        const { default: MDXComponent } = await runMDX(compiledCode, runOptions);

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
  }, [compiledCode, cacheKey, retryCount]);

  return { Component, error, isLoading, retry };
}
