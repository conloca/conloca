import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AstroIntegrationLogger } from 'astro';
import { PREVIEW_BUILD_ENV_FLAG } from '../constants.js';
import { conlocaCloud } from '../index.js';
import { findClaudeHome, SKILL_RELATIVE_PATH, scaffoldSkill, skillTemplateUrl } from '../skill.js';

const silent = { info: () => {}, debug: () => {}, warn: () => {} };

describe('findClaudeHome', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'agent-skill-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('walks up from the project to the git root and returns the directory carrying .claude/', async () => {
    await mkdir(join(root, '.git'));
    await mkdir(join(root, '.claude'));
    const project = join(root, 'apps', 'site');
    await mkdir(project, { recursive: true });
    expect(findClaudeHome(project)).toBe(root);
  });

  it('stops at the git root — a .claude/ above it does not count', async () => {
    await mkdir(join(root, '.claude'));
    const repo = join(root, 'repo');
    await mkdir(join(repo, '.git'), { recursive: true });
    expect(findClaudeHome(repo)).toBeUndefined();
  });

  it('prefers the nearest .claude/ to the project', async () => {
    await mkdir(join(root, '.git'));
    await mkdir(join(root, '.claude'));
    const project = join(root, 'apps', 'site');
    await mkdir(join(project, '.claude'), { recursive: true });
    expect(findClaudeHome(project)).toBe(project);
  });

  it('needs a git root — a project outside any repository gets nothing, even with a .claude/ above it', async () => {
    await mkdir(join(root, '.claude'));
    const project = join(root, 'a', 'b', 'site');
    await mkdir(project, { recursive: true });
    expect(findClaudeHome(project)).toBeUndefined();
    expect(scaffoldSkill(project, silent)).toBe('skipped');
  });

  it('treats a .git FILE (worktree or submodule checkout) as the git root too', async () => {
    await writeFile(join(root, '.git'), 'gitdir: elsewhere');
    await mkdir(join(root, '.claude'));
    const project = join(root, 'apps', 'site');
    await mkdir(project, { recursive: true });
    expect(findClaudeHome(project)).toBe(root);
  });
});

describe('scaffoldSkill', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'agent-skill-scaffold-'));
    await mkdir(join(root, '.git'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes the canonical page once and reports what it did', async () => {
    await mkdir(join(root, '.claude'));
    expect(scaffoldSkill(root, silent)).toBe('written');
    const written = await readFile(join(root, SKILL_RELATIVE_PATH), 'utf-8');
    expect(written).toBe(await readFile(skillTemplateUrl(), 'utf-8'));
    expect(written).toStartWith('---\nname: conloca-cloud\n');
    expect(scaffoldSkill(root, silent)).toBe('exists');
  });

  it('never overwrites a customized page', async () => {
    const custom = '---\nname: conloca-cloud\ndescription: mine\n---\n';
    await mkdir(join(root, '.claude', 'skills', 'conloca-cloud'), { recursive: true });
    await writeFile(join(root, SKILL_RELATIVE_PATH), custom);
    expect(scaffoldSkill(root, silent)).toBe('exists');
    expect(await readFile(join(root, SKILL_RELATIVE_PATH), 'utf-8')).toBe(custom);
  });

  it('skips a repo without .claude/', () => {
    expect(scaffoldSkill(root, silent)).toBe('skipped');
  });

  it('fails soft when the write is impossible (a read-only checkout must not break a build)', async () => {
    await mkdir(join(root, '.claude'));
    await writeFile(join(root, '.claude', 'skills'), 'a file where the directory should be');
    expect(scaffoldSkill(root, silent)).toBe('failed');
  });

  it('fails soft when .claude is a file where a directory is expected', async () => {
    await writeFile(join(root, '.claude'), 'a file where the directory should be');
    expect(scaffoldSkill(root, silent)).toBe('failed');
  });

  // A dangling symlink is invisible to existsSync yet makes the exclusive write fail with EEXIST — the same
  // outcome as a page appearing between the pre-check and the write (two builds racing), without mocking fs.
  it('reports a page that appears between the pre-check and the write as existing, not failed', async () => {
    await mkdir(join(root, '.claude', 'skills', 'conloca-cloud'), { recursive: true });
    await symlink('nowhere', join(root, SKILL_RELATIVE_PATH));
    expect(scaffoldSkill(root, silent)).toBe('exists');
  });
});

describe('the integration scaffolds the skill at config:setup', () => {
  let root: string;
  let restore: string | undefined;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'agent-skill-hook-'));
    await mkdir(join(root, '.git'));
    await mkdir(join(root, '.claude'));
    restore = process.env[PREVIEW_BUILD_ENV_FLAG];
    delete process.env[PREVIEW_BUILD_ENV_FLAG];
  });
  afterEach(async () => {
    if (restore === undefined) delete process.env[PREVIEW_BUILD_ENV_FLAG];
    else process.env[PREVIEW_BUILD_ENV_FLAG] = restore;
    await rm(root, { recursive: true, force: true });
  });

  function runConfigSetup(): void {
    const hook = conlocaCloud({ endpoint: 'https://cms.example.test', puckConfigPath: './src/puck.config.tsx' }).hooks[
      'astro:config:setup'
    ] as (args: Record<string, unknown>) => void;
    hook({
      logger: silent as unknown as AstroIntegrationLogger,
      config: { root: pathToFileURL(`${root}/`) },
      injectRoute: () => {},
      updateConfig: () => {},
      addMiddleware: () => {},
    });
  }

  it('writes the page for a repo with .claude/', async () => {
    runConfigSetup();
    expect(await readFile(join(root, SKILL_RELATIVE_PATH), 'utf-8')).toContain('conloca doctor --live');
  });

  it('does nothing inside the recursive preview child build', async () => {
    process.env[PREVIEW_BUILD_ENV_FLAG] = '1';
    runConfigSetup();
    await expect(readFile(join(root, SKILL_RELATIVE_PATH), 'utf-8')).rejects.toThrow();
  });
});
