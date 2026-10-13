import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as assetMetadata from '../src/asset-metadata-store.js';
import { withTimeout } from './test-helpers.js';

describe('asset metadata store', () => {
  let project: string;
  let assetsPath: string;
  let contentRoot: string;
  let roots: assetMetadata.MetadataRoots;

  beforeEach(async () => {
    project = join(tmpdir(), `conloca-meta-store-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    assetsPath = join(project, 'public', 'assets');
    contentRoot = join(project, 'content');
    roots = { assetsPath, contentRoot };
    await mkdir(assetsPath, { recursive: true });
    await mkdir(contentRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(project, { recursive: true, force: true });
  });

  function recordFile(relativePath: string): string {
    return join(contentRoot, '.asset-metadata', `${relativePath}.json`);
  }

  describe('read and write', () => {
    test('a written record reads back, including from a subfolder', async () => {
      await assetMetadata.write(roots, 'uploads/hero.png', { alt: 'Our team', tags: ['hero'] });

      expect(await assetMetadata.read(roots, 'uploads/hero.png')).toEqual({ alt: 'Our team', tags: ['hero'] });
      expect(JSON.parse(await readFile(recordFile('uploads/hero.png'), 'utf-8'))).toEqual({
        alt: 'Our team',
        tags: ['hero'],
      });
    });

    test('a missing record reads as undefined', async () => {
      expect(await assetMetadata.read(roots, 'nothing.png')).toBeUndefined();
    });

    test('an unreadable record warns by name and reads as undefined', async () => {
      await mkdir(join(contentRoot, '.asset-metadata'), { recursive: true });
      await writeFile(recordFile('hero.png'), '{ truncated');
      const warn = spyOn(console, 'warn').mockImplementation(() => {});

      try {
        expect(await assetMetadata.read(roots, 'hero.png')).toBeUndefined();
        expect(warn.mock.calls.flat().join(' ')).toContain('hero.png.json');
      } finally {
        warn.mockRestore();
      }
    });

    test('a write replaces the stored record rather than merging into it', async () => {
      await assetMetadata.write(roots, 'hero.png', { alt: 'Before', tags: ['old'] });
      await assetMetadata.write(roots, 'hero.png', { alt: 'After' });

      expect(await assetMetadata.read(roots, 'hero.png')).toEqual({ alt: 'After' });
    });
  });

  describe('readFolder', () => {
    test('an unreadable metadata directory does not make legacy records current again', async () => {
      await assetMetadata.write(roots, 'hero.png', { alt: 'Current' });
      await writeFile(join(assetsPath, '.asset-manifest.json'), JSON.stringify({ 'hero.png': { alt: 'Stale' } }));
      const directory = join(contentRoot, '.asset-metadata');
      await chmod(directory, 0o000);
      try {
        expect(await assetMetadata.readFolder(roots, '/')).toEqual(new Map());
      } finally {
        await chmod(directory, 0o700);
      }
    });

    for (const bytes of ['', '{ truncated']) {
      test(`a damaged record does not resurrect legacy metadata in a folder listing: ${JSON.stringify(bytes)}`, async () => {
        await assetMetadata.write(roots, 'hero.png', { alt: 'Current' });
        await writeFile(recordFile('hero.png'), bytes);
        await writeFile(
          join(assetsPath, '.asset-manifest.json'),
          JSON.stringify({
            'hero.png': { alt: 'Stale' },
            'legacy-only.png': { alt: 'Still valid' },
          }),
        );
        expect(await assetMetadata.read(roots, 'hero.png')).toBeUndefined();
        expect(await assetMetadata.readFolder(roots, '/')).toEqual(
          new Map([['legacy-only.png', { alt: 'Still valid' }]]),
        );
        expect(await readFile(recordFile('hero.png'), 'utf-8')).toBe(bytes);
      });
    }

    test('a missing metadata directory reads as an empty map', async () => {
      expect(await assetMetadata.readFolder(roots, '/')).toEqual(new Map());
    });

    test('records are keyed by path relative to the assets root', async () => {
      await assetMetadata.write(roots, 'uploads/hero.png', { alt: 'Deep' });
      await assetMetadata.write(roots, 'root.png', { alt: 'Shallow' });

      expect(await assetMetadata.readFolder(roots, '/uploads')).toEqual(
        new Map([['uploads/hero.png', { alt: 'Deep' }]]),
      );
      expect(await assetMetadata.readFolder(roots, '/')).toEqual(new Map([['root.png', { alt: 'Shallow' }]]));
    });

    test('one unreadable record does not hide the others', async () => {
      await assetMetadata.write(roots, 'good.png', { alt: 'Good' });
      await writeFile(recordFile('bad.png'), '');
      const warn = spyOn(console, 'warn').mockImplementation(() => {});

      try {
        expect(await assetMetadata.readFolder(roots, '/')).toEqual(new Map([['good.png', { alt: 'Good' }]]));
      } finally {
        warn.mockRestore();
      }
    });
  });

  describe('update', () => {
    test('absent keys are kept, null clears, and the merged value is returned', async () => {
      await assetMetadata.write(roots, 'hero.png', { alt: 'Keep me', tags: ['a'], originalName: 'Hero.PNG' });

      const merged = await assetMetadata.update(roots, 'hero.png', { tags: ['b'], originalName: null });

      expect(merged).toEqual({ alt: 'Keep me', tags: ['b'] });
      expect(await assetMetadata.read(roots, 'hero.png')).toEqual({ alt: 'Keep me', tags: ['b'] });
    });
  });

  describe('remove and move', () => {
    test('remove reports a filesystem failure instead of claiming a record disappeared', async () => {
      await mkdir(recordFile('hero.png'), { recursive: true });
      await writeFile(join(recordFile('hero.png'), 'keep.txt'), 'Still here');
      await expect(assetMetadata.remove(roots, 'hero.png')).rejects.toThrow();
      expect(await readFile(join(recordFile('hero.png'), 'keep.txt'), 'utf-8')).toBe('Still here');
    });

    test('move reports an obstructed destination and releases its locks after failure', async () => {
      await assetMetadata.write(roots, 'hero.png', { alt: 'Keep me' });
      const obstruction = join(contentRoot, '.asset-metadata', 'target');
      await writeFile(obstruction, 'Not a directory');
      await expect(assetMetadata.move(roots, 'hero.png', 'target/hero.png')).rejects.toThrow();
      expect(await assetMetadata.read(roots, 'hero.png')).toEqual({ alt: 'Keep me' });
      expect(await readFile(obstruction, 'utf-8')).toBe('Not a directory');
      await withTimeout(assetMetadata.update(roots, 'hero.png', { tags: ['after'] }), 'save after failed move');
      expect(await assetMetadata.read(roots, 'hero.png')).toEqual({ alt: 'Keep me', tags: ['after'] });
    });

    test('remove deletes the record and is a no-op when there is none', async () => {
      await assetMetadata.write(roots, 'hero.png', { alt: 'Doomed' });
      await assetMetadata.remove(roots, 'hero.png');
      await assetMetadata.remove(roots, 'hero.png');

      expect(await assetMetadata.read(roots, 'hero.png')).toBeUndefined();
    });

    test('move carries the record to the new path', async () => {
      await assetMetadata.write(roots, 'source/hero.png', { alt: 'Travelling' });
      await assetMetadata.move(roots, 'source/hero.png', 'target/hero.png');

      expect(await assetMetadata.read(roots, 'target/hero.png')).toEqual({ alt: 'Travelling' });
      expect(await assetMetadata.read(roots, 'source/hero.png')).toBeUndefined();
    });

    test('move onto the same path finishes, and the record can still be saved afterwards', async () => {
      await assetMetadata.write(roots, 'hero.png', { alt: 'Staying put' });

      await withTimeout(assetMetadata.move(roots, 'hero.png', 'hero.png'), 'move onto the same path');
      // A move that waits on a lock it already holds leaves that wait in the
      // shared map, and every later save on the same picture queues behind it
      await withTimeout(assetMetadata.update(roots, 'hero.png', { tags: ['after'] }), 'the save after that move');

      expect(await assetMetadata.read(roots, 'hero.png')).toEqual({ alt: 'Staying put', tags: ['after'] });
    });
  });

  describe('serialising updates to one record', () => {
    test('an update that arrives after an earlier one finished still queues behind the rest', async () => {
      // The natural `finally { chains.delete(key) }` lets a finishing writer
      // drop a LATER writer's chain entry, and the next arrival then runs
      // alongside it. Three in flight, then a fourth the moment the first
      // returns, is exactly that shape.
      await assetMetadata.write(roots, 'hero.png', {});

      const first = assetMetadata.update(roots, 'hero.png', { alt: 'first' });
      const rest = [
        assetMetadata.update(roots, 'hero.png', { tags: ['second'] }),
        assetMetadata.update(roots, 'hero.png', { originalName: 'third.png' }),
      ];
      await first;
      const late = assetMetadata.update(roots, 'hero.png', { uploadedAt: '2026-01-01T00:00:00.000Z' });
      await Promise.all([...rest, late]);

      expect(await assetMetadata.read(roots, 'hero.png')).toEqual({
        alt: 'first',
        tags: ['second'],
        originalName: 'third.png',
        uploadedAt: '2026-01-01T00:00:00.000Z',
      });
    });
  });

  describe('migrateLegacyManifest', () => {
    const legacyPath = () => join(assetsPath, '.asset-manifest.json');
    const backupPath = () => join(contentRoot, '.asset-metadata', '.asset-manifest.json.migrated');

    test('does nothing when there is no legacy manifest', async () => {
      await assetMetadata.migrateLegacyManifest(roots);

      await expect(stat(join(contentRoot, '.asset-metadata'))).rejects.toThrow();
    });

    test('carries the human fields across and drops the cached dimensions', async () => {
      await writeFile(
        legacyPath(),
        JSON.stringify({
          'hero.png': {
            alt: 'Our team',
            tags: ['hero'],
            originalName: 'Our Team.PNG',
            uploadedAt: '2026-01-01T00:00:00.000Z',
            uploadedBy: 'someone',
            width: 999,
            height: 111,
          },
        }),
      );

      await assetMetadata.migrateLegacyManifest(roots);

      expect(await assetMetadata.read(roots, 'hero.png')).toEqual({
        alt: 'Our team',
        tags: ['hero'],
        originalName: 'Our Team.PNG',
        uploadedAt: '2026-01-01T00:00:00.000Z',
        uploadedBy: 'someone',
      });
    });

    test('keeps a record that already parses and rebuilds one that does not', async () => {
      await assetMetadata.write(roots, 'kept.png', { alt: 'Newer, keep me' });
      await writeFile(recordFile('torn.png'), '');
      await writeFile(
        legacyPath(),
        JSON.stringify({ 'kept.png': { alt: 'Older, drop me' }, 'torn.png': { alt: 'Rebuild me' } }),
      );

      await assetMetadata.migrateLegacyManifest(roots);

      expect(await assetMetadata.read(roots, 'kept.png')).toEqual({ alt: 'Newer, keep me' });
      expect(await assetMetadata.read(roots, 'torn.png')).toEqual({ alt: 'Rebuild me' });
    });

    test('moves the legacy file out of the media folder last, keeping its bytes next to the records', async () => {
      const raw = JSON.stringify({ 'hero.png': { alt: 'Our team' } });
      await writeFile(legacyPath(), raw);

      await assetMetadata.migrateLegacyManifest(roots);

      await expect(stat(legacyPath())).rejects.toThrow();
      await expect(stat(`${legacyPath()}.migrated`)).rejects.toThrow();
      expect(await readFile(backupPath(), 'utf-8')).toBe(raw);
    });

    test('throws naming the file when the legacy manifest will not parse, writing nothing', async () => {
      await writeFile(legacyPath(), '<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> branch\n');

      await expect(assetMetadata.migrateLegacyManifest(roots)).rejects.toThrow('.asset-manifest.json');
      await stat(legacyPath());
      await expect(stat(join(contentRoot, '.asset-metadata'))).rejects.toThrow();
    });

    test('two concurrent migrations both settle and the legacy file ends up moved once', async () => {
      await writeFile(legacyPath(), JSON.stringify({ 'hero.png': { alt: 'Our team' } }));

      await Promise.all([assetMetadata.migrateLegacyManifest(roots), assetMetadata.migrateLegacyManifest(roots)]);

      expect(await assetMetadata.read(roots, 'hero.png')).toEqual({ alt: 'Our team' });
      await expect(stat(legacyPath())).rejects.toThrow();
      await stat(backupPath());
    });
  });
});

describe('asset metadata store: paths that climb out of the media library', () => {
  let container: string;
  let library: string;
  let roots: assetMetadata.MetadataRoots;
  let neighbour: string;
  const neighbourBytes = '{"this file":"has nothing to do with the media library"}';

  beforeEach(async () => {
    container = join(tmpdir(), `conloca-meta-escape-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    library = join(container, 'assets');
    // `../../sites` from the records directory under this content root names the neighbour
    roots = { assetsPath: library, contentRoot: join(container, 'content') };
    neighbour = join(container, 'sites.json');
    await mkdir(library, { recursive: true });
    await writeFile(neighbour, neighbourBytes);
  });

  afterEach(async () => {
    await rm(container, { recursive: true, force: true });
  });

  test('remove refuses the path instead of deleting the file next to the library', async () => {
    await expect(assetMetadata.remove(roots, '../../sites')).rejects.toThrow('Path traversal detected');

    expect(await readFile(neighbour, 'utf-8')).toBe(neighbourBytes);
  });

  test('write refuses to put a record outside the library', async () => {
    await expect(assetMetadata.write(roots, '../../sites', { alt: 'planted' })).rejects.toThrow(
      'Path traversal detected',
    );

    expect(await readFile(neighbour, 'utf-8')).toBe(neighbourBytes);
  });

  test('update refuses to merge into a file outside the library', async () => {
    await expect(assetMetadata.update(roots, '../../sites', { alt: 'planted' })).rejects.toThrow(
      'Path traversal detected',
    );

    expect(await readFile(neighbour, 'utf-8')).toBe(neighbourBytes);
  });

  test('move refuses either end of the journey', async () => {
    await assetMetadata.write(roots, 'hero.png', { alt: 'Home' });

    await expect(assetMetadata.move(roots, 'hero.png', '../../sites')).rejects.toThrow('Path traversal detected');
    await expect(assetMetadata.move(roots, '../../sites', 'hero.png')).rejects.toThrow('Path traversal detected');

    expect(await readFile(neighbour, 'utf-8')).toBe(neighbourBytes);
    expect(await assetMetadata.read(roots, 'hero.png')).toEqual({ alt: 'Home' });
  });

  test('a legacy entry that climbs out is left behind instead of stopping the migration', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    await writeFile(
      join(library, '.asset-manifest.json'),
      JSON.stringify({ '../../sites': { alt: 'planted' }, 'hero.png': { alt: 'Our team' } }),
    );

    try {
      await assetMetadata.migrateLegacyManifest(roots);

      expect(await assetMetadata.read(roots, 'hero.png')).toEqual({ alt: 'Our team' });
      expect(await readFile(neighbour, 'utf-8')).toBe(neighbourBytes);
      expect(warn.mock.calls.flat().join(' ')).toContain('../../sites');
    } finally {
      warn.mockRestore();
    }
  });
});

describe('asset metadata store: a damaged record is never treated as an empty one', () => {
  let project: string;
  let assetsPath: string;
  let contentRoot: string;
  let roots: assetMetadata.MetadataRoots;

  beforeEach(async () => {
    project = join(tmpdir(), `conloca-meta-damaged-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    assetsPath = join(project, 'public', 'assets');
    contentRoot = join(project, 'content');
    roots = { assetsPath, contentRoot };
    await mkdir(assetsPath, { recursive: true });
    await mkdir(join(contentRoot, '.asset-metadata'), { recursive: true });
  });

  afterEach(async () => {
    await rm(project, { recursive: true, force: true });
  });

  function recordFile(relativePath: string): string {
    return join(contentRoot, '.asset-metadata', `${relativePath}.json`);
  }

  /**
   * The defect this whole change exists to remove: "I could not read this"
   * silently becoming "there was nothing here". Display stays tolerant — a
   * damaged record must not blank the library — but a WRITE on top of one
   * would destroy the alt text, original name and upload date still sitting
   * in the bytes we failed to parse. It has to refuse instead.
   */
  for (const [shape, bytes] of [
    ['zero-length', ''],
    ['conflict markers', '<<<<<<< HEAD\n{"alt":"mine"}\n=======\n{"alt":"theirs"}\n>>>>>>> branch\n'],
    ['truncated json', '{"alt":"Our team","tags":["he'],
  ] as [string, string][]) {
    test(`refuses to overwrite a ${shape} record`, async () => {
      await mkdir(join(contentRoot, '.asset-metadata'), { recursive: true });
      await writeFile(recordFile('hero.png'), bytes, 'utf-8');

      await expect(assetMetadata.update(roots, 'hero.png', { tags: ['new-tag'] })).rejects.toThrow(
        /unreadable|damaged/i,
      );

      // The bytes we could not read are still there to be rescued by hand.
      expect(await readFile(recordFile('hero.png'), 'utf-8')).toBe(bytes);
    });
  }

  test('still reads as undefined so a damaged record cannot blank the library', async () => {
    await mkdir(join(contentRoot, '.asset-metadata'), { recursive: true });
    await writeFile(recordFile('hero.png'), '{"alt":"Our team","tags":["he', 'utf-8');

    expect(await assetMetadata.read(roots, 'hero.png')).toBeUndefined();
  });

  test('an absent record is still an ordinary first write', async () => {
    const written = await assetMetadata.update(roots, 'hero.png', { alt: 'First' });

    expect(written).toEqual({ alt: 'First' });
    expect(await assetMetadata.read(roots, 'hero.png')).toEqual({ alt: 'First' });
  });

  /**
   * A record that exists but cannot be opened (permissions, a failing disk) is
   * not an absent one: its bytes are still there, nobody has seen them, and a
   * save must not rename a fresh file over them.
   */
  test('refuses to overwrite a record it cannot open', async () => {
    const bytes = '{"alt":"Our team","originalName":"Team.PNG"}';
    await writeFile(recordFile('hero.png'), bytes, 'utf-8');
    await chmod(recordFile('hero.png'), 0o000);

    try {
      await expect(assetMetadata.update(roots, 'hero.png', { tags: ['new-tag'] })).rejects.toThrow('hero.png.json');
    } finally {
      await chmod(recordFile('hero.png'), 0o644);
    }

    expect(await readFile(recordFile('hero.png'), 'utf-8')).toBe(bytes);
  });

  test('the legacy migration does not rebuild a record it cannot open from older data', async () => {
    const legacyPath = join(assetsPath, '.asset-manifest.json');
    await writeFile(recordFile('hero.png'), '{"alt":"Newer"}', 'utf-8');
    await writeFile(legacyPath, JSON.stringify({ 'hero.png': { alt: 'Older' } }));
    await chmod(recordFile('hero.png'), 0o000);

    try {
      await expect(assetMetadata.migrateLegacyManifest(roots)).rejects.toThrow('hero.png.json');
    } finally {
      await chmod(recordFile('hero.png'), 0o644);
    }

    expect(JSON.parse(await readFile(recordFile('hero.png'), 'utf-8'))).toEqual({ alt: 'Newer' });
    // Still in place, so the next save tries the migration again
    await stat(legacyPath);
  });

  test('a legacy manifest that cannot be opened stops the migration instead of reading as none', async () => {
    const legacyPath = join(assetsPath, '.asset-manifest.json');
    await writeFile(legacyPath, JSON.stringify({ 'hero.png': { alt: 'Our team' } }));
    await chmod(legacyPath, 0o000);

    try {
      await expect(assetMetadata.migrateLegacyManifest(roots)).rejects.toThrow('.asset-manifest.json');
    } finally {
      await chmod(legacyPath, 0o644);
    }
  });
});
