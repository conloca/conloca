import { type FileHandle, open, readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import fg from 'fast-glob';
import type { BackendReadResult, ContentReaderBackend } from './reader-backend.js';

const DEFAULT_GLOB = '**/*.{vxjson,mdx,json}';
const DEFAULT_HEADER_BYTES = 4096;
const DEFAULT_BATCH_SIZE = 1000;

export interface FileSystemReaderBackendOptions {
  /** Filesystem root for content. Relative paths are resolved against cwd. */
  contentRoot: string;
  /** Glob applied during listing when the caller doesn't override; defaults to '**\/*.{vxjson,mdx,json}'. */
  defaultGlob?: string;
  /** Upper bound on the buffer pool size (one reusable Uint8Array per slot). */
  batchSize?: number;
}

function errorReasonFromCode(error: unknown): 'not-found' | 'permission-denied' | 'io-error' {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (code === 'ENOENT') return 'not-found';
    if (code === 'EACCES' || code === 'EPERM') return 'permission-denied';
  }
  return 'io-error';
}

function toForwardSlash(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/');
}

/**
 * `FileSystemReaderBackend` — the filesystem implementation of `ContentReaderBackend`.
 *
 * Hot-loop optimisations preserved from the legacy `FileSystemContentAPI` scanner:
 *   - fast-glob is used for the path scan (matches the existing dependency surface).
 *   - A small buffer pool (`min(files.length, batchSize)` slots) is reused across
 *     parallel reads to keep allocator pressure low on large content trees.
 *   - Per-file reads run via `fs/promises.open` + `read(buffer, 0, headerBytes, 0)`
 *     to avoid loading the full blob when only the manifest header is needed.
 *
 * By contract, the yielded `header` is **always a copy** of the bytes written
 * into the pooled buffer. The pool will be overwritten by subsequent reads;
 * yielding a slice would alias and corrupt earlier consumers.
 *
 * Per-file FS failures are surfaced as `{ ok: false, reason, message, path }`
 * items — never thrown — so a single corrupt file doesn't abort the stream.
 */
export class FileSystemReaderBackend implements ContentReaderBackend {
  private readonly absoluteContentRoot: string;
  private readonly defaultGlob: string;
  private readonly batchSize: number;

  constructor(options: FileSystemReaderBackendOptions) {
    this.absoluteContentRoot = resolve(options.contentRoot);
    this.defaultGlob = options.defaultGlob ?? DEFAULT_GLOB;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  }

  /**
   * Stream content paths matching the glob, with up to `headerBytes` of each
   * file's bytes attached. Errors are surfaced as `{ ok: false }` items.
   */
  async *listContentPaths(opts?: { glob?: string; headerBytes?: number }): AsyncIterable<BackendReadResult> {
    const glob = opts?.glob ?? this.defaultGlob;
    const headerBytes = opts?.headerBytes ?? DEFAULT_HEADER_BYTES;

    const matches = await fg(glob, {
      cwd: this.absoluteContentRoot,
      onlyFiles: true,
      followSymbolicLinks: false,
      dot: false,
    });

    if (matches.length === 0) return;

    const poolSize = Math.max(1, Math.min(matches.length, this.batchSize));
    const pool: Uint8Array[] = Array.from({ length: poolSize }, () => new Uint8Array(headerBytes));

    for (let i = 0; i < matches.length; i++) {
      const relativePath = toForwardSlash(matches[i]);
      const absolutePath = resolve(this.absoluteContentRoot, matches[i]);
      const buffer = pool[i % pool.length];

      let handle: FileHandle | undefined;
      try {
        handle = await open(absolutePath, 'r');
        const stat = await handle.stat();
        const readLen = Math.min(headerBytes, stat.size);
        const targetBuffer = buffer.byteLength >= readLen ? buffer : new Uint8Array(readLen);
        const { bytesRead } = readLen > 0 ? await handle.read(targetBuffer, 0, readLen, 0) : { bytesRead: 0 };
        // Always yield a copy. Slicing a `Uint8Array` allocates a fresh view
        // backed by a new buffer in V8, so the next read into `targetBuffer`
        // can't poison the bytes we just handed out.
        const header = targetBuffer.slice(0, bytesRead);

        yield {
          ok: true,
          path: relativePath,
          size: stat.size,
          header,
          complete: bytesRead === stat.size,
        };
      } catch (error) {
        yield {
          ok: false,
          path: relativePath,
          reason: errorReasonFromCode(error),
          message: error instanceof Error ? error.message : String(error),
        };
      } finally {
        await handle?.close().catch(() => {
          // Closing a never-opened handle throws — but we set it to undefined
          // in that case, so this catch only swallows already-closed errors.
        });
      }
    }
  }

  /**
   * Read the full bytes of a content path. Returns null if the path no longer
   * exists (race against deletion is acceptable).
   */
  async readPath(path: string): Promise<Uint8Array | null> {
    try {
      const absolutePath = resolve(this.absoluteContentRoot, path);
      const bytes = await readFile(absolutePath);
      // readFile returns a Buffer (a Uint8Array subclass), which satisfies the
      // contract. Returning it directly avoids a copy.
      return bytes as Uint8Array;
    } catch {
      return null;
    }
  }
}
