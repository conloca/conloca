import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assetMetadataRecordPath,
  parseAssetMetadata,
  patchAssetMetadata,
  sameAssetMetadata,
  serializeAssetMetadata,
} from '../src/asset-metadata-record.js';
import * as assetMetadata from '../src/asset-metadata-store.js';

describe('the asset metadata record', () => {
  let project: string;
  let roots: assetMetadata.MetadataRoots;

  beforeEach(async () => {
    project = join(tmpdir(), `conloca-meta-record-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    roots = { assetsPath: join(project, 'public', 'assets'), contentRoot: join(project, 'content') };
    await mkdir(roots.contentRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(project, { recursive: true, force: true });
  });

  test('is written by the local store at the shared path with the shared bytes', async () => {
    await assetMetadata.write(roots, 'trip/beach.png', { alt: 'Beach', tags: ['sea'] });

    const written = await readFile(join(roots.contentRoot, assetMetadataRecordPath('trip/beach.png')), 'utf-8');
    expect(written).toBe('{\n  "alt": "Beach",\n  "tags": [\n    "sea"\n  ]\n}');
    expect(written).toBe(serializeAssetMetadata({ alt: 'Beach', tags: ['sea'] }));
  });

  test('reads back what was written and keeps fields it does not know', () => {
    const unknownField = { alt: 'A', x: 1 };
    expect(parseAssetMetadata(JSON.stringify(unknownField))).toEqual(unknownField);
  });

  test('refuses what the local store refuses', () => {
    for (const raw of ['', '  ', 'not json', '{"alt":3}', '{"tags":[1]}', '[]', 'null']) {
      expect(parseAssetMetadata(raw)).toBeNull();
    }
  });

  test('treats an empty record as no record and ignores formatting', () => {
    expect(sameAssetMetadata({}, null)).toBe(true);
    expect(sameAssetMetadata(parseAssetMetadata('{\n"alt": "A"}'), { alt: 'A' })).toBe(true);
    expect(sameAssetMetadata({ alt: 'A' }, { alt: 'B' })).toBe(false);
    expect(sameAssetMetadata({ tags: ['a', 'b'] }, { tags: ['b', 'a'] })).toBe(false);
  });

  test('a patch keeps absent fields and clears null ones', () => {
    expect(patchAssetMetadata({ alt: 'A', tags: ['x'] }, { alt: null, tags: ['y'] })).toEqual({ tags: ['y'] });
  });
});
