import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const testTempRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '.tmp', 'tests');

export function testTempDir(prefix: string): string {
  // WHY: macOS/Jcode sandbox denies /tmp writes; package-local temps keep tests hermetic and cleanup-scoped.
  return join(testTempRoot, `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}
