import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
// nx-ignore-next-line: a shared test file, not a dependency on tooling's project; the targets that use it list it as an input.
import { nestingTestTimeoutMs, runFromLinkedWorktree } from '../../../tooling/git-env-isolation.js';

// What each test gets in content-api:test (`bun test --timeout=30000`), and so in the nested run too.
const TEST_TIMEOUT_MS = 30_000;

// A test run that git started from a linked worktree once re-initialised the enclosing repository as bare and
// wrote the test identity into its config. The repositories these tests create must stay their own.
describe('a test run that git starts from a linked worktree', () => {
  test(
    'creates its repositories without touching the enclosing one',
    async () => {
      const { before, after, output, status } = await runFromLinkedWorktree(
        join(import.meta.dir, '..'),
        process.execPath,
        ['test', `--timeout=${TEST_TIMEOUT_MS}`, './test/git-operations.test.ts', '-t', 'stages and commits changes'],
        TEST_TIMEOUT_MS,
      );

      expect(after).toEqual(before);
      expect(status, output).toBe(0);
      expect(output).toMatch(/\b1 pass\b/);
    },
    nestingTestTimeoutMs(TEST_TIMEOUT_MS),
  );
});
