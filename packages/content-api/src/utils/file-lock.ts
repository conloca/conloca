import { createHash, randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { link, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { lock as acquire } from 'proper-lockfile';
import { getLocks, type LockRecord } from 'proper-lockfile/lib/lockfile.js';
import { atomicWriteFile } from './atomic-write.js';

/** The lock could not be taken within the timeout (or at once, without waiting). */
export class FileLockTimeoutError extends Error {
  constructor(filePath: string) {
    super(`Timed out waiting for the lock on ${filePath}`);
    this.name = 'FileLockTimeoutError';
  }
}

/** The lock was taken over or went stale while held; a write under it may have raced another writer. */
export class FileLockLostError extends Error {
  constructor(filePath: string) {
    super(`Lost the lock on ${filePath}`);
    this.name = 'FileLockLostError';
  }
}

export interface HeldLock {
  /** Throws {@link FileLockLostError} unless this holder still owns every lock it took. */
  assertHeld(): Promise<void>;
}

export interface FileLockOptions {
  timeoutMs?: number;
  staleMs?: number;
  lockDir?: string;
  wait?: boolean;
}

/** Test-only seams around a guarded write; production passes none. */
export interface WriteTestHooks {
  /** Inside the lock, before the pre-rename check. */
  testBeforeWrite?: () => Promise<void>;
  /** Between the pre-rename check and the link aside. */
  testBeforeRename?: () => Promise<void>;
  /** Between the link aside and the compare-checked rename's last `assertHeld`. */
  testAfterLink?: () => Promise<void>;
  /** Between the last `assertHeld` and the link of the target about to be replaced. */
  testBeforeFinalLink?: () => Promise<void>;
  /** Between that link and the rename: the known window no check covers. */
  testBeforeFinalRename?: () => Promise<void>;
  /** Replaces the link call, to simulate a disk without hard links. */
  testLink?: (existingPath: string, newPath: string) => Promise<void>;
}

const CASE_INSENSITIVE = process.platform === 'darwin' || process.platform === 'win32';

function sha1Hex(data: string | Uint8Array): string {
  return createHash('sha1').update(data).digest('hex');
}

function codeOf(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}

// shortcut: a shell that overrides HOME gets its own lock dir and does not serialise with the others; upgrade to a
// per-project lock dir if that ever matters.
export function defaultLockDir(): string {
  return join(homedir(), '.cache', 'conloca', 'locks');
}

/**
 * One key per file however it is named: the real path of the nearest existing ancestor directory plus the rest, so a
 * file that does not exist yet still gets one, lower-cased where the disk ignores case. The file itself is never
 * resolved: every write replaces it, and a key must not depend on catching it mid-replace. Only absence walks up;
 * any other error is thrown, as a guessed key would let two writers lock different keys for one file.
 */
export function canonicalPath(filePath: string): string {
  const absolute = resolve(filePath);
  let head = dirname(absolute);
  const rest = [basename(absolute)];
  for (;;) {
    try {
      const key = join(realpathSync.native(head), ...rest);
      return CASE_INSENSITIVE ? key.toLowerCase() : key;
    } catch (error) {
      const code = codeOf(error);
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
      const up = dirname(head);
      if (up === head) return CASE_INSENSITIVE ? absolute.toLowerCase() : absolute;
      rest.unshift(basename(head));
      head = up;
    }
  }
}

/** Outside the content tree, so a crashed holder never leaves a lock the watcher sees or someone commits. */
export function lockPathFor(filePath: string, lockDir = defaultLockDir()): string {
  return join(lockDir, `${sha1Hex(canonicalPath(filePath))}.lock`);
}

/** The lock record each file's current holder in this process took, so a takeover can stop the one it replaced. */
const liveRecords = new Map<string, LockRecord>();

/** Runs `fn` while holding the lock on `filePath`, shared with every process that uses the same lock dir. */
export async function withFileLock<T>(
  filePath: string,
  fn: (lock: HeldLock) => Promise<T>,
  opts: FileLockOptions = {},
): Promise<T> {
  const { timeoutMs = 5_000, staleMs = 10_000, lockDir = defaultLockDir(), wait = true } = opts;
  const lockPath = lockPathFor(filePath, lockDir);
  const ownerPath = `${lockPath}.owner`;
  const heartbeatMs = Math.max(1_000, Math.floor(staleMs / 3));
  await mkdir(lockDir, { recursive: true });
  if (wait) await waitOutStaleLock(lockPath, staleMs, heartbeatMs);
  let compromised = false;
  let release: () => Promise<void>;
  try {
    release = await acquire(filePath, {
      realpath: false,
      lockfilePath: lockPath,
      stale: staleMs,
      update: heartbeatMs,
      retries: wait ? { retries: 1_000, minTimeout: 25, maxTimeout: 250, maxRetryTime: timeoutMs } : 0,
      // The library's default throws, an uncaught error in the dev server or the CLI.
      onCompromised: () => {
        compromised = true;
      },
    });
  } catch (error) {
    if (codeOf(error) === 'ELOCKED') throw new FileLockTimeoutError(filePath);
    throw error;
  }
  const key = resolve(filePath);
  const captured = getLocks()[key];
  // Taken over within this process (a holder stalled past staleMs): the old record's refresh timer would look up the
  // file's entry, now ours, and drive or crash on it. Stop it as the library does for a released lock.
  const superseded = liveRecords.get(key);
  if (superseded && superseded !== captured) {
    superseded.released = true;
    clearTimeout(superseded.updateTimeout ?? undefined);
    superseded.updateTimeout = null;
  }
  if (captured) liveRecords.set(key, captured);
  // Beside the lock directory, not in it: the library removes the directory with rmdir and compares its mtime. Two
  // contenders that both took over one stale lock in the same millisecond share that mtime; the token tells them apart.
  const token = randomBytes(12).toString('hex');
  // One 24-byte write, which a reader sees whole in practice; a torn read would only mismatch, a refusal and no loss.
  // Not a content write, so it does not go through atomicWriteFile and its temp file.
  await writeFile(ownerPath, token).catch(async (error: Error) => {
    await release().catch(() => {});
    throw error;
  });
  const ownsLock = async () =>
    (await stat(lockPath)).mtime.getTime() === captured.mtime.getTime() &&
    (await readFile(ownerPath, 'utf8')) === token;
  /** Ours on disk, looking once more after a refresh that has touched the lock but not yet stored its mtime settles. */
  const stillOwned = async () => {
    try {
      if (await ownsLock()) return true;
      await refreshSettled(captured, staleMs);
      return getLocks()[key] === captured && (await ownsLock());
    } catch {
      return false;
    }
  };
  const held: HeldLock = {
    assertHeld: async () => {
      if (compromised || !captured || getLocks()[key] !== captured || Date.now() - captured.lastUpdate >= staleMs) {
        throw new FileLockLostError(filePath);
      }
      if (!(await stillOwned())) throw new FileLockLostError(filePath);
    },
  };
  try {
    return await fn(held);
  } finally {
    // Releasing a lock someone took over would remove theirs; a lock still ours is released however long we stalled,
    // or nobody could write the file until a restart.
    const ours = !compromised && captured !== undefined && getLocks()[key] === captured && (await stillOwned());
    if (ours) {
      await unlinkQuiet(ownerPath);
      await release().catch(() => {});
    }
    if (liveRecords.get(key) === captured) liveRecords.delete(key);
  }
}

/**
 * Before taking over a lock that looks stale, waits one heartbeat: a holder that only slept refreshes it meanwhile, and
 * the library's own stale check, run next, then finds it fresh and waits instead of claiming.
 */
async function waitOutStaleLock(lockPath: string, staleMs: number, heartbeatMs: number): Promise<void> {
  const seen = await stat(lockPath).catch(() => null);
  if (seen && Date.now() - seen.mtimeMs >= staleMs) await sleep(heartbeatMs);
}

/**
 * Waits while `record`'s refresh is in flight: its timer has fired and not yet rescheduled. The refresh's utimes can
 * be on disk well before its callback stores the new mtime, so an ownership check in between would read our own lock
 * as someone else's and leave it held, refreshed forever. Bounded by `staleMs`: past it the lock counts as lost anyway.
 */
async function refreshSettled(record: LockRecord, staleMs: number): Promise<void> {
  const deadline = Date.now() + staleMs;
  // oxlint-disable-next-line no-await-in-loop -- polls the library's own record; it signals nothing when it settles.
  while (!record.released && record.updateTimeout === null && Date.now() < deadline) await sleep(1);
}

/**
 * Holds the locks of every path at once, taken in lock-path order so two writers never deadlock; paths that share a
 * lock take it once.
 */
export async function withFileLocks<T>(
  filePaths: string[],
  fn: (lock: HeldLock) => Promise<T>,
  opts: FileLockOptions = {},
): Promise<T> {
  const lockDir = opts.lockDir ?? defaultLockDir();
  const byLock = new Map(filePaths.map((filePath) => [lockPathFor(filePath, lockDir), filePath]));
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy; this package's lib target has no toSorted.
  const ordered = [...byLock.keys()].sort().map((lockPath) => byLock.get(lockPath) ?? lockPath);
  const take = (index: number, held: HeldLock[]): Promise<T> =>
    index === ordered.length
      ? fn({ assertHeld: async () => void (await Promise.all(held.map((h) => h.assertHeld()))) })
      : withFileLock(ordered[index], (h) => take(index + 1, [...held, h]), { ...opts, lockDir });
  return take(0, []);
}

async function readOrNull(filePath: string): Promise<Uint8Array | null> {
  try {
    return await readFile(filePath);
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return null;
    throw error;
  }
}

function sameBytes(a: Uint8Array | null, b: Uint8Array | null): boolean {
  return a === null || b === null ? a === b : Buffer.compare(a, b) === 0;
}

/** Reads until two reads agree, so an outside writer caught mid-write is not taken for its finished bytes. */
async function settledRead(filePath: string): Promise<Uint8Array | null> {
  let last = await readOrNull(filePath);
  for (let tries = 0; tries < 10; tries++) {
    // oxlint-disable-next-line no-await-in-loop -- sequential by design: each read is compared with the one before.
    await sleep(10);
    // oxlint-disable-next-line no-await-in-loop -- as above.
    const next = await readOrNull(filePath);
    if (sameBytes(next, last)) return next;
    last = next;
  }
  return last;
}

async function unlinkQuiet(filePath: string): Promise<void> {
  await unlink(filePath).catch(() => {});
}

export type GuardedWriteResult = { kind: 'written' } | { kind: 'changed'; bytes: Uint8Array | null };

/** Where `target` is set aside while a write or remove settles; the name carries the start bytes' hash for recovery. */
function asidePath(target: string, startBytes: Uint8Array | null): string {
  return join(
    dirname(target),
    `.${basename(target)}.${randomBytes(6).toString('hex')}.${sha1Hex(startBytes ?? new Uint8Array())}.aside`,
  );
}

/** Creates `target` only if no file is there: a hard link of a finished temp file, so it never replaces one. */
async function createExclusive(
  lock: HeldLock,
  target: string,
  text: string,
  hooks: WriteTestHooks | undefined,
): Promise<GuardedWriteResult> {
  const temp = join(dirname(target), `.${basename(target)}.${randomBytes(6).toString('hex')}.create`);
  try {
    // Whole before it is linked into place, so a crash never leaves a partial file at `target`.
    await atomicWriteFile(temp, text);
    await hooks?.testAfterLink?.();
    await lock.assertHeld();
    try {
      await (hooks?.testLink ?? link)(temp, target);
    } catch (error) {
      if (codeOf(error) === 'EEXIST') return { kind: 'changed', bytes: await readOrNull(target) };
      // A disk without hard links: an exclusive open still never replaces a file, though a reader may see it partial.
      const opened = await writeFile(target, text, { flag: 'wx' }).then(
        () => true,
        (openError: Error) => {
          if (codeOf(openError) === 'EEXIST') return false;
          throw openError;
        },
      );
      if (!opened) return { kind: 'changed', bytes: await readOrNull(target) };
    }
    return { kind: 'written' };
  } finally {
    await unlinkQuiet(temp);
  }
}

/**
 * Replaces `target` with `text` under a held lock, only if it still holds `startBytes` (null: absent). The old file is
 * hard-linked aside first, so bytes another writer put there in the meantime are handed to `onClobber` rather than
 * lost.
 *
 * shortcut: no atomic exchange in Node; a write landing between the link and the final rename is lost unreported
 * unless its writer checks itself
 */
export async function guardedWrite(args: {
  lock: HeldLock;
  target: string;
  text: string;
  startBytes: Uint8Array | null;
  hooks?: WriteTestHooks;
  onClobber: (clobbered: Uint8Array) => Promise<void>;
}): Promise<GuardedWriteResult> {
  const { lock, target, text, startBytes, hooks, onClobber } = args;
  await hooks?.testBeforeWrite?.();
  await lock.assertHeld();
  await hooks?.testBeforeRename?.();
  if (startBytes === null) return createExclusive(lock, target, text, hooks);
  const aside = asidePath(target, startBytes);
  let linked = false;
  try {
    await (hooks?.testLink ?? link)(target, aside);
    linked = true;
  } catch {
    // A disk without hard links: only crash recovery is lost.
  }
  try {
    const seen = await readOrNull(linked ? aside : target);
    if (!sameBytes(seen, startBytes)) return { kind: 'changed', bytes: seen };
    await hooks?.testAfterLink?.();
    // A holder that stalled past staleMs since the compare may have been taken over: it must not rename.
    await lock.assertHeld();
    await hooks?.testBeforeFinalLink?.();
    // The target as it is now, kept: a new holder's write that landed since the check is in it, not lost by our rename.
    // shortcut: a write landing between this link and the rename is still lost (Node has no atomic exchange); its
    // writer learns of it through its own-write check.
    const replaced = asidePath(target, startBytes);
    const replacedLinked = await (hooks?.testLink ?? link)(target, replaced).then(
      () => true,
      () => false,
    );
    const replacedInMemory = replacedLinked ? null : await readOrNull(target);
    await hooks?.testBeforeFinalRename?.();
    try {
      await atomicWriteFile(target, text);
      const lost = await lock.assertHeld().then(
        () => false,
        () => true,
      );
      // A null re-read: another holder's recovery removed the aside, which then held the start bytes.
      const reread = replacedLinked ? await readOrNull(replaced) : replacedInMemory;
      const overwritten =
        reread === null
          ? seen
          : sameBytes(reread, startBytes) || !replacedLinked
            ? reread
            : await settledRead(replaced);
      if (overwritten !== null && (lost || !sameBytes(overwritten, startBytes))) await onClobber(overwritten);
      if (lost) throw new FileLockLostError(target);
      return { kind: 'written' };
    } finally {
      if (replacedLinked) await unlinkQuiet(replaced);
    }
  } finally {
    if (linked) await unlinkQuiet(aside);
  }
}

export type GuardedRemoveResult = { kind: 'removed' } | { kind: 'changed'; bytes: Uint8Array };

/**
 * Removes `target` under a held lock only if it still holds `startBytes`. It is renamed aside first, so exactly the
 * removed bytes are compared. A changed file is put back when `restore` (a refused delete), and is otherwise, or when
 * the path was taken meanwhile, handed to `onClobber`: never removed unseen.
 */
export async function guardedRemove(args: {
  lock: HeldLock;
  target: string;
  startBytes: Uint8Array;
  restore: boolean;
  hooks?: WriteTestHooks;
  onClobber: (clobbered: Uint8Array) => Promise<void>;
}): Promise<GuardedRemoveResult> {
  const { lock, target, startBytes, restore, hooks, onClobber } = args;
  await lock.assertHeld();
  await hooks?.testAfterLink?.();
  const aside = asidePath(target, startBytes);
  try {
    await rename(target, aside);
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return { kind: 'removed' };
    throw error;
  }
  try {
    const removed = await settledRead(aside);
    if (removed === null || sameBytes(removed, startBytes)) return { kind: 'removed' };
    const putBack =
      restore &&
      (await link(aside, target).then(
        () => true,
        () => false,
      ));
    if (!putBack) await onClobber(removed);
    return restore ? { kind: 'changed', bytes: removed } : { kind: 'removed' };
  } finally {
    await unlinkQuiet(aside);
  }
}

/**
 * Settles the `.aside` files a crashed holder left beside `target`: one still holding the start bytes its name hashes
 * is dropped, any other is handed to `onClobber` with the target's current bytes, then dropped. Call under the lock.
 */
export async function recoverAsides(
  target: string,
  onClobber: (aside: Uint8Array, current: Uint8Array | null) => Promise<void>,
  names?: string[],
): Promise<void> {
  const dir = dirname(target);
  const prefix = `.${basename(target)}.`;
  const entries = names ?? (await readdir(dir).catch(() => []));
  const leftovers = entries.flatMap((name) => {
    if (!name.startsWith(prefix) || !name.endsWith('.aside')) return [];
    const parts = name.slice(prefix.length, -'.aside'.length).split('.');
    return parts.length === 2 ? [{ path: join(dir, name), hash: parts[1] }] : [];
  });
  await Promise.all(
    leftovers.map(async ({ path, hash }) => {
      const bytes = await readOrNull(path);
      if (bytes === null) return;
      if (sha1Hex(bytes) !== hash) await onClobber(bytes, await readOrNull(target));
      await unlinkQuiet(path);
    }),
  );
}

/** The target each leftover aside in `names` belongs to, so a scan settles only files that have one. */
export function asideTargets(dir: string, names: string[]): Set<string> {
  const targets = new Set<string>();
  for (const name of names) {
    const match = /^\.(.+)\.[0-9a-f]+\.[0-9a-f]{40}\.aside$/.exec(name);
    if (match) targets.add(join(dir, match[1]));
  }
  return targets;
}

export { readOrNull, sameBytes, sha1Hex };
