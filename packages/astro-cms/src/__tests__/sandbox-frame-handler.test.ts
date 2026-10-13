import { describe, expect, test } from 'bun:test';
import { SANDBOX_FRAME_PATH } from '@conloca/mdx/sandbox-frame';
import { GET, prerender } from '../sandbox-frame-handler.js';

describe('sandbox-frame-handler', () => {
  test('serves the frame document with its exact header set', async () => {
    const res = (await GET({} as never)) as Response;
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    // These headers are the frame's contract (SANDBOX_FRAME_CSP); any other
    // server of the frame must match them.
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'self'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('no-store');

    const html = await res.text();
    expect(html).toContain('__sandbox_root');
    expect(html).toContain('conloca-prose');
  });

  test('never prerenders — the route must exist on the server at runtime', () => {
    expect(prerender).toBe(false);
  });

  test('the path constant this route must be mounted on is unchanged', () => {
    // plugin-spa injects the route at this literal; if the contract moves,
    // this test points at both sides that need the same change.
    expect(SANDBOX_FRAME_PATH).toBe('/api/v1/mdx/sandbox-frame');
  });
});
