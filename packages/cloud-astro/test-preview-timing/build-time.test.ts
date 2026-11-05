import { expect, it } from 'bun:test';
import { type Adapter, buildFixture } from '../test-preview-hosts/fixtures.js';

/**
 * The d8 build-time guard, apart from the fixture lanes: a wall-clock ratio means something only on a quiet machine, so
 * its Nx target runs with nothing beside it and is not a dependency of `test`, which the release lane runs on a shared
 * runner (a vercel build there took 8.6 s plain and 28.6 s with d8 while the other lanes built; alone, d8 costs ~2.3x).
 */
const ADAPTERS: Adapter[] = ['vercel', 'netlify', 'node', 'cloudflare'];

for (const adapter of ADAPTERS) {
  it(`${adapter}: builds a static site in under three times its no-preview build`, async () => {
    // One after the other; other jobs may still load the host, so the builds alternate three times and the fastest
    // of each compares.
    let plain = Number.POSITIVE_INFINITY;
    let preview = Number.POSITIVE_INFINITY;
    for (let sample = 0; sample < 3; sample++) {
      // oxlint-disable-next-line no-await-in-loop -- the builds must not overlap.
      plain = Math.min(plain, (await buildFixture(adapter, 'static', { preview: false, copy: '-timed' })).ms);
      // oxlint-disable-next-line no-await-in-loop -- as above.
      preview = Math.min(preview, (await buildFixture(adapter, 'static', { preview: true, copy: '-timed' })).ms);
    }
    console.info(`${adapter}-static build: ${plain} ms without preview, ${preview} ms with d8`);
    expect(preview).toBeLessThan(plain * 3);
  }, 600_000);
}
