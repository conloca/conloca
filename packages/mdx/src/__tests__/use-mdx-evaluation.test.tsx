import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { useMDXEvaluation } from '../hooks/useMDXEvaluation';

afterEach(() => {
  cleanup();
});

// Minimal compiled MDX function body that returns a component rendering a <p>
const validCompiledCode = `
const {jsx} = arguments[0];
return { default: function MDXContent() { return jsx("p", { children: "hello" }); } };
`;

const invalidCompiledCode = 'this is not valid javascript {';

describe('useMDXEvaluation', () => {
  test('returns null component when compiledCode is null', () => {
    const { result } = renderHook(() => useMDXEvaluation({ compiledCode: null }));

    expect(result.current.Component).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  test('evaluates valid compiled code into a component', async () => {
    const { result } = renderHook(() => useMDXEvaluation({ compiledCode: validCompiledCode }));

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.Component).not.toBeNull();
    expect(result.current.error).toBeNull();
  });

  test('sets error for invalid compiled code', async () => {
    const { result } = renderHook(() => useMDXEvaluation({ compiledCode: invalidCompiledCode }));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.Component).toBeNull();
  });

  test('caches components by key', async () => {
    const key = 'test-cache-key';
    const { result, rerender } = renderHook(() => useMDXEvaluation({ compiledCode: validCompiledCode, cacheKey: key }));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const firstComponent = result.current.Component;

    // Re-render — should return the cached component synchronously
    rerender();
    expect(result.current.Component).toBe(firstComponent);
    expect(result.current.isLoading).toBe(false);
  });

  test('does not update state after unmount', async () => {
    const { result, unmount } = renderHook(() =>
      useMDXEvaluation({ compiledCode: validCompiledCode, cacheKey: 'unmount-test' }),
    );

    // Unmount immediately while evaluation is in progress
    unmount();

    // No error should be thrown (cancelled flag prevents setState after unmount)
    expect(result.current.error).toBeNull();
  });
});
