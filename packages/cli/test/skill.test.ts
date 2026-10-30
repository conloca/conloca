import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stampSkill } from '@conloca/content-api/skill-stamp';
import { $ } from 'bun';
import { readCliManifest } from '../src/lib/project-template.js';

const CLI = join(import.meta.dir, '..', 'dist', 'conloca.js');
const SKILL_RELATIVE_PATH = join('.claude', 'skills', 'conloca', 'SKILL.md');
const SKILL_TEMPLATE = join(import.meta.dir, '..', 'src', 'templates', 'conloca-skill.md');

async function runSetup(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  await $`${CLI} astro setup ${dir}`.quiet();
  return dir;
}

describe('conloca agent skill', () => {
  test('astro setup scaffolds the agent skill and lists it as created', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conloca-skill-scaffold-'));
    try {
      const result = await $`${CLI} astro setup ${dir}`.quiet();
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toContain('.claude/skills/conloca/SKILL.md');

      const skill = await readFile(join(dir, SKILL_RELATIVE_PATH), 'utf-8');
      // SKILL.md frontmatter contract: a name and a when-to-load description.
      expect(skill).toStartWith('---\n');
      expect(skill).toContain('name: conloca');
      expect(skill).toContain('description:');
      // The opening move the skill exists to teach.
      expect(skill).toContain('conloca doctor');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('astro setup leaves an existing SKILL.md alone', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conloca-skill-existing-'));
    try {
      const customized = '---\nname: conloca\ndescription: Customized by this project.\n---\n';
      await Bun.write(join(dir, SKILL_RELATIVE_PATH), customized);
      const result = await $`${CLI} astro setup ${dir}`.quiet();
      expect(result.exitCode).toBe(0);
      expect(await readFile(join(dir, SKILL_RELATIVE_PATH), 'utf-8')).toBe(customized);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // The canonical page is src/templates/conloca-skill.md; setup writes it stamped with the CLI release.
  test('astro setup scaffolds the packaged skill template, stamped with the CLI release', async () => {
    const dir = await runSetup('conloca-skill-template-');
    try {
      const scaffolded = await readFile(join(dir, SKILL_RELATIVE_PATH), 'utf-8');
      const { version } = await readCliManifest();
      expect(scaffolded).toBe(stampSkill(await readFile(SKILL_TEMPLATE, 'utf-8'), version));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('the skill names every content command, one command form and the shared-entry helper', async () => {
    const skill = await readFile(SKILL_TEMPLATE, 'utf-8');
    for (const text of [
      'conloca page update',
      'conloca data create',
      'conloca data update',
      'conloca asset add',
      '--content',
      'conlocaDataEntry',
      'dataBindings',
      'npx @conloca/cli@<version>',
    ])
      expect(skill).toContain(text);
    expect(skill).not.toContain('npx @conloca/cli doctor');
  });

  test('the skill carries every conversion rule and no hardcoded MCP address', async () => {
    const skill = await readFile(SKILL_TEMPLATE, 'utf-8');
    const start = skill.indexOf('## Converting an existing Astro page');
    expect(start).toBeGreaterThan(-1);
    const end = skill.indexOf('\n## ', start + 1);
    const section = skill.slice(start, end === -1 ? undefined : end);
    for (const rule of [
      'conloca upgrade',
      'conloca routes',
      'conloca components --json',
      'conloca compare --reset --routes',
      'conloca doctor',
      'src/components/puck/',
      'siteStyles',
      'withHydration()',
      'conloca asset add',
      'conloca page update',
      'conloca data create',
      '`title`, `description`, `page`',
      'one copy',
      "'header', 'en').menu",
      'header and footer',
      'Fragments',
      'fail the build',
      'Never hand-write content files',
      'same change',
      'identical',
      'allowed change',
      'Report every changed file',
      'MCP',
      'cannot change code',
    ])
      expect(section).toContain(rule);
    expect(section.match(/https?:\/\/\S+/g) ?? []).toEqual(['https://conloca.com/workspace-mcp/.']);
  });

  test('the skill teaches the one upgrade command and forbids hand-edited versions', async () => {
    const skill = await readFile(SKILL_TEMPLATE, 'utf-8');
    expect(skill).toContain('## Upgrading Conloca');
    expect(skill).toContain('npx @conloca/cli@latest upgrade');
    expect(skill.match(/means `npx @conloca\/cli@<version>/g)?.length).toBe(1); // P1's definition, not a second one
    expect(skill).toContain('SKILL.new.md');
    expect(skill).toMatch(/never edit `@conloca\/\*` versions by hand/i);
  });
});
