import { mkdir, readdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWriteFile } from './atomic-write.js';
import { canonicalPath, sha1Hex } from './file-lock.js';

/** A version of one locale file that a write replaced without its writer having read it. */
export interface ClobberRecord {
  id: string;
  locale: string;
  filePath: string;
  /** The etag of `text`, the replaced version. */
  etag: string;
  /** The version the replaced writer most likely built on. */
  baseText: string;
  text: string;
  at: string;
}

// Etags and locales name files here; anything else (a slash, a request's `..`) is refused, not looked up.
const SAFE_SEGMENT = /^[\w.-]+$/;

function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

/**
 * Clobbered versions on disk beside the locks, so every process sharing the lock dir (CLI, dev server) sees them. Keyed
 * by content root and id, not path, so an entry survives a rename or move of its file. Kept until dismissed.
 *
 * shortcut: no size cap; one entry is one file text and entries only appear after a lock takeover race. Add pruning
 * if they ever pile up.
 */
export class ClobberStore {
  private readonly lockDir: string;
  private readonly contentRoot: string;

  constructor(lockDir: string, contentRoot: string) {
    this.lockDir = lockDir;
    this.contentRoot = canonicalPath(contentRoot);
  }

  private dirOf(id: string): string {
    return join(this.lockDir, 'clobbered', sha1Hex(`${this.contentRoot}\0${id}`));
  }
  async record(entry: Omit<ClobberRecord, 'at'>): Promise<void> {
    if (!SAFE_SEGMENT.test(entry.locale) || !SAFE_SEGMENT.test(entry.etag)) return;
    const dir = this.dirOf(entry.id);
    await mkdir(dir, { recursive: true });
    const record: ClobberRecord = { ...entry, at: new Date().toISOString() };
    await atomicWriteFile(join(dir, `${entry.locale}.${entry.etag}.json`), JSON.stringify(record));
  }

  async list(id: string, locale: string): Promise<{ etag: string; at: string }[]> {
    if (!SAFE_SEGMENT.test(locale)) return [];
    const names = await readdir(this.dirOf(id)).catch((): string[] => []);
    const prefix = `${locale}.`;
    const records = await Promise.all(
      names
        .filter((name) => name.startsWith(prefix) && name.endsWith('.json'))
        .map((name) => this.get(id, locale, name.slice(prefix.length, -'.json'.length))),
    );
    return records.flatMap((record) => (record ? [{ etag: record.etag, at: record.at }] : []));
  }

  async get(id: string, locale: string, etag: string): Promise<ClobberRecord | null> {
    if (!SAFE_SEGMENT.test(locale) || !SAFE_SEGMENT.test(etag)) return null;
    try {
      // SAFETY: only `record` writes these files, always a whole ClobberRecord (atomic write).
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same reason as the SAFETY note.
      return JSON.parse(await readFile(join(this.dirOf(id), `${locale}.${etag}.json`), 'utf8')) as ClobberRecord;
    } catch (error) {
      if (isCode(error, 'ENOENT')) return null;
      throw error;
    }
  }

  async has(id: string, locale: string, etag: string): Promise<boolean> {
    return (await this.get(id, locale, etag)) !== null;
  }

  async dismiss(id: string, locale: string, etag: string): Promise<void> {
    if (!SAFE_SEGMENT.test(locale) || !SAFE_SEGMENT.test(etag)) return;
    await unlink(join(this.dirOf(id), `${locale}.${etag}.json`)).catch((error) => {
      if (!isCode(error, 'ENOENT')) throw error;
    });
  }
}
