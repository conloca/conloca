import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { execSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createGitOperations, setupGitLfsAttributes } from '../src/git-operations';

describe('setupGitLfsAttributes', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `conloca-lfs-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('creates .gitattributes with all 8 LFS patterns when file does not exist', async () => {
    await setupGitLfsAttributes(tempDir);
    const content = await readFile(join(tempDir, '.gitattributes'), 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(8);
    expect(content).toContain('*.jpg filter=lfs diff=lfs merge=lfs -text');
    expect(content).toContain('*.jpeg filter=lfs diff=lfs merge=lfs -text');
    expect(content).toContain('*.png filter=lfs diff=lfs merge=lfs -text');
    expect(content).toContain('*.gif filter=lfs diff=lfs merge=lfs -text');
    expect(content).toContain('*.svg filter=lfs diff=lfs merge=lfs -text');
    expect(content).toContain('*.webp filter=lfs diff=lfs merge=lfs -text');
    expect(content).toContain('*.avif filter=lfs diff=lfs merge=lfs -text');
    expect(content).toContain('*.ico filter=lfs diff=lfs merge=lfs -text');
  });

  test('preserves existing content and appends only missing patterns', async () => {
    const existing = '*.jpg filter=lfs diff=lfs merge=lfs -text\n*.png filter=lfs diff=lfs merge=lfs -text\n';
    await writeFile(join(tempDir, '.gitattributes'), existing);
    await setupGitLfsAttributes(tempDir);
    const content = await readFile(join(tempDir, '.gitattributes'), 'utf-8');
    // Should still have original 2 + 6 missing = 8 patterns total
    expect(content).toContain('*.jpg filter=lfs diff=lfs merge=lfs -text');
    expect(content).toContain('*.png filter=lfs diff=lfs merge=lfs -text');
    expect(content).toContain('*.jpeg filter=lfs diff=lfs merge=lfs -text');
    expect(content).toContain('*.webp filter=lfs diff=lfs merge=lfs -text');
    // Count total pattern lines (non-empty lines)
    const patternLines = content
      .trim()
      .split('\n')
      .filter((l) => l.trim());
    expect(patternLines).toHaveLength(8);
  });

  test('does nothing when all patterns already present', async () => {
    // Write all 8 patterns
    await setupGitLfsAttributes(tempDir);
    const contentBefore = await readFile(join(tempDir, '.gitattributes'), 'utf-8');
    // Run again -- should be idempotent
    await setupGitLfsAttributes(tempDir);
    const contentAfter = await readFile(join(tempDir, '.gitattributes'), 'utf-8');
    expect(contentAfter).toBe(contentBefore);
  });

  test('handles empty existing .gitattributes file', async () => {
    await writeFile(join(tempDir, '.gitattributes'), '');
    await setupGitLfsAttributes(tempDir);
    const content = await readFile(join(tempDir, '.gitattributes'), 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(8);
  });
});

describe('createGitOperations', () => {
  let tempDir: string;
  let contentPath: string;

  /**
   * Helper to initialize a real git repo in tempDir with user config.
   * contentPath is set to a "content" subdirectory inside the repo.
   */
  async function initGitRepo(): Promise<void> {
    execSync('git init', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config core.fsync none', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.name "Test User"', { cwd: tempDir, stdio: 'ignore' });
    // Create content directory (simulates contentPath inside repo)
    await mkdir(contentPath, { recursive: true });
  }

  /** Helper to create an initial commit so branch exists */
  async function createInitialCommit(): Promise<void> {
    await writeFile(join(tempDir, '.gitkeep'), '');
    execSync('git add -A', { cwd: tempDir, stdio: 'ignore' });
    execSync('git commit -m "init"', { cwd: tempDir, stdio: 'ignore' });
  }

  beforeEach(async () => {
    tempDir = join(tmpdir(), `conloca-git-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
    contentPath = join(tempDir, 'content');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('getStatus', () => {
    test('returns isRepo:true for initialized git repo', async () => {
      await initGitRepo();
      await createInitialCommit();
      const ops = createGitOperations({ contentPath });
      const status = await ops.getStatus();
      expect(status.isRepo).toBe(true);
    });

    test('returns hasChanges:true when uncommitted files exist', async () => {
      await initGitRepo();
      await createInitialCommit();
      // Create an uncommitted file
      await writeFile(join(contentPath, 'new-file.txt'), 'hello');
      const ops = createGitOperations({ contentPath });
      const status = await ops.getStatus();
      expect(status.hasChanges).toBe(true);
      expect(status.changedFiles).toBeGreaterThan(0);
    });

    test('returns hasChanges:false in clean repo', async () => {
      await initGitRepo();
      await createInitialCommit();
      const ops = createGitOperations({ contentPath });
      const status = await ops.getStatus();
      expect(status.hasChanges).toBe(false);
      expect(status.changedFiles).toBe(0);
    });

    test('returns correct branch name', async () => {
      await initGitRepo();
      await createInitialCommit();
      // Get whatever default branch name git uses
      const branchName = execSync('git rev-parse --abbrev-ref HEAD', { cwd: tempDir }).toString().trim();
      const ops = createGitOperations({ contentPath });
      const status = await ops.getStatus();
      expect(status.branch).toBe(branchName);
    });

    test('only reports changes within contentPath', async () => {
      await initGitRepo();
      await createInitialCommit();
      // Write a file OUTSIDE contentPath
      await writeFile(join(tempDir, 'outside-status.txt'), 'outside content');
      const ops = createGitOperations({ contentPath });
      // Should NOT report changes for files outside contentPath
      const status1 = await ops.getStatus();
      expect(status1.hasChanges).toBe(false);
      expect(status1.changedFiles).toBe(0);
      // Write a file INSIDE contentPath
      await writeFile(join(contentPath, 'inside-status.txt'), 'inside content');
      const status2 = await ops.getStatus();
      expect(status2.hasChanges).toBe(true);
      expect(status2.changedFiles).toBe(1);
    });

    test('returns isRepo:false when contentPath is not in a git repo', async () => {
      // Use a plain temp dir (no git init)
      const plainDir = join(tmpdir(), `conloca-nongit-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      await mkdir(plainDir, { recursive: true });
      try {
        const ops = createGitOperations({ contentPath: plainDir });
        const status = await ops.getStatus();
        expect(status.isRepo).toBe(false);
        expect(status.branch).toBe('unknown');
      } finally {
        await rm(plainDir, { recursive: true, force: true });
      }
    });
  });

  describe('commitAll', () => {
    test('stages and commits changes, returns success:true with commit SHA', async () => {
      await initGitRepo();
      await createInitialCommit();
      await writeFile(join(contentPath, 'file.txt'), 'content');
      const ops = createGitOperations({ contentPath });
      const result = await ops.commitAll('test: add file');
      expect(result.success).toBe(true);
      expect(result.commit).toBeDefined();
      expect(result.commit).toHaveLength(40); // Full SHA
      expect(result.summary).toContain('1 files committed');
    });

    test('does not stage files outside contentPath', async () => {
      await initGitRepo();
      await createInitialCommit();
      // Write a file OUTSIDE contentPath (repo root)
      await writeFile(join(tempDir, 'outside.txt'), 'should not be staged');
      // Write a file INSIDE contentPath
      await writeFile(join(contentPath, 'inside.txt'), 'should be staged');
      const ops = createGitOperations({ contentPath });
      const result = await ops.commitAll('test: scoped commit');
      expect(result.success).toBe(true);
      // Check committed files via git show --stat
      const showOutput = execSync('git show --stat HEAD', { cwd: tempDir }).toString();
      expect(showOutput).toContain('content/inside.txt');
      expect(showOutput).not.toContain('outside.txt');
      // Verify outside.txt still appears as untracked
      const statusOutput = execSync('git status --porcelain', { cwd: tempDir }).toString();
      expect(statusOutput).toContain('outside.txt');
    });

    test('with author sets --author flag', async () => {
      await initGitRepo();
      await createInitialCommit();
      await writeFile(join(contentPath, 'authored.txt'), 'data');
      const ops = createGitOperations({ contentPath });
      const result = await ops.commitAll('test: authored commit', {
        name: 'Custom Author',
        email: 'custom@example.com',
      });
      expect(result.success).toBe(true);
      // Verify via git log
      const log = execSync('git log -1 --format=%an', { cwd: tempDir }).toString().trim();
      expect(log).toBe('Custom Author');
      const email = execSync('git log -1 --format=%ae', { cwd: tempDir }).toString().trim();
      expect(email).toBe('custom@example.com');
    });

    test('returns error when nothing to commit', async () => {
      await initGitRepo();
      await createInitialCommit();
      const ops = createGitOperations({ contentPath });
      const result = await ops.commitAll('empty commit');
      expect(result.success).toBe(false);
      expect(result.error).toContain('No changes to commit');
    });

    test('returns error when not a git repo', async () => {
      const plainDir = join(tmpdir(), `conloca-nongit-commit-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      await mkdir(plainDir, { recursive: true });
      try {
        const ops = createGitOperations({ contentPath: plainDir });
        const result = await ops.commitAll('should fail');
        expect(result.success).toBe(false);
        expect(result.error).toContain('Not a git repository');
      } finally {
        await rm(plainDir, { recursive: true, force: true });
      }
    });
  });

  describe('pushOrigin', () => {
    test('returns error for repo without remote', async () => {
      await initGitRepo();
      await createInitialCommit();
      const ops = createGitOperations({ contentPath });
      const result = await ops.pushOrigin();
      expect(result.success).toBe(false);
      expect(result.error).toContain('No git remote "origin" configured');
    });
  });

  describe('pull', () => {
    test('returns error for repo without remote', async () => {
      await initGitRepo();
      await createInitialCommit();
      const ops = createGitOperations({ contentPath });
      const result = await ops.pull();
      expect(result.success).toBe(false);
      // pull will fail because there's no origin configured
      expect(result.error).toBeDefined();
    });
  });

  test('caches resolveRepoRoot across multiple method calls', async () => {
    await initGitRepo();
    await createInitialCommit();
    // Call getStatus() twice, commitAll() once -- all should work
    // This proves caching doesn't break any method
    const ops = createGitOperations({ contentPath });
    const status1 = await ops.getStatus();
    expect(status1.isRepo).toBe(true);
    const status2 = await ops.getStatus();
    expect(status2.isRepo).toBe(true);
    // commitAll should also work (uses same cached root)
    await writeFile(join(contentPath, 'cache-test.txt'), 'data');
    const result = await ops.commitAll('test: cache validation');
    expect(result.success).toBe(true);
  });
});
