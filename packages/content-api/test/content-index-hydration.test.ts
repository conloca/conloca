import { describe, expect, it } from 'bun:test';
import { ContentIndex } from '../src/content-index.js';
import type { BackendReadResult, ContentReaderBackend } from '../src/reader-backend.js';
import type { SitesConfig } from '../src/types.js';
import { VXJSON } from '../src/vxjson.js';

const sitesConfig: SitesConfig = {
  sites: {
    shop: { locales: ['en', 'nl'], defaultLocale: 'en' },
  },
  globalLocales: ['en', 'nl'],
};

const enc = new TextEncoder();

function validVxjsonBytes(id: string, title: string): Uint8Array {
  return enc.encode(
    VXJSON.serialize({
      id,
      type: 'puck',
      created: '2024-01-01T00:00:00.000Z',
      modified: '2024-01-02T00:00:00.000Z',
      meta: { title },
      content: { puckData: { root: {} } },
    }),
  );
}

function vxjsonBytesForSite(id: string, title: string, site: string): Uint8Array {
  return enc.encode(
    VXJSON.serialize({
      id,
      type: 'puck',
      site,
      collection: 'pages',
      created: '2024-01-01T00:00:00.000Z',
      modified: '2024-01-02T00:00:00.000Z',
      meta: { title },
      content: { puckData: { root: {} } },
    } as never),
  );
}

function fakeBackend(items: { path: string; bytes: Uint8Array }[]): ContentReaderBackend {
  return {
    async *listContentPaths(opts) {
      const headerBytes = opts?.headerBytes ?? 4096;
      for (const { path, bytes } of items) {
        const headerLen = Math.min(bytes.byteLength, headerBytes);
        yield {
          ok: true,
          path,
          size: bytes.byteLength,
          header: bytes.subarray(0, headerLen),
          complete: headerLen === bytes.byteLength,
        };
      }
    },
    async readPath() {
      return null;
    },
  };
}

function errorBackend(items: BackendReadResult[]): ContentReaderBackend {
  return {
    async *listContentPaths() {
      for (const item of items) yield item;
    },
    async readPath() {
      return null;
    },
  };
}

describe('ContentIndex.indexAll', () => {
  it.each(['constructor', '__proto__', 'toString'])('reports the undeclared site %s as unknown', async (site) => {
    const idx = ContentIndex.createUncached(sitesConfig);
    const errors: string[] = [];
    const summary = await idx.indexAll(
      fakeBackend([{ path: `${site}/pages/index.en.vxjson`, bytes: validVxjsonBytes('unknown-site', 'Page') }]),
      { onError: (_path, reason) => errors.push(reason) },
    );
    expect(summary.indexed).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(errors).toEqual(['unknown-site']);
  });

  it('reports indexed count and populates the index', async () => {
    const idx = ContentIndex.createUncached(sitesConfig);
    const backend = fakeBackend([
      { path: 'shop/pages/a.en.vxjson', bytes: validVxjsonBytes('p-a', 'A') },
      { path: 'shop/pages/b.en.vxjson', bytes: validVxjsonBytes('p-b', 'B') },
      { path: 'shop/pages/c.en.vxjson', bytes: validVxjsonBytes('p-c', 'C') },
    ]);

    const summary = await idx.indexAll(backend);

    expect(summary.indexed).toBe(3);
    expect(summary.skipped).toBe(0);
    expect(idx.entryCount).toBe(3);
    expect(idx.getManifest('p-a')?.locales.en?.meta.title).toBe('A');
  });

  it('reports a page whose site is not declared instead of quietly dropping it', async () => {
    // ContentIndex.addContent has no site index to file the page under, so it
    // used to no-op: indexAll reported {indexed: 2, skipped: 0} while the page
    // was in no index — invisible to every pathname lookup and every build,
    // with nothing counting it as skipped either.
    const errors: { path: string; reason: string; message: string }[] = [];
    const idx = ContentIndex.createUncached(sitesConfig);
    const backend = fakeBackend([
      { path: 'shop/pages/ok.en.vxjson', bytes: validVxjsonBytes('p-ok', 'OK') },
      { path: 'blag/pages/typo.en.vxjson', bytes: vxjsonBytesForSite('p-typo', 'Typo', 'blag') },
    ]);

    const summary = await idx.indexAll(backend, {
      onError: (path, reason, message) => errors.push({ path, reason, message }),
    });

    expect(summary.indexed).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(errors).toHaveLength(1);
    expect(errors[0].reason).toBe('unknown-site');
    expect(errors[0].path).toBe('blag/pages/typo.en.vxjson');
    // The message must name the undeclared site, or there is nothing to act on.
    expect(errors[0].message).toContain('blag');
    expect(errors[0].message).toContain('sites.json');
  });

  it('reports two files claiming one id instead of quietly dropping a page', async () => {
    // Duplicating a page file — the obvious way to start a new one in a
    // git-backed CMS — leaves both files carrying the same id. The second to
    // be read merged into the first's locale slot, so one page stopped
    // existing for every pathname lookup, every build and every editor list,
    // while indexed++ still counted it.
    const errors: { path: string; reason: string; message: string }[] = [];
    const idx = ContentIndex.createUncached(sitesConfig);
    const backend = fakeBackend([
      { path: 'shop/pages/about.en.vxjson', bytes: validVxjsonBytes('p-about', 'About') },
      { path: 'shop/pages/about-copy.en.vxjson', bytes: validVxjsonBytes('p-about', 'About copy') },
    ]);

    const summary = await idx.indexAll(backend, {
      onError: (path, reason, message) => errors.push({ path, reason, message }),
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].reason).toBe('duplicate-id');
    expect(errors[0].path).toBe('shop/pages/about-copy.en.vxjson');
    // The message has to name the file it collided with, or there is nothing
    // to act on — both files look fine on their own.
    expect(errors[0].message).toContain('shop/pages/about.en.vxjson');
    expect(summary.indexed).toBe(1);
    expect(summary.skipped).toBe(1);
    // The first file keeps the id; the copy is not silently merged over it.
    expect(idx.getManifest('p-about')?.locales.en?.meta.title).toBe('About');
  });

  it('routes parse failures through onError without aborting the loop', async () => {
    const errors: { path: string; reason: string; message: string }[] = [];
    const idx = ContentIndex.createUncached(sitesConfig);
    const backend = fakeBackend([
      { path: 'shop/pages/ok-1.en.vxjson', bytes: validVxjsonBytes('p-ok-1', 'OK1') },
      { path: 'shop/pages/bad.en.vxjson', bytes: enc.encode('not json at all{') },
      { path: 'shop/pages/ok-2.en.vxjson', bytes: validVxjsonBytes('p-ok-2', 'OK2') },
    ]);

    const summary = await idx.indexAll(backend, {
      onError: (path, reason, message) => errors.push({ path, reason, message }),
    });

    expect(summary.indexed).toBe(2);
    expect(summary.skipped).toBe(1);
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe('shop/pages/bad.en.vxjson');
    expect(errors[0].reason).toBe('malformed-vxjson');
    expect(idx.entryCount).toBe(2);
  });

  it('reports backend {ok:false} entries through onError as skipped', async () => {
    const errors: { path: string; reason: string }[] = [];
    const idx = ContentIndex.createUncached(sitesConfig);
    const backend = errorBackend([
      { ok: true, path: 'shop/pages/a.en.vxjson', size: 50, header: validVxjsonBytes('p-1', 'A'), complete: true },
      { ok: false, path: 'shop/pages/missing.en.vxjson', reason: 'not-found', message: 'gone' },
      { ok: false, path: 'shop/pages/locked.en.vxjson', reason: 'permission-denied', message: 'EACCES' },
    ]);

    const summary = await idx.indexAll(backend, {
      onError: (path, reason) => errors.push({ path, reason }),
    });

    expect(summary.indexed).toBe(1);
    expect(summary.skipped).toBe(2);
    expect(errors.map((e) => e.reason).sort()).toEqual(['not-found', 'permission-denied']);
  });

  it('honours headerBytes opt: partial header yields parseable manifest, content deferred', async () => {
    // Large content that won't fit in a 4KB header — the hydrator must still
    // see a parseable manifest because the metadata is at the top.
    const big = VXJSON.serialize({
      id: 'p-big',
      type: 'puck',
      created: '2024-01-01T00:00:00.000Z',
      modified: '2024-01-01T00:00:00.000Z',
      meta: { title: 'Big' },
      content: { puckData: { blob: 'x'.repeat(8000) } },
    });
    const bytes = enc.encode(big);
    const idx = ContentIndex.createUncached(sitesConfig);
    const backend = fakeBackend([{ path: 'shop/pages/big.en.vxjson', bytes }]);

    const summary = await idx.indexAll(backend, { headerBytes: 4096 });

    expect(summary.indexed).toBe(1);
    expect(idx.getManifest('p-big')?.locales.en?.meta.title).toBe('Big');
  });

  it('clears the index before hydrating (idempotent)', async () => {
    const idx = ContentIndex.createUncached(sitesConfig);
    const first = fakeBackend([
      { path: 'shop/pages/a.en.vxjson', bytes: validVxjsonBytes('p-a', 'A') },
      { path: 'shop/pages/b.en.vxjson', bytes: validVxjsonBytes('p-b', 'B') },
    ]);
    await idx.indexAll(first);
    expect(idx.entryCount).toBe(2);

    const second = fakeBackend([{ path: 'shop/pages/c.en.vxjson', bytes: validVxjsonBytes('p-c', 'C') }]);
    const summary = await idx.indexAll(second);

    expect(summary.indexed).toBe(1);
    expect(idx.entryCount).toBe(1);
    expect(idx.getManifest('p-a')).toBeNull();
    expect(idx.getManifest('p-c')).toBeDefined();
  });
});

describe('listing a page the reader backend indexed', () => {
  it('never carries the unpublished marker, which only a backend with unpublished session work sets', async () => {
    const idx = ContentIndex.createUncached(sitesConfig);
    await idx.indexAll(
      fakeBackend([
        { path: 'shop/pages/a.en.vxjson', bytes: validVxjsonBytes('p-a', 'A') },
        { path: 'shop/pages/a.nl.vxjson', bytes: validVxjsonBytes('p-a', 'A') },
      ]),
    );

    const versions = Array.from(idx.listAllContent(), (manifest) => Object.values(manifest.locales)).flat();

    expect(versions).toHaveLength(2);
    for (const version of versions) expect(version).not.toHaveProperty('unpublished');
  });
});
