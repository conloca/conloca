import { describe, expect, test } from 'bun:test';
import { MDX_SANDBOX_FRAME_POLICY, SANDBOX_FRAME_PATH } from '@conloca/mdx/sandbox-frame';
import { prerender, sandboxFrameResponse } from '../sandbox-frame-handler.js';

// The test DOM's Request drops Sec-Fetch-* as a browser would, so the route gets the headers alone.
function frameRequest(headers: Record<string, string>): Response {
  return sandboxFrameResponse({ headers: new Headers(headers) });
}

describe('sandbox-frame-handler', () => {
  test('serves the frame document with its exact header set', async () => {
    const res = frameRequest({ 'sec-fetch-dest': 'iframe' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    // These headers are the frame's contract (MDX_SANDBOX_FRAME_POLICY); any
    // other server of the frame must match them.
    expect(res.headers.get('content-security-policy')).toBe(MDX_SANDBOX_FRAME_POLICY);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('no-store');

    const html = await res.text();
    expect(html).toContain('__sandbox_root');
    expect(html).toContain('conloca-prose');
  });

  test.each<Record<string, string>>([{}, { 'sec-fetch-dest': 'document' }])(
    'answers 403 to any request that is not an iframe load (%o)',
    async (headers) => {
      const res = frameRequest(headers);
      expect(res.status).toBe(403);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.text()).not.toContain('__sandbox_root');
    },
  );

  test('never prerenders — the route must exist on the server at runtime', () => {
    expect(prerender).toBe(false);
  });

  test('the path constant this route must be mounted on is unchanged', () => {
    // plugin-spa injects the route at this literal; if the contract moves,
    // this test points at both sides that need the same change.
    expect(SANDBOX_FRAME_PATH).toBe('/api/v1/mdx/sandbox-frame');
  });
});
