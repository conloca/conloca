import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
// nx-ignore-next-line: a shared test file, not a dependency on tooling's project; the targets that use it list it as an input.
import { nestingTestTimeoutMs, runFromLinkedWorktree } from '../../../tooling/git-env-isolation.js';

// What each test gets in cli:test (`bun test --timeout=30000`), and so in the nested run too.
const TEST_TIMEOUT_MS = 30_000;

// Started by git from a linked worktree, a test run sees every directory as part of the enclosing repository:
// `create` skips `git init` for the project it scaffolds, and a test's own `git init <dir>` re-initialises the
// enclosing repository instead.
describe('a test run that git starts from a linked worktree', () => {
  test(
    'creates its repositories without touching the enclosing one',
    async () => {
      const { before, after, output, status } = await runFromLinkedWorktree(
        join(import.meta.dir, '..'),
        process.execPath,
        ['test', `--timeout=${TEST_TIMEOUT_MS}`, './test/create.test.ts', '-t', 'initializes git by default'],
        TEST_TIMEOUT_MS,
      );

      expect(after).toEqual(before);
      expect(status, output).toBe(0);
      expect(output).toMatch(/\b1 pass\b/);
    },
    nestingTestTimeoutMs(TEST_TIMEOUT_MS),
  );
});
