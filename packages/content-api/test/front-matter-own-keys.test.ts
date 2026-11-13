import { expect, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FileSystemContentAPI } from '../src/filesystem-content-api.js';
import { testTempDir } from './test-temp-dir.js';

test('a title edit keeps special author keys and their original frontmatter lines', async () => {
  const dir = testTempDir('content-api-front-matter-own-keys');
  try {
    await mkdir(join(dir, 'fragments/general'), { recursive: true });
    const sites = { sites: { default: { locales: ['en'], defaultLocale: 'en' } }, globalLocales: ['en'] };
    await writeFile(join(dir, 'sites.json'), JSON.stringify(sites));
    const path = join(dir, 'fragments/general/page.en.mdx');
    const previousModified = '2024-01-01T00:00:00.000Z';
    const source = [
      '---',
      'id: fragment-own-keys',
      'title: Before',
      'created: 2024-01-01',
      `modified: '${previousModified}'`,
      '__proto__: { saved: true } # author data',
      "constructor: 'author-value'",
      'toString: retained',
      'hasOwnProperty: true',
      '---',
      '# Kept body',
      '',
    ].join('\n');
    await writeFile(path, source);
    const api = await FileSystemContentAPI.create({ contentRoot: dir });
    expect(await readFile(path, 'utf8')).toBe(source);
    const current = await api.getLocalized('fragment-own-keys', 'en');
    if (!current) throw new Error('Expected the fixture page to be indexed');

    const saved = await api.updateLocalized({
      id: 'fragment-own-keys',
      locale: 'en',
      data: { meta: { title: 'After' } },
      etag: current.localized.etag,
    });
    expect(saved.success).toBe(true);
    const written = await readFile(path, 'utf8');
    const modified = /\nmodified: '([^']+)'\n/.exec(written)?.[1];
    if (modified === undefined) throw new Error('Expected a persisted modification timestamp');
    expect(written).toBe(source.replace('title: Before', 'title: After').replace(previousModified, modified));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
