// Child process for file-lock.test.ts: 20 locked read-increment-write cycles on one counter file.
import { readFile, writeFile } from 'node:fs/promises';
import { withFileLock } from '../src/utils/file-lock.js';

const [counterPath, lockDir] = process.argv.slice(2);
for (let cycle = 0; cycle < 20; cycle++) {
  // oxlint-disable-next-line no-await-in-loop -- sequential by design: each cycle is one locked increment.
  await withFileLock(
    counterPath,
    async () => {
      const value = Number(await readFile(counterPath, 'utf8'));
      await writeFile(counterPath, String(value + 1));
    },
    { lockDir, timeoutMs: 30_000 },
  );
}
