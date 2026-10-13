import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import * as store from '../src/asset-metadata-store.js';
import type { AssetMetadata } from '../src/asset-types.js';

const text = fc.string({ maxLength: 32 });
const patch = fc.oneof(
  fc.record({ alt: fc.option(text, { nil: null }) }),
  fc.record({ tags: fc.option(fc.array(text, { maxLength: 4 }), { nil: null }) }),
);

test('filesystem metadata follows the patch model through generated edit and clear sequences', async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(patch, { minLength: 1, maxLength: 12 }), async (patches) => {
      const project = await mkdtemp(join(tmpdir(), 'metadata-model-'));
      const roots = { assetsPath: join(project, 'assets'), contentRoot: join(project, 'content') };
      try {
        await mkdir(roots.assetsPath);
        await mkdir(roots.contentRoot);
        const expected: AssetMetadata = { originalName: 'original.png' };
        await store.write(roots, 'hero.png', expected);
        for (const change of patches) {
          if ('alt' in change) {
            if (change.alt === null) delete expected.alt;
            else expected.alt = change.alt;
          }
          if ('tags' in change) {
            if (change.tags === null) delete expected.tags;
            else expected.tags = change.tags;
          }
          expect(await store.update(roots, 'hero.png', change)).toEqual(expected);
          expect(await store.read(roots, 'hero.png')).toEqual(expected);
          expect((await store.readFolder(roots, '/')).get('hero.png')).toEqual(expected);
        }
      } finally {
        await rm(project, { recursive: true, force: true });
      }
    }),
    { seed: 103, numRuns: 75 },
  );
});
