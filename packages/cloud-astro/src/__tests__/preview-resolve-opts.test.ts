import { describe, expect, it } from 'bun:test';
import { resolveEndpointFetch } from '../preview/_resolve-opts.js';

describe('resolveEndpointFetch', () => {
  it('resolves undefined off Cloudflare Workers so callers use the global fetch', async () => {
    // Cloudflare's runtime module only exists inside workerd; here (bun) the
    // dynamic import throws and the probe must swallow it — a crash would take
    // down every Node preview deployment.
    await expect(resolveEndpointFetch()).resolves.toBeUndefined();
  });
});
