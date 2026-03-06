import { rename, unlink, writeFile } from 'node:fs/promises';

/**
 * Write file atomically via temp file + rename to prevent corruption on crash.
 * Callers are responsible for ensuring the parent directory exists.
 */
export async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  const hrtime = process.hrtime.bigint();
  const tempFile = `${filePath}.tmp.${process.pid}.${hrtime}`;

  try {
    await writeFile(tempFile, content);
    await rename(tempFile, filePath);
  } catch (error) {
    try {
      await unlink(tempFile);
    } catch {}
    throw error;
  }
}
