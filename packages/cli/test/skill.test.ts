import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';

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

  // The canonical page is src/templates/conloca-skill.md; setup writes it as it is.
  test('astro setup scaffolds the packaged skill template byte for byte', async () => {
    const dir = await runSetup('conloca-skill-template-');
    try {
      const scaffolded = await readFile(join(dir, SKILL_RELATIVE_PATH), 'utf-8');
      expect(scaffolded).toBe(await readFile(SKILL_TEMPLATE, 'utf-8'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
