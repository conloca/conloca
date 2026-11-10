import { valueAtAnchor } from './merge/apply.js';
import { deepEqual } from './merge/record.js';
import type { Field, MergeKind } from './merge/types.js';
import type { JsonValue } from './types.js';
import { sha1Hex } from './utils/file-lock.js';

export const VERSION_LOG_PER_FILE = 20;
export const VERSION_LOG_FILES = 500;
export const VERSION_LOG_BYTES = 64 * 1024 * 1024;

interface OwnWrite {
  etag: string;
  hash: string;
  baseEtag: string;
  values: Record<string, Field>;
}

interface FileLog {
  /** Etag → text, oldest first. */
  versions: Map<string, string>;
  own?: OwnWrite;
  /** The file's absence is this process's own delete. */
  ownDelete?: boolean;
  clobbered: Set<string>;
}

/** Parses a logged or on-disk file text the way the merge engine takes it: MDX as text, JSON parsed. */
export function mergeInputOf(kind: MergeKind, text: string): JsonValue {
  return kind === 'mdx' ? text : JSON.parse(text);
}

/**
 * The texts this process served and wrote per file, so a stale write can be merged against the version its writer
 * read, plus the last own write per file, so a write that was silently replaced is reported to its writer.
 *
 * shortcut: in-process only, a dev-server restart forgets bases and the next stale write answers 412 as today. A
 * foreign write whose bytes equal our last own write counts as own; its reload is dropped, which is harmless because
 * the content is the same.
 */
export class VersionLog {
  private readonly files = new Map<string, FileLog>();
  private bytes = 0;

  private entry(filePath: string): FileLog {
    const found = this.files.get(filePath);
    if (found) {
      // Most recently used last, so eviction drops the oldest file first.
      this.files.delete(filePath);
      this.files.set(filePath, found);
      return found;
    }
    const created: FileLog = { versions: new Map(), clobbered: new Set() };
    this.files.set(filePath, created);
    return created;
  }

  remember(filePath: string, etag: string, text: string): void {
    const { versions } = this.entry(filePath);
    const known = versions.get(etag);
    versions.delete(etag);
    versions.set(etag, known ?? text);
    if (known !== undefined) return;
    this.bytes += text.length;
    for (const [oldest, oldText] of versions) {
      if (versions.size <= VERSION_LOG_PER_FILE) break;
      versions.delete(oldest);
      this.bytes -= oldText.length;
    }
    for (const [path, log] of this.files) {
      if (this.files.size <= VERSION_LOG_FILES && this.bytes <= VERSION_LOG_BYTES) break;
      if (path === filePath) continue;
      this.files.delete(path);
      for (const old of log.versions.values()) this.bytes -= old.length;
    }
  }

  get(filePath: string, etag: string): string | undefined {
    return this.files.get(filePath)?.versions.get(etag);
  }

  markOwnWrite(filePath: string, write: OwnWrite): void {
    const log = this.entry(filePath);
    log.own = write;
    log.ownDelete = false;
  }

  /** Records that this process deleted the file, so the watcher's unlink event counts as own. */
  markOwnDelete(filePath: string): void {
    const log = this.entry(filePath);
    log.own = undefined;
    log.ownDelete = true;
  }

  /** Whether the file's absence is our own delete; `present` disarms it, as a file appeared since. */
  isOwnDelete(filePath: string, present: boolean): boolean {
    const log = this.files.get(filePath);
    if (!log?.ownDelete) return false;
    if (present) log.ownDelete = false;
    return !present;
  }

  markClobbered(filePath: string, etag: string): void {
    this.entry(filePath).clobbered.add(etag);
  }

  ownEtag(filePath: string): string | undefined {
    return this.files.get(filePath)?.own?.etag;
  }

  /** Disarms the own-write record once its loss was reported. */
  forgetOwnWrite(filePath: string, etag: string): void {
    const log = this.files.get(filePath);
    if (log?.own?.etag === etag) log.own = undefined;
  }

  /**
   * Whether the own write `ownWrite` was replaced by a version that does not hold it: lost unless the bytes are ours
   * or every value it changed is still there (a later write merged it in), and always lost when it was clobbered.
   */
  checkOwnWrite(
    filePath: string,
    ownWrite: string,
    currentText: string,
    kind: MergeKind,
  ): { lost: false } | { lost: true; etag: string; baseEtag: string } {
    const log = this.files.get(filePath);
    const own = log?.own;
    if (!log || !own || own.etag !== ownWrite) return { lost: false };
    const lost = { lost: true as const, etag: own.etag, baseEtag: own.baseEtag };
    if (log.clobbered.has(own.etag)) return lost;
    if (sha1Hex(currentText) === own.hash) return { lost: false };
    try {
      const doc = mergeInputOf(kind, currentText);
      const baseText = log.versions.get(own.baseEtag);
      const base = baseText === undefined ? undefined : mergeInputOf(kind, baseText);
      const held = Object.entries(own.values).every(([anchor, value]) => {
        const found = valueAtAnchor({ kind, doc, anchor, base });
        return deepEqual(found.found ? found.value : undefined, value);
      });
      return held ? { lost: false } : lost;
    } catch {
      return lost;
    }
  }
}

const KEY = Symbol.for('conloca.versionLog');

/**
 * One log per process: `FileSystemContentAPI.create()` builds an instance per request and the dev server loads this
 * package beside Vite's module graph, so neither an instance field nor module state would be shared.
 */
export function versionLog(): VersionLog {
  // SAFETY: only this function reads or writes the KEY slot, and it only ever stores a VersionLog there.
  const holder = globalThis as typeof globalThis & { [KEY]?: VersionLog };
  holder[KEY] ??= new VersionLog();
  return holder[KEY];
}
