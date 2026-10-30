import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { skillChecksum, stampSkill } from '@conloca/content-api/skill-stamp';
import { CONLOCA_SKILL_PATH, LEGACY_CONLOCA_SKILL_CHECKSUMS, planSkillRefresh } from '../src/lib/skills.js';

const PACKAGE_DIR = dirname(Bun.resolveSync('@conloca/cloud-astro/package.json', import.meta.dir));
const TEMPLATE = await readFile(join(import.meta.dir, '..', 'src', 'templates', 'conloca-skill.md'), 'utf-8');

let dir = '';

async function put(path: string, text: string): Promise<void> {
  await mkdir(dirname(join(dir, path)), { recursive: true });
  await writeFile(join(dir, path), text);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'conloca-skills-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('planSkillRefresh', () => {
  test('creates the skill on a site that has none', async () => {
    const result = await planSkillRefresh(dir, '0.2.4');
    expect(result.edits).toEqual([
      { path: join(dir, CONLOCA_SKILL_PATH), before: null, after: stampSkill(TEMPLATE, '0.2.4') },
    ]);
  });

  test('replaces an unedited page of an older release', async () => {
    await put(CONLOCA_SKILL_PATH, stampSkill(TEMPLATE, '0.2.3'));
    expect((await planSkillRefresh(dir, '0.2.4')).edits[0]).toMatchObject({
      path: join(dir, CONLOCA_SKILL_PATH),
      after: stampSkill(TEMPLATE, '0.2.4'),
    });
  });

  test('replaces every unstamped page a released CLI wrote, one fixture per listed checksum', async () => {
    const fixtures = ['conloca-skill-0.2.1.md', 'conloca-skill-0.2.2.md', 'conloca-skill-0.2.3.md'];
    const texts = await Promise.all(fixtures.map((name) => readFile(join(import.meta.dir, 'fixtures', name), 'utf-8')));
    expect(new Set(texts.map(skillChecksum))).toEqual(new Set(LEGACY_CONLOCA_SKILL_CHECKSUMS));
    for (const text of texts) {
      // oxlint-disable-next-line no-await-in-loop -- every fixture takes the same path in turn.
      await put(CONLOCA_SKILL_PATH, text);
      // oxlint-disable-next-line no-await-in-loop -- planned against the fixture just written.
      expect((await planSkillRefresh(dir, '0.2.4')).state).toBe('changed');
    }
  });

  test('replaces an unedited page checked out with CRLF line endings', async () => {
    await put(CONLOCA_SKILL_PATH, stampSkill(TEMPLATE, '0.2.3').replaceAll('\n', '\r\n'));
    expect((await planSkillRefresh(dir, '0.2.4')).edits.map((edit) => edit.path)).toEqual([
      join(dir, CONLOCA_SKILL_PATH),
    ]);
  });

  test('keeps an edited page and writes the new one beside it', async () => {
    await put(CONLOCA_SKILL_PATH, `${stampSkill(TEMPLATE, '0.2.3')}\n`);
    const result = await planSkillRefresh(dir, '0.2.4');
    expect(result.state).toBe('differs');
    expect(result.edits.map((edit) => edit.path)).toEqual([join(dir, '.claude', 'skills', 'conloca', 'SKILL.new.md')]);
    expect(result.message).toContain('SKILL.new.md');
  });

  test('is done when the page is already current', async () => {
    await put(CONLOCA_SKILL_PATH, stampSkill(TEMPLATE, '0.2.4'));
    expect(await planSkillRefresh(dir, '0.2.4')).toMatchObject({ state: 'done', edits: [] });
  });

  test("refreshes the `conloca-cloud` page from the project's own @conloca/cloud-astro", async () => {
    await mkdir(join(dir, '.git'));
    await mkdir(join(dir, '.claude'));
    await mkdir(join(dir, 'node_modules', '@conloca'), { recursive: true });
    await symlink(PACKAGE_DIR, join(dir, 'node_modules', '@conloca', 'cloud-astro'), 'dir');
    const result = await planSkillRefresh(dir, '0.2.4');
    expect(result.edits.map((edit) => edit.path)).toContain(
      join(dir, '.claude', 'skills', 'conloca-cloud', 'SKILL.md'),
    );
  });
});
