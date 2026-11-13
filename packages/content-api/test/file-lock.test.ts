// Real time on purpose: these drive proper-lockfile's own mtime refresh and stale takeover on a real disk, which fake
// timers cannot reach; the short sleeps only give a waiter time to start waiting.
import { afterEach, beforeEach, describe, expect, it, setSystemTime } from 'bun:test';
import { link, mkdir, open, readdir, readFile, rename, rm, utimes, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import * as lockfile from 'proper-lockfile';
import { getLocks } from 'proper-lockfile/lib/lockfile.js';
import { FileSystemContentAPI, type FileSystemContentAPIOptions } from '../src/filesystem-content-api.js';
import type { UpdateResult, VXJSONFile } from '../src/types.js';
import { lockPathFor, sha1Hex, withFileLock } from '../src/utils/file-lock.js';
import { VXJSON } from '../src/vxjson.js';
import { getCreatedId, must } from './test-helpers.js';
import { testTempDir } from './test-temp-dir.js';

const SITES = { sites: { example: { locales: ['en'], defaultLocale: 'en' } }, globalLocales: ['en'] };
const PUCK = { puckData: { root: { props: {} }, content: [], zones: {} } };

let dir: string;
let lockDir: string;
let opts: FileSystemContentAPIOptions;
let api: FileSystemContentAPI;
let id: string;
let etag: string;
let pagePath: string;
const held: Array<() => Promise<void>> = [];

/** graceful-fs's callback `utimes`, the one proper-lockfile refreshes a lock with. */
type Utimes = (path: string, atime: Date, mtime: Date, callback: (error: Error | null) => void) => void;

function pageText(meta: Record<string, string>): string {
  const file: VXJSONFile = {
    id,
    type: 'puck',
    created: '2026-01-01T00:00:00.000Z',
    modified: '2026-01-01T00:00:00.000Z',
    meta: { title: 'T', ...meta },
    content: PUCK,
  };
  return VXJSON.serialize(file);
}

/** A page whose `content` is not its last key: every read repairs it. */
function legacyText(): string {
  return JSON.stringify(
    {
      id,
      type: 'puck',
      created: '2026-01-01T00:00:00.000Z',
      modified: '2026-01-01T00:00:00.000Z',
      content: PUCK,
      meta: { title: 'Legacy' },
    },
    null,
    2,
  );
}

function etagOfText(text: string): string {
  const result = VXJSON.calculateETags(Buffer.from(text));
  if (!result.success) throw new Error('not a canonical page');
  return `${result.metaEtag}.${result.contentEtag}`;
}

/** The etag a read serves for the legacy page: that of its repaired form. */
function legacyEtag(): string {
  const parsed = JSON.parse(legacyText());
  return etagOfText(VXJSON.serialize({ ...parsed, content: parsed.content }));
}

async function titleOnDisk(): Promise<string> {
  return JSON.parse(await readFile(pagePath, 'utf8')).meta.title;
}

function holdLock(): Promise<void> {
  return lockfile
    .lock(pagePath, { realpath: false, lockfilePath: lockPathFor(pagePath, lockDir), onCompromised: () => {} })
    .then((release) => void held.push(release));
}

beforeEach(async () => {
  dir = testTempDir('file-lock');
  lockDir = join(dir, '..', `${basename(dir)}-locks`);
  await mkdir(dir, { recursive: true });
  await mkdir(lockDir, { recursive: true });
  await writeFile(join(dir, 'sites.json'), JSON.stringify(SITES));
  opts = { contentRoot: dir, lockDir };
  api = await FileSystemContentAPI.create(opts);
  const created = await api.createContent({
    kind: 'page',
    site: 'example',
    collection: 'pages',
    type: 'puck',
    locales: { en: { pathname: '/about', meta: { title: 'About' }, content: PUCK } },
  });
  id = getCreatedId(created);
  pagePath = join(dir, 'example', 'pages', 'about.en.vxjson');
  etag = must(await api.getLocalized(id, 'en')).localized.etag;
});

afterEach(async () => {
  await Promise.all(held.splice(0).map((release) => release().catch(() => {})));
  FileSystemContentAPI.clearCaches();
  await rm(dir, { recursive: true, force: true });
  await rm(lockDir, { recursive: true, force: true });
});

describe('withFileLock', () => {
  it('serializes two writers on one file', async () => {
    const order: string[] = [];
    await Promise.all([
      withFileLock(
        pagePath,
        async () => {
          order.push('a-in');
          await Bun.sleep(30);
          order.push('a-out');
        },
        { lockDir },
      ),
      withFileLock(
        pagePath,
        async () => {
          order.push('b-in');
          order.push('b-out');
        },
        { lockDir },
      ),
    ]);
    // Either may take the lock first; neither may enter while the other holds it.
    expect([order.join(), [...order.slice(2), ...order.slice(0, 2)].join()]).toContain('a-in,a-out,b-in,b-out');
  });

  it('serialises two processes contending for one file', async () => {
    const counterPath = join(dir, 'counter.txt');
    await writeFile(counterPath, '0');
    const spawnCounter = () =>
      Bun.spawn(['bun', join(import.meta.dir, 'file-lock-counter.ts'), counterPath, lockDir], { stderr: 'inherit' });
    const [a, b] = [spawnCounter(), spawnCounter()];
    expect(await Promise.all([a.exited, b.exited])).toEqual([0, 0]);
    expect(Number(await readFile(counterPath, 'utf8'))).toBe(40);
  });

  it('keys a file the same however its path is spelled', () => {
    expect(lockPathFor(join(dir, 'x', '..', 'example', 'pages', 'new.en.vxjson'), lockDir)).toBe(
      lockPathFor(join(dir, 'example', 'pages', 'new.en.vxjson'), lockDir),
    );
  });

  it('releases its lock when a refresh is on disk but not yet recorded during the release check', async () => {
    // proper-lockfile refreshes the lock through graceful-fs. The refresh's utimes can be on disk before its callback
    // records the new mtime, and on a busy machine that callback can trail by more than a few milliseconds.
    const gracefulFs: { utimes: Utimes } = createRequire(import.meta.resolve('proper-lockfile'))('graceful-fs');
    const realUtimes = gracefulFs.utimes;
    const { promise: refreshOnDisk, resolve: refreshLanded } = Promise.withResolvers<void>();
    try {
      await withFileLock(
        pagePath,
        async () => {
          gracefulFs.utimes = (path, atime, mtime, callback) =>
            realUtimes(path, atime, mtime, (error) => {
              refreshLanded();
              // Real time: the delay has to outlast the release check's own real wait, which no fake clock drives.
              setTimeout(() => callback(error), 50);
            });
          await refreshOnDisk; // the next refresh, one heartbeat in: its callback still 50 ms away
        },
        { lockDir, staleMs: 2_000 },
      );
    } finally {
      gracefulFs.utimes = realUtimes;
    }
    // A lock left held keeps being refreshed, and every later writer times out on it.
    await withFileLock(pagePath, async () => {}, { lockDir, staleMs: 2_000, timeoutMs: 1_000 });
  });
});

describe('locked content writes', () => {
  it('waits for a lock another process holds, then writes', async () => {
    const release = await lockfile.lock(pagePath, {
      realpath: false,
      lockfilePath: lockPathFor(pagePath, lockDir),
      onCompromised: () => {},
    });
    const write = api.updateLocalized({ id, locale: 'en', etag, data: { meta: { title: 'X' } } });
    await Bun.sleep(50);
    await release();
    expect((await write).success).toBe(true);
  });

  it('takes over a stale lock', async () => {
    await mkdir(lockPathFor(pagePath, lockDir)); // a crashed holder's lock
    const old = new Date(Date.now() - 11_000);
    await utimes(lockPathFor(pagePath, lockDir), old, old);
    const writer = await FileSystemContentAPI.create({ ...opts, lockStaleMs: 2_000 }); // a takeover first waits one heartbeat
    expect((await writer.updateLocalized({ id, locale: 'en', etag, data: { meta: { title: 'X' } } })).success).toBe(
      true,
    );
  });

  it('a compromised lock turns the write into write_error with nothing written', async () => {
    const before = await readFile(pagePath, 'utf8');
    const stalled = await FileSystemContentAPI.create({
      ...opts,
      lockStaleMs: 2_000, // the library minimum, so update is 1_000
      testBeforeWrite: async () => {
        await rm(lockPathFor(pagePath, lockDir), { recursive: true });
        await Bun.sleep(1_100); // past one refresh, so onCompromised fires
      },
    });
    const res = await stalled.updateLocalized({ id, locale: 'en', etag, data: { meta: { title: 'X' } } });
    expect(res).toMatchObject({ success: false, reason: 'write_error' });
    expect(await readFile(pagePath, 'utf8')).toBe(before);
  });

  it('never creates a file inside the content root', async () => {
    await api.updateLocalized({ id, locale: 'en', etag, data: { meta: { title: 'X' } } });
    expect((await readdir(dirname(pagePath))).filter((f) => f.endsWith('.lock') || f.endsWith('.aside'))).toEqual([]);
  });

  it('refuses as write_error after the timeout and leaves the file untouched', async () => {
    await holdLock();
    const before = await readFile(pagePath, 'utf8');
    const res = await api.updateLocalized({ id, locale: 'en', etag, data: { meta: { title: 'X' } } });
    expect(res).toMatchObject({ success: false, reason: 'write_error' });
    expect(await readFile(pagePath, 'utf8')).toBe(before);
  }, 8_000);

  it('a GET repair never overwrites a newer locked write', async () => {
    await writeFile(pagePath, legacyText());
    const reached = Promise.withResolvers<void>();
    const go = Promise.withResolvers<void>();
    const reader = await FileSystemContentAPI.create({
      ...opts,
      testBeforeRepair: async () => {
        reached.resolve();
        await go.promise;
      },
    });
    const get = reader.getLocalized(id, 'en');
    await reached.promise;
    const cli = await FileSystemContentAPI.create(opts);
    const res = await cli.updateLocalized({ id, locale: 'en', etag: legacyEtag(), data: { meta: { title: 'CLI' } } });
    expect(res.success).toBe(true);
    go.resolve();
    await get;
    expect(await titleOnDisk()).toBe('CLI');
  });

  it('a write to a file that needs repair does not wait on its own lock', async () => {
    await writeFile(pagePath, legacyText());
    const t0 = Date.now();
    const res = await api.updateLocalized({ id, locale: 'en', etag: legacyEtag(), data: { meta: { title: 'X' } } });
    expect(res).toMatchObject({ success: true }); // the in-lock repair set startBytes, so step 3 sees no outside change
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(await titleOnDisk()).toBe('X');
  });

  it('a GET never blocks on a held lock and writes nothing', async () => {
    await writeFile(pagePath, legacyText());
    await holdLock();
    const t0 = Date.now();
    expect(await api.getLocalized(id, 'en')).not.toBeNull();
    expect(Date.now() - t0).toBeLessThan(500);
    expect(await readFile(pagePath, 'utf8')).toBe(legacyText());
  });

  it('a CLI write that lands before the link makes the stalled holder answer stale_write, writing nothing', async () => {
    const cli = await FileSystemContentAPI.create({ ...opts, lockStaleMs: 2_000 });
    let cliRes: UpdateResult | undefined;
    const dev = await FileSystemContentAPI.create({
      ...opts,
      lockStaleMs: 2_000,
      testBeforeRename: async () => {
        await rm(lockPathFor(pagePath, lockDir), { recursive: true });
        cliRes = await cli.updateLocalized({ id, locale: 'en', etag, data: { meta: { title: 'CLI' } } });
      },
    });
    const res = await dev.updateLocalized({ id, locale: 'en', etag, data: { meta: { title: 'Dev' } } });
    expect(cliRes).toMatchObject({ success: true });
    expect(res).toMatchObject({ success: false, reason: 'stale_write' });
    expect(must(await cli.getLocalized(id, 'en')).localized.meta).toMatchObject({ title: 'CLI' });
    expect(must(await dev.getLocalized(id, 'en', { editor: true })).clobbered).toBeUndefined();
  });

  it('records an in-place write between the link and the rename and reports it to the editor until dismissed', async () => {
    const handEdited = pageText({ title: 'Hand', description: 'By hand' });
    const dev = await FileSystemContentAPI.create({
      ...opts,
      testAfterLink: async () => {
        await writeFile(pagePath, handEdited); // in place: the same inode as the aside
      },
    });
    const res = await dev.updateLocalized({ id, locale: 'en', etag, data: { meta: { title: 'Dev' } } });
    expect(res).toMatchObject({ success: true });
    const entry = await dev.getLocalized(id, 'en', { editor: true });
    expect(must(entry).clobbered).toHaveLength(1);
    const clobberedEtag = must(must(entry).clobbered)[0].etag;
    expect(clobberedEtag).toBe(etagOfText(handEdited));
    expect(must(await dev.getClobbered(id, 'en', clobberedEtag)).saved.meta).toMatchObject({
      title: 'Hand',
      description: 'By hand',
    });
    expect(must(await dev.getLocalized(id, 'en', { editor: true })).clobbered).toHaveLength(1); // reading does not clear
    await dev.dismissClobbered(id, 'en', clobberedEtag);
    expect(must(await dev.getLocalized(id, 'en', { editor: true })).clobbered).toBeUndefined();
    expect(await dev.getClobbered(id, 'en', clobberedEtag)).toBeNull();
  });

  it('removes a leftover aside that matches its start hash, recording nothing (crash between steps 4 and 6)', async () => {
    const start = await readFile(pagePath);
    const aside = join(dirname(pagePath), `.${basename(pagePath)}.dead.${sha1Hex(start)}.aside`);
    await link(pagePath, aside); // step 3
    await writeFile(`${pagePath}.tmp`, pageText({ title: 'New' }));
    await rename(`${pagePath}.tmp`, pagePath); // step 4, then the holder crashed before step 6
    await api.updateLocalized({ id, locale: 'en', etag: 'ffff.ffff', data: { meta: { title: 'X' } } }); // takes the lock
    expect(await readdir(dirname(pagePath))).not.toContain(basename(aside));
    expect(must(await api.getLocalized(id, 'en', { editor: true })).clobbered).toBeUndefined();
  });

  it('records a leftover aside whose bytes differ from its start hash, for Restore', async () => {
    const aside = join(dirname(pagePath), `.${basename(pagePath)}.dead.${sha1Hex(Buffer.from('other start'))}.aside`);
    await writeFile(aside, pageText({ title: 'Old', description: 'Old one' })); // a write landed before the link
    await api.reindex(); // the index scan also recovers
    const entry = await api.getLocalized(id, 'en', { editor: true });
    expect(must(entry).clobbered).toHaveLength(1);
    expect(await readdir(dirname(pagePath))).not.toContain(basename(aside));
    const clobbered = await api.getClobbered(id, 'en', must(must(entry).clobbered)[0].etag);
    const { base, saved } = must(clobbered);
    expect(base).not.toEqual(saved); // baseText is the target at recovery time, so Restore has edits to bring back
    expect(saved.meta).toMatchObject({ title: 'Old', description: 'Old one' });
  });

  it.each(['EPERM', 'ENOTSUP', 'EXDEV'])('falls back to reading the bytes when link fails with %s', async (code) => {
    const noLinks = await FileSystemContentAPI.create({
      ...opts,
      testLink: () => Promise.reject(Object.assign(new Error(code), { code })),
    });
    expect((await noLinks.updateLocalized({ id, locale: 'en', etag, data: { meta: { title: 'X' } } })).success).toBe(
      true,
    );
    expect((await readdir(dirname(pagePath))).filter((f) => f.endsWith('.aside'))).toEqual([]);
    expect(await titleOnDisk()).toBe('X');
  });

  it('refuses a create whose file appeared after the existence check, overwriting nothing', async () => {
    const target = join(dir, 'example', 'pages', 'new.en.vxjson');
    const creator = await FileSystemContentAPI.create({
      ...opts,
      testAfterLink: async () => {}, // never reached: the file is already there at the link
      testBeforeRename: async () => {
        await writeFile(target, 'outside');
      },
    });
    const res = await creator.createContent({
      kind: 'page',
      site: 'example',
      collection: 'pages',
      type: 'puck',
      locales: { en: { pathname: '/new', meta: { title: 'New' }, content: PUCK } },
    });
    expect(res).toMatchObject({ success: false, reason: 'already_exists' });
    expect(await readFile(target, 'utf8')).toBe('outside');
  });

  it('a delete waits for a held lock and then removes the file', async () => {
    const release = await lockfile.lock(pagePath, {
      realpath: false,
      lockfilePath: lockPathFor(pagePath, lockDir),
      onCompromised: () => {},
    });
    const del = api.deleteContent(id, etag);
    await Bun.sleep(50);
    expect(await readdir(dirname(pagePath))).toContain(basename(pagePath));
    await release();
    expect((await del).success).toBe(true);
    expect(await readdir(dirname(pagePath))).not.toContain(basename(pagePath));
  });
});

describe('no outside write is lost silently', () => {
  it('refuses a create whose file appeared after the link, overwriting nothing', async () => {
    const target = join(dir, 'example', 'pages', 'late.en.vxjson');
    const creator = await FileSystemContentAPI.create({
      ...opts,
      testAfterLink: async () => {
        await writeFile(target, 'outside');
      },
    });
    const res = await creator.createContent({
      kind: 'page',
      site: 'example',
      collection: 'pages',
      type: 'puck',
      locales: { en: { pathname: '/late', meta: { title: 'Late' }, content: PUCK } },
    });
    expect(res).toMatchObject({ success: false, reason: 'already_exists' });
    expect(await readFile(target, 'utf8')).toBe('outside');
  });

  it("keeps an outside edit to a move's old file as a clobber instead of deleting it unseen", async () => {
    const mover = await FileSystemContentAPI.create({
      ...opts,
      testAfterLink: async () => {
        await writeFile(pagePath, pageText({ description: 'Outside' })); // in place, into the old path
      },
    });
    const res = await mover.updateLocalized({ id, locale: 'en', etag, data: { pathname: '/moved' } });
    expect(res.success).toBe(true);
    const clobbered = must(must(await mover.getLocalized(id, 'en', { editor: true })).clobbered);
    expect(clobbered).toHaveLength(1);
    expect(must(await mover.getClobbered(id, 'en', clobbered[0].etag)).saved.meta).toMatchObject({
      description: 'Outside',
    });
  });

  it('refuses to delete a file an outside writer changed since the index read it', async () => {
    await writeFile(pagePath, pageText({ title: 'Outside' })); // before the watcher reindexes
    const res = await api.deleteContent(id, etag);
    expect(res).toMatchObject({ success: false, reason: 'stale_write' });
    expect(await titleOnDisk()).toBe('Outside');
  });

  it('keeps a file an outside writer changed while the delete held its lock', async () => {
    const deleter = await FileSystemContentAPI.create({
      ...opts,
      testAfterLink: async () => {
        await writeFile(pagePath, pageText({ title: 'Outside' }));
      },
    });
    const res = await deleter.deleteContent(id, etag);
    expect(res.success).toBe(false);
    expect(await titleOnDisk()).toBe('Outside');
  });

  it('refuses to delete a translation an outside writer changed since the index read it', async () => {
    await writeFile(
      join(dir, 'sites.json'),
      JSON.stringify({
        sites: { example: { locales: ['en', 'de'], defaultLocale: 'en' } },
        globalLocales: ['en', 'de'],
      }),
    );
    FileSystemContentAPI.clearCaches();
    const two = await FileSystemContentAPI.create(opts);
    const twoId = getCreatedId(
      await two.createContent({
        kind: 'page',
        site: 'example',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: { pathname: '/two', meta: { title: 'Two' }, content: PUCK },
          de: { pathname: '/zwei', meta: { title: 'Zwei' }, content: PUCK },
        },
      }),
    );
    const deEtag = must(await two.getLocalized(twoId, 'de')).localized.etag;
    const dePath = join(dir, 'example', 'pages', 'zwei.de.vxjson');
    const outside = (await readFile(dePath, 'utf8')).replace('Zwei', 'Draussen');
    await writeFile(dePath, outside);
    const res = await two.deleteLocalized({ id: twoId, locale: 'de', etag: deEtag });
    expect(res).toMatchObject({ success: false, reason: 'stale_write' });
    expect(await readFile(dePath, 'utf8')).toBe(outside);
  });

  it('releases a lock it still owns after a stall past staleMs, so the file is not wedged', async () => {
    const lockPath = lockPathFor(pagePath, lockDir);
    try {
      await withFileLock(
        pagePath,
        async () => {
          setSystemTime(new Date(Date.now() + 5_000)); // a laptop sleep: nobody took the lock over
        },
        { lockDir, staleMs: 2_000 },
      );
    } finally {
      setSystemTime();
    }
    expect(await readdir(lockDir)).not.toContain(basename(lockPath));
  });
});

describe('the model actions', () => {
  it('an index-scan repair racing a CLI write leaves the CLI write', async () => {
    await writeFile(pagePath, legacyText());
    let armed = false;
    const scanner = await FileSystemContentAPI.create({
      ...opts,
      testBeforeRepair: async () => {
        if (!armed) return;
        armed = false; // the CLI lands between the scan's read and its repair
        const res = await api.updateLocalized({
          id,
          locale: 'en',
          etag: legacyEtag(),
          data: { meta: { title: 'CLI' } },
        });
        expect(res.success).toBe(true);
      },
    });
    armed = true;
    await scanner.reindex([pagePath]);
    expect(armed).toBe(false); // the scan reached its repair
    expect(await titleOnDisk()).toBe('CLI');
  });

  it('records the whole version an outside writer was still writing into the aside, not a torn one', async () => {
    const whole = Buffer.from(pageText({ title: 'Hand', description: 'Written in pieces' }));
    let writing: Promise<void> = Promise.resolve();
    const dev = await FileSystemContentAPI.create({
      ...opts,
      testAfterLink: async () => {
        // An editor holding the old inode open writes it in pieces, still going after the rename.
        const handle = await open(pagePath, 'r+');
        writing = (async () => {
          for (let piece = 1; piece <= 4; piece++) {
            // oxlint-disable-next-line no-await-in-loop -- the pieces land one after another, as a slow writer's do.
            await handle.write(whole, 0, Math.ceil((whole.length * piece) / 4), 0);
            // oxlint-disable-next-line no-await-in-loop -- as above.
            await Bun.sleep(2);
          }
          await handle.truncate(whole.length);
          await handle.close();
        })();
      },
    });
    const res = await dev.updateLocalized({ id, locale: 'en', etag, data: { meta: { title: 'Dev' } } });
    await writing;
    expect(res.success).toBe(true);
    const clobbered = must(must(await dev.getLocalized(id, 'en', { editor: true })).clobbered);
    expect(clobbered.map((c) => c.etag)).toContain(etagOfText(whole.toString()));
  });

  it('two writers that find one crashed holder take its lock one at a time and lose neither write', async () => {
    const lockPath = lockPathFor(pagePath, lockDir);
    await mkdir(lockPath);
    const old = new Date(Date.now() - 11_000);
    await utimes(lockPath, old, old);
    const dev = await FileSystemContentAPI.create({ ...opts, lockStaleMs: 2_000 }); // a takeover waits one heartbeat
    const cli = await FileSystemContentAPI.create({ ...opts, lockStaleMs: 2_000 });
    const [a, b] = await Promise.all([
      dev.updateLocalized({ id, locale: 'en', etag, data: { meta: { title: 'A' } } }),
      cli.updateLocalized({ id, locale: 'en', etag, data: { meta: { description: 'B' } } }),
    ]);
    const meta = JSON.parse(await readFile(pagePath, 'utf8')).meta;
    if (a.success) expect(meta.title).toBe('A');
    if (b.success) expect(meta.description).toBe('B');
    expect(a.success || b.success).toBe(true);
  });
});

describe('a takeover within one process', () => {
  it("stops the stalled holder's refresh, which would otherwise drive or crash on the new holder's lock", async () => {
    const key = resolve(pagePath);
    try {
      await withFileLock(
        pagePath,
        async () => {
          const stalledRecord = getLocks()[key];
          setSystemTime(new Date(Date.now() + 5_000)); // a laptop sleep; a second request then takes the lock over
          await withFileLock(
            pagePath,
            async (taken) => {
              expect(stalledRecord.released).toBe(true);
              await taken.assertHeld();
            },
            { lockDir, staleMs: 2_000, wait: false }, // takes the stale lock at once: no retries, no heartbeat wait
          );
        },
        { lockDir, staleMs: 2_000 },
      );
    } finally {
      setSystemTime();
    }
  });
});

/** The page as the other process writes it. */
function bText(): string {
  return pageText({ title: 'B', description: 'from the other process' });
}

describe('a holder whose lock another process took over', () => {
  const B_TEXT = bText;

  /**
   * The stalled holder's lock looks dead; another process takes it over and writes B. Synchronous on purpose: the
   * holder really is stalled (its event loop blocked) while B runs, and `bun test --timeout=0`'s sweep of the previous
   * test's processes, which runs late, has been seen to kill a child spawned asynchronously here.
   */
  async function otherProcessTakesOver(collideMs?: number): Promise<void> {
    const old = new Date(Date.now() - 5_000);
    await utimes(lockPathFor(pagePath, lockDir), old, old);
    const args = [join(import.meta.dir, 'file-lock-takeover-writer.ts'), pagePath, lockDir, B_TEXT()];
    const child = Bun.spawnSync(['bun', ...args, ...(collideMs === undefined ? [] : [String(collideMs)])], {
      stderr: 'inherit',
    });
    expect(child.exitCode).toBe(0);
  }

  async function stalledWrite(hook: keyof FileSystemContentAPIOptions, collide = false): Promise<UpdateResult> {
    const a = await FileSystemContentAPI.create({
      ...opts,
      lockStaleMs: 2_000,
      [hook]: () => otherProcessTakesOver(collide ? getLocks()[resolve(pagePath)].mtime.getTime() : undefined),
    });
    return a.updateLocalized({ id, locale: 'en', etag, data: { meta: { title: 'A' } } });
  }

  it('refuses with stale_write when the takeover lands before its compare, keeping the other write', async () => {
    expect(await stalledWrite('testBeforeRename')).toMatchObject({ success: false, reason: 'stale_write' });
    expect(await readFile(pagePath, 'utf8')).toBe(B_TEXT());
  });

  it('refuses with write_error when the takeover lands after its compare, keeping the other write', async () => {
    expect(await stalledWrite('testAfterLink')).toMatchObject({ success: false, reason: 'write_error' });
    expect(await readFile(pagePath, 'utf8')).toBe(B_TEXT());
  });

  it('tells two holders apart by their owner token when their lock mtimes collide', async () => {
    expect(await stalledWrite('testAfterLink', true)).toMatchObject({ success: false, reason: 'write_error' });
    expect(await readFile(pagePath, 'utf8')).toBe(B_TEXT());
  });

  it('keeps the write a takeover landed after its last check as a clobber, and answers write_error', async () => {
    const res = await stalledWrite('testBeforeFinalLink');
    expect(res).toMatchObject({ success: false, reason: 'write_error' });
    const clobbered = must(must(await api.getLocalized(id, 'en', { editor: true })).clobbered);
    expect(clobbered.map((c) => c.etag)).toContain(etagOfText(B_TEXT()));
  });

  it('known limit: a write landing between the last link and the rename is lost, and its writer is told', async () => {
    // shortcut: Node has no atomic exchange; this window is accepted, and the lost writer learns of it itself.
    const b = await FileSystemContentAPI.create({ ...opts, lockStaleMs: 2_000 });
    let bEtag: string | undefined;
    const a = await FileSystemContentAPI.create({
      ...opts,
      lockStaleMs: 2_000,
      testBeforeFinalRename: async () => {
        const old = new Date(Date.now() - 5_000);
        await utimes(lockPathFor(pagePath, lockDir), old, old);
        const bRes = await b.updateLocalized({ id, locale: 'en', etag, data: { meta: { description: 'B' } } });
        expect(bRes.success).toBe(true);
        bEtag = bRes.etag;
      },
    });
    const res = await a.updateLocalized({ id, locale: 'en', etag, data: { meta: { title: 'A' } } });
    expect(res).toMatchObject({ success: false, reason: 'write_error' });
    expect(JSON.parse(await readFile(pagePath, 'utf8')).meta.description).toBeUndefined(); // B's change is gone
    const bEntry = await b.getLocalized(id, 'en', { ownWrite: must(bEtag) });
    expect(must(bEntry).lostWrite).toMatchObject({ etag: bEtag });
  });

  it('a lock directory recreated with its mtime but another owner is not held', async () => {
    const lockPath = lockPathFor(pagePath, lockDir);
    await withFileLock(
      pagePath,
      async (ours) => {
        const { mtime } = getLocks()[resolve(pagePath)];
        await rm(lockPath, { recursive: true });
        await mkdir(lockPath);
        await utimes(lockPath, mtime, mtime);
        await writeFile(`${lockPath}.owner`, 'someone else');
        await expect(ours.assertHeld()).rejects.toThrow();
      },
      { lockDir },
    );
  });
});

describe('the lock key', () => {
  it('is the same for a file while its writer replaces it, so two writers never lock different keys', async () => {
    const expected = lockPathFor(pagePath, lockDir);
    const seen = new Set<string>();
    const state = { replacing: true };
    const replacer = (async () => {
      for (let round = 0; round < 200; round++) {
        // oxlint-disable-next-line no-await-in-loop -- one rename after another, as consecutive writes do.
        await writeFile(`${pagePath}.tmp`, pageText({ title: `R${round}` }));
        // oxlint-disable-next-line no-await-in-loop -- as above.
        await rename(`${pagePath}.tmp`, pagePath);
      }
      state.replacing = false;
    })();
    while (state.replacing) {
      seen.add(lockPathFor(pagePath, lockDir));
      // oxlint-disable-next-line no-await-in-loop -- yields to the replacer's I/O between samples.
      await Bun.sleep(0);
    }
    await replacer;
    expect([...seen]).toEqual([expected]);
  });
});
