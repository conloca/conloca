import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { getLocks } from 'proper-lockfile/lib/lockfile.js';
import { FileSystemContentAPI, type FileSystemContentAPIOptions } from '../src/filesystem-content-api.js';
import { VersionLog } from '../src/served-versions.js';
import type { ContentData, JsonValue, LocalizedEntry, UpdateResult } from '../src/types.js';
import { ClobberStore } from '../src/utils/clobber-store.js';
import { lockPathFor, withFileLock } from '../src/utils/file-lock.js';
import { getCreatedId, must } from './test-helpers.js';
import { testTempDir } from './test-temp-dir.js';

const SITES = { sites: { example: { locales: ['en'], defaultLocale: 'en' } }, globalLocales: ['en'] };
const BLOCKS = ['a', 'b', 'c', 'd'];

interface Block {
  type: string;
  props: Record<string, JsonValue> & { id: string };
}

let dir: string;
let lockDir: string;
let opts: FileSystemContentAPIOptions;
let dev: FileSystemContentAPI;
let cli: FileSystemContentAPI;
let id: string;
let pagePath: string;
let mdxId: string;
let mdxPath: string;

function blocksOf(entry: LocalizedEntry | null): Block[] {
  return must(entry).localized.content.puckData.content;
}

/** The request content of `read` with one block prop changed, as an editor sends it. */
function withProp(read: LocalizedEntry | null, block: string, key: string, value: string): ContentData {
  return withProps(read, { [block]: value }, key);
}

function withProps(read: LocalizedEntry | null, byBlock: Record<string, string>, key = 'title'): ContentData {
  const puckData = must(read).localized.content.puckData;
  return {
    puckData: {
      ...puckData,
      content: blocksOf(read).map((b) =>
        b.props.id in byBlock ? { type: b.type, props: { ...b.props, [key]: byBlock[b.props.id] } } : b,
      ),
    },
  };
}

/** A whole page file built on `read`, with one block prop changed: what another process writes. */
function withPropText(read: LocalizedEntry | null, block: string, key: string, value: string): string {
  const file = {
    id,
    type: 'puck',
    created: must(read).localized.created,
    modified: '2026-02-02T00:00:00.000Z',
    meta: must(read).localized.meta,
    content: withProp(read, block, key, value),
  };
  return JSON.stringify(file, null, 2);
}

function titles(entry: LocalizedEntry | null): Record<string, string> {
  return Object.fromEntries(
    blocksOf(entry).flatMap((b) => (typeof b.props.title === 'string' ? [[b.props.id, b.props.title]] : [])),
  );
}

async function instance(extra: Partial<FileSystemContentAPIOptions> = {}): Promise<FileSystemContentAPI> {
  return FileSystemContentAPI.create({ ...opts, versionLog: new VersionLog(), ...extra });
}

beforeEach(async () => {
  dir = testTempDir('local-merge');
  lockDir = join(dir, '..', `${basename(dir)}-locks`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'sites.json'), JSON.stringify(SITES));
  opts = { contentRoot: dir, lockDir, lockStaleMs: 2_000 };
  const setup = await instance();
  id = getCreatedId(
    await setup.createContent({
      kind: 'page',
      site: 'example',
      collection: 'pages',
      type: 'puck',
      locales: {
        en: {
          pathname: '/about',
          meta: { title: 'About' },
          content: {
            puckData: {
              root: { props: {} },
              content: BLOCKS.map((b) => ({ type: 'Text', props: { id: b } })),
              zones: {},
            },
          },
        },
      },
    }),
  );
  mdxId = getCreatedId(
    await setup.createContent({
      kind: 'page',
      site: 'example',
      collection: 'pages',
      type: 'mdx',
      locales: { en: { pathname: '/doc', meta: { title: 'Doc' }, content: { mdx: 'one\n\ntwo\n\nthree\n' } } },
    }),
  );
  pagePath = join(dir, 'example', 'pages', 'about.en.vxjson');
  mdxPath = join(dir, 'example', 'pages', 'doc.en.mdx');
  lockViolations = [];
  missingLock.clear();
  dev = await instance({ testBeforeFinalRename: () => lockExistsBeforeRename('dev') });
  cli = await instance({ testBeforeFinalRename: () => lockExistsBeforeRename('cli') });
});

afterEach(async () => {
  FileSystemContentAPI.clearCaches();
  await rm(dir, { recursive: true, force: true });
  await rm(lockDir, { recursive: true, force: true });
});

describe('a stale local write', () => {
  it('merges edits to different blocks of one page', async () => {
    const read = await dev.getLocalized(id, 'en'); // logs the served version
    await cli.updateLocalized({
      id,
      locale: 'en',
      etag: must(read).localized.etag,
      data: { content: withProp(read, 'a', 'title', 'CLI') },
    });
    const res = await dev.updateLocalized({
      id,
      locale: 'en',
      etag: must(read).localized.etag,
      data: { content: withProp(read, 'b', 'title', 'Editor') },
    });
    expect(res.success).toBe(true);
    expect(titles(await dev.getLocalized(id, 'en'))).toEqual({ a: 'CLI', b: 'Editor' });
    expect(res.etag).toBe(must(await dev.getLocalized(id, 'en')).localized.etag);
  });

  it('refuses a same-field clash with its anchor and writes nothing', async () => {
    const read = await dev.getLocalized(id, 'en');
    await cli.updateLocalized({
      id,
      locale: 'en',
      etag: must(read).localized.etag,
      data: { content: withProp(read, 'a', 'title', 'CLI') },
    });
    const before = await readFile(pagePath, 'utf8');
    const res = await dev.updateLocalized({
      id,
      locale: 'en',
      etag: must(read).localized.etag,
      data: { content: withProp(read, 'a', 'title', 'Editor') },
    });
    expect(res).toMatchObject({
      success: false,
      reason: 'stale_write',
      conflictDetails: {
        contentChanged: true,
        conflicts: [{ anchor: 'content[id=a].props.title', ours: 'Editor', theirs: 'CLI' }],
      },
    });
    expect(await readFile(pagePath, 'utf8')).toBe(before);
    expect(titles(await dev.getLocalized(id, 'en')).a).toBe('CLI');
  });

  it('merges two MDX edits in different paragraphs', async () => {
    const read = await dev.getLocalized(mdxId, 'en');
    await cli.updateLocalized({
      id: mdxId,
      locale: 'en',
      etag: must(read).localized.etag,
      data: { content: { mdx: 'one-CLI\n\ntwo\n\nthree\n' } },
    });
    const res = await dev.updateLocalized({
      id: mdxId,
      locale: 'en',
      etag: must(read).localized.etag,
      data: { content: { mdx: 'one\n\ntwo\n\nthree-Editor\n' } },
    });
    expect(res.success).toBe(true);
    const body = (await readFile(mdxPath, 'utf8')).split('---').at(-1);
    expect(body).toContain('one-CLI');
    expect(body).toContain('three-Editor');
  });

  it('merges concurrent edits to different meta keys', async () => {
    const read = await dev.getLocalized(id, 'en');
    await cli.updateLocalized({
      id,
      locale: 'en',
      etag: must(read).localized.etag,
      data: { meta: { title: 'T-cli' } },
    });
    const res = await dev.updateLocalized({
      id,
      locale: 'en',
      etag: must(read).localized.etag,
      data: { meta: { description: 'D-editor' } },
    });
    expect(res.success).toBe(true);
    expect(must(await dev.getLocalized(id, 'en')).localized.meta).toMatchObject({
      title: 'T-cli',
      description: 'D-editor',
    });
  });

  it('answers 412 as today when the base is unknown', async () => {
    const res = await (await instance()).updateLocalized({
      id,
      locale: 'en',
      etag: 'ffff.ffff',
      data: { meta: { title: 'X' } },
    });
    expect(res).toEqual({ success: false, reason: 'stale_write', currentEtag: expect.any(String) });
  });

  it('keeps a stale rename a plain stale_write', async () => {
    const read = await dev.getLocalized(id, 'en');
    await cli.updateLocalized({
      id,
      locale: 'en',
      etag: must(read).localized.etag,
      data: { meta: { title: 'T-cli' } },
    });
    const res = await dev.updateLocalized({
      id,
      locale: 'en',
      etag: must(read).localized.etag,
      data: { pathname: '/new', meta: { description: 'D' } },
    });
    expect(res).toMatchObject({ success: false, reason: 'stale_write' });
    expect(res.conflictDetails).toBeUndefined();
  });

  it("recognises its own write and not another process's", async () => {
    const read = await dev.getLocalized(id, 'en');
    await dev.updateLocalized({ id, locale: 'en', etag: must(read).localized.etag, data: { meta: { title: 'Mine' } } });
    expect(dev.isOwnWriteFile(pagePath)).toBe(true);
    expect(cli.isOwnWriteFile(pagePath)).toBe(false);
    await writeFile(pagePath, withPropText(read, 'a', 'title', 'Other')); // another process, with its own log
    expect(dev.isOwnWriteFile(pagePath)).toBe(false);
    expect(dev.isOwnWriteFile(join(dir, 'missing.en.vxjson'))).toBe(false);
  });

  it('finds the base when the read and the write come from different create() instances', async () => {
    const read = await (await FileSystemContentAPI.create(opts)).getLocalized(id, 'en');
    await writeFile(pagePath, withPropText(read, 'a', 'title', 'CLI'));
    const res = await (await FileSystemContentAPI.create(opts)).updateLocalized({
      id,
      locale: 'en',
      etag: must(read).localized.etag,
      data: { content: withProp(read, 'b', 'title', 'Editor') },
    });
    expect(res.success).toBe(true);
    expect(titles(await dev.getLocalized(id, 'en'))).toEqual({ a: 'CLI', b: 'Editor' });
  });

  it('answers write_error and writes nothing when the merge throws', async () => {
    const log = new VersionLog();
    const read = await dev.getLocalized(id, 'en');
    log.remember(pagePath, must(read).localized.etag, '{"not": "a page"'); // the base logged for the etag is malformed
    const broken = await instance({ versionLog: log });
    await writeFile(pagePath, withPropText(read, 'a', 'title', 'CLI'));
    const before = await readFile(pagePath, 'utf8');
    const res = await broken.updateLocalized({
      id,
      locale: 'en',
      etag: must(read).localized.etag,
      data: { content: withProp(read, 'b', 'title', 'Editor') },
    });
    expect(res).toMatchObject({ success: false, reason: 'write_error' });
    expect(await readFile(pagePath, 'utf8')).toBe(before);
  });
});

describe('lost writes', () => {
  it("reports a write that was silently replaced, only on the writer's own GET", async () => {
    const read = await dev.getLocalized(id, 'en');
    const res = await dev.updateLocalized({
      id,
      locale: 'en',
      etag: must(read).localized.etag,
      data: { content: withProp(read, 'a', 'title', 'Editor') },
    });
    await writeFile(pagePath, withPropText(read, 'b', 'title', 'Thief')); // built on the pre-write version, without ours
    expect(must(await dev.getLocalized(id, 'en')).lostWrite).toBeUndefined(); // an unrelated read first
    await dev.getContent(id); // a list or index read
    expect(must(await dev.getLocalized(id, 'en', { ownWrite: res.etag })).lostWrite).toEqual({
      etag: must(res.etag),
      baseEtag: must(read).localized.etag,
    });
    expect(must(await dev.getLocalized(id, 'en', { ownWrite: res.etag })).lostWrite).toBeUndefined(); // reported once
  });

  it('does not report a write that a later write merged in', async () => {
    const read = await dev.getLocalized(id, 'en');
    const res = await dev.updateLocalized({
      id,
      locale: 'en',
      etag: must(read).localized.etag,
      data: { content: withProp(read, 'a', 'title', 'Editor') },
    });
    const ours = await dev.getLocalized(id, 'en');
    await writeFile(pagePath, withPropText(ours, 'b', 'title', 'CLI')); // keeps a=Editor, changes b
    expect(must(await dev.getLocalized(id, 'en', { ownWrite: res.etag })).lostWrite).toBeUndefined();
  });

  it('a stalled holder whose lock was taken over never renames over the new holder, which keeps its write', async () => {
    const read = await dev.getLocalized(id, 'en');
    let bRes: UpdateResult | undefined;
    const b = await instance();
    await b.getLocalized(id, 'en');
    const a = await instance({
      // A stalls past its compare; its lock is taken over and B writes. A must then refuse instead of renaming.
      testAfterLink: async () => {
        await rm(lockPathFor(pagePath, lockDir), { recursive: true });
        bRes = await b.updateLocalized({
          id,
          locale: 'en',
          etag: must(read).localized.etag,
          data: { content: withProp(read, 'b', 'title', 'B') },
        });
      },
    });
    const aRes = await a.updateLocalized({
      id,
      locale: 'en',
      etag: must(read).localized.etag,
      data: { content: withProp(read, 'a', 'title', 'A') },
    });
    expect(bRes).toMatchObject({ success: true });
    expect(aRes).toMatchObject({ success: false, reason: 'write_error' });
    const bEtag = must(bRes).etag;
    const bEntry = await b.getLocalized(id, 'en', { ownWrite: bEtag });
    expect(must(bEntry).lostWrite).toBeUndefined();
    expect(titles(bEntry).b).toBe('B');
  });

  it('refuses the next PUT with lostWrite when a stalled holder landed after the writer read', async () => {
    const read = await dev.getLocalized(id, 'en');
    const res = await dev.updateLocalized({
      id,
      locale: 'en',
      etag: must(read).localized.etag,
      data: { content: withProp(read, 'b', 'title', 'Editor') },
    });
    await dev.getLocalized(id, 'en', { ownWrite: res.etag }); // the writer's post-PUT GET, still intact
    await writeFile(pagePath, withPropText(read, 'a', 'title', 'Stalled')); // A lands later, built without b=Editor
    const next = await dev.updateLocalized({
      id,
      locale: 'en',
      etag: must(res.etag),
      data: { content: withProps(read, { b: 'Editor', c: 'More' }) },
    });
    expect(next).toMatchObject({ success: false, reason: 'stale_write', lostWrite: { etag: res.etag } });
    expect(titles(await dev.getLocalized(id, 'en'))).toEqual({ a: 'Stalled' }); // nothing written, nothing reverted
    expect(must(await dev.getLocalized(id, 'en', { ownWrite: res.etag })).lostWrite).toMatchObject({ etag: res.etag });
  });

  it("reports a lost write recorded only in another process's clobber store", async () => {
    const read = await dev.getLocalized(id, 'en');
    const res = await dev.updateLocalized({
      id,
      locale: 'en',
      etag: must(read).localized.etag,
      data: { content: withProp(read, 'a', 'title', 'Editor') },
    });
    const text = await readFile(pagePath, 'utf8');
    // Another process's holder recorded our version as clobbered; the bytes on disk alone would say it survived.
    await new ClobberStore(lockDir, dir).record({
      id,
      locale: 'en',
      filePath: pagePath,
      etag: must(res.etag),
      baseText: text,
      text,
    });
    expect(must(await dev.getLocalized(id, 'en', { ownWrite: res.etag })).lostWrite).toMatchObject({ etag: res.etag });
  });
});

/** A small seeded PRNG, so a failing run is reproducible from its printed seed. */
function rng(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 2 ** 32;
  };
}

/**
 * Seeds up to this one also draw the crash and stall actions. Each takeover waits one lock heartbeat (1 s), so the
 * default lane keeps them to 30 seeds; `nx run content-api:test-local-merge-wide` sets it to all 200, run in chunks
 * (`LOCAL_MERGE_SEEDS=first-last`) so each chunk fits the test's own time limit.
 */
const TAKEOVER_SEEDS = Number(process.env.LOCAL_MERGE_TAKEOVER_SEEDS ?? 30);
const SEED_RANGE = /^(\d+)-(\d+)$/.exec(process.env.LOCAL_MERGE_SEEDS ?? '1-200');
const [FIRST_SEED, LAST_SEED] = [Number(SEED_RANGE?.[1]), Number(SEED_RANGE?.[2])];
// A malformed value would run no seed at all and pass without testing anything.
if (!Number.isInteger(TAKEOVER_SEEDS) || TAKEOVER_SEEDS < 0) {
  throw new Error(
    `LOCAL_MERGE_TAKEOVER_SEEDS must be a whole number of seeds, not ${process.env.LOCAL_MERGE_TAKEOVER_SEEDS}`,
  );
}
if (!SEED_RANGE || FIRST_SEED < 1 || FIRST_SEED > LAST_SEED) {
  throw new Error(`LOCAL_MERGE_SEEDS must be first-last with 1 <= first <= last, not ${process.env.LOCAL_MERGE_SEEDS}`);
}

describe('the safety rule, at random', () => {
  // Real disk and real locks; a stalled holder needs whole seconds and has its own tests above and in file-lock.test.ts.
  it('never loses a confirmed or foreign field and never writes on a refusal', async () => {
    for (let seed = FIRST_SEED; seed <= LAST_SEED; seed++) {
      // oxlint-disable-next-line no-await-in-loop -- sequential by design: each seeded run owns the page in turn.
      const failure = await randomRun(seed).catch((error: Error) => error.message);
      if (failure) throw new Error(`seed ${seed}: ${failure}`);
    }
  }, 600_000);
});

let lockViolations: string[] = [];
/** The writers whose lock was missing just before their last rename. */
const missingLock = new Set<string>();

/**
 * Run by every API write right before its rename; a write that then lands without owning the lock is a violation: the
 * lock directory must be on disk with this process's current record's mtime, that record not released, and an owner
 * token beside it. Looked at once more after 5 ms, as `assertHeld` does, for a refresh caught between its two steps.
 */
async function lockExistsBeforeRename(writer: string): Promise<void> {
  const lockPath = lockPathFor(pagePath, lockDir);
  const owned = async () => {
    const record = getLocks()[resolve(pagePath)];
    if (!record || record.released) return false;
    const [dirStat] = await Promise.all([stat(lockPath), stat(`${lockPath}.owner`)]);
    return dirStat.mtime.getTime() === record.mtime.getTime();
  };
  const ok = await owned()
    .catch(() => false)
    .then(async (first) => first || (await Bun.sleep(5), await owned().catch(() => false)));
  if (!ok) missingLock.add(writer);
}

/** Another process's in-place write of one block's title, under the file's lock. */
async function rawWrite(field: string, value: string): Promise<void> {
  await withFileLock(
    pagePath,
    async () => {
      const file = JSON.parse(await readFile(pagePath, 'utf8'));
      for (const b of file.content.puckData.content) if (b.props.id === field) b.props.title = value;
      await writeFile(pagePath, JSON.stringify(file, null, 2));
    },
    { lockDir, staleMs: 2_000 },
  );
}

// oxlint-disable no-await-in-loop -- sequential by design: each step acts on the file the step before left.
async function randomRun(seed: number): Promise<string | null> {
  const next = rng(seed);
  const pick = <T>(items: T[]): T => items[Math.floor(next() * items.length)];
  const writers = [dev, cli];
  const reads = new Map<FileSystemContentAPI, LocalizedEntry | null>();
  for (const w of writers) reads.set(w, await w.getLocalized(id, 'en'));
  // The value each field must hold: the last confirmed or foreign write to it.
  const expected = new Map(Object.entries(titles(must(reads.get(dev)))));
  let lastOwner: FileSystemContentAPI | null = null;
  let counter = 0;

  const check = async (step: string): Promise<string | null> => {
    if (lockViolations.length > 0) return `${step}: ${lockViolations[0]}`;
    const onDisk = titles(await dev.getLocalized(id, 'en'));
    for (const [field, value] of expected) {
      if (onDisk[field] !== value) return `${step}: ${field} is ${onDisk[field]}, expected ${value}`;
    }
    if (lastOwner) {
      for (const w of writers) {
        if (w.isOwnWriteFile(pagePath) !== (w === lastOwner)) return `${step}: isOwnWriteFile wrong`;
      }
    }
    return null;
  };

  const apiWrite = async (w: FileSystemContentAPI, field: string, value: string) => {
    const read = must(reads.get(w));
    const writer = w === dev ? 'dev' : 'cli';
    missingLock.delete(writer);
    const res = await w.updateLocalized({
      id,
      locale: 'en',
      etag: read.localized.etag,
      data: { content: withProp(read, field, 'title', value) },
    });
    if (res.success && missingLock.has(writer)) lockViolations.push(`${writer} wrote without the lock`);
    return res;
  };

  for (let step = 0; step < 12; step++) {
    const actions = ['read', 'write', 'write', 'raw', 'pair', 'repair'];
    const action = pick(seed <= TAKEOVER_SEEDS ? [...actions, 'crash', 'stall'] : actions);
    const value = `v${seed}-${counter++}`;
    const label = `step ${step} ${action}`;
    if (action === 'read') {
      const w = pick(writers);
      reads.set(w, await w.getLocalized(id, 'en'));
    } else if (action === 'write') {
      const w = pick(writers);
      const field = pick(BLOCKS);
      const before = await readFile(pagePath, 'utf8');
      const res = await apiWrite(w, field, value);
      if (res.success) {
        expected.set(field, value);
        lastOwner = w;
      } else if ((await readFile(pagePath, 'utf8')) !== before) {
        return `${label}: a refused write changed the file`;
      }
    } else if (action === 'raw') {
      const field = pick(BLOCKS);
      await rawWrite(field, value);
      expected.set(field, value);
      lastOwner = null;
    } else if (action === 'stall') {
      // A holder stalls past staleMs after its compare (a laptop sleep); another writer takes the lock over and
      // writes. The stalled holder must then refuse, never rename over that write.
      const field = pick(BLOCKS);
      const other = pick([dev, cli, null]);
      let otherWrote = false;
      const stalled = await instance({
        testAfterLink: async () => {
          // Its refresh stopped (a laptop sleep): the lock looks older than staleMs to everyone else.
          const old = new Date(Date.now() - 5_000);
          await utimes(lockPathFor(pagePath, lockDir), old, old);
          if (other) otherWrote = (await apiWrite(other, field, `${value}o`)).success;
          else {
            await rawWrite(field, `${value}o`);
            otherWrote = true;
          }
        },
      });
      const read = await stalled.getLocalized(id, 'en');
      const res = await stalled.updateLocalized({
        id,
        locale: 'en',
        etag: must(read).localized.etag,
        data: { content: withProp(read, pick(BLOCKS), 'title', value) },
      });
      if (res.success) return `${label}: a stalled holder renamed after losing its lock`;
      if (otherWrote) {
        expected.set(field, `${value}o`);
        lastOwner = other;
      }
    } else if (action === 'pair') {
      const [f1, f2] = [pick(BLOCKS.slice(0, 2)), pick(BLOCKS.slice(2))];
      const [r1, r2] = await Promise.all([apiWrite(dev, f1, value), apiWrite(cli, f2, `${value}x`)]);
      if (r1.success) expected.set(f1, value);
      if (r2.success) expected.set(f2, `${value}x`);
      lastOwner = null; // which landed last is a race
    } else if (action === 'crash') {
      const lockPath = lockPathFor(pagePath, lockDir);
      await mkdir(lockPath, { recursive: true }); // a crashed holder's lock, older than stale
      const old = new Date(Date.now() - 5_000);
      await utimes(lockPath, old, old);
    } else {
      // A legacy-form file needs a repair on its next read; the repair keeps every field.
      const file = JSON.parse(await readFile(pagePath, 'utf8'));
      const { content, ...rest } = file;
      await withFileLock(pagePath, () => writeFile(pagePath, JSON.stringify({ content, ...rest }, null, 2)), {
        lockDir,
        staleMs: 2_000,
      });
      lastOwner = null;
      reads.set(dev, await dev.getLocalized(id, 'en'));
    }
    const failed = await check(label);
    if (failed) return failed;
  }
  return null;
}
// oxlint-enable no-await-in-loop
