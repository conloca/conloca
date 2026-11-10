// Child process for file-lock.test.ts: another process takes over a stalled holder's lock and replaces the file.
// Args: file, lock dir, new text, and optionally an mtime (ms) to stamp on the lock, colliding with the stalled holder's.
import { utimes } from 'node:fs/promises';
import { atomicWriteFile } from '../src/utils/atomic-write.js';
import { lockPathFor, withFileLock } from '../src/utils/file-lock.js';

const [filePath, lockDir, text, collideMs] = process.argv.slice(2);
await withFileLock(
  filePath,
  async (lock) => {
    if (collideMs) {
      const mtime = new Date(Number(collideMs));
      await utimes(lockPathFor(filePath, lockDir), mtime, mtime);
    } else {
      await lock.assertHeld();
    }
    await atomicWriteFile(filePath, text);
  },
  { lockDir, staleMs: 2_000 },
);
