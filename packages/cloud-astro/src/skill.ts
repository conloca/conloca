import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stampSkill } from '@conloca/content-api/skill-stamp';
import { messageOf } from './message-of.js';
import { packageVersion } from './package-version.js';

export const SKILL_RELATIVE_PATH = join('.claude', 'skills', 'conloca-cloud', 'SKILL.md');

/** The sha256 of every unstamped page a release wrote, so an upgrade can tell an untouched old page from an edited one. */
export const LEGACY_SKILL_CHECKSUMS: readonly string[] = [
  '201dc9a1fe57038c32a46448228ab432cce060b0079225007ec6dec74ba46959', // 0.2.1, 0.2.2
  '82edfffa022797265bee87289a491e7af12d8e13423f541892e281c416f0554a', // 0.2.3
];

/**
 * The canonical page, located from the package root (through the package's own `./package.json` export) so the
 * built `dist/src/skill.js` and the source `src/skill.ts` reach the same shipped `src/skill/SKILL.md`. Resolved on
 * demand, not at import: a copy running outside its package boundary must fail inside scaffoldSkill's
 * fail-soft path, never while the site's Astro config is loading.
 */
export function skillTemplateUrl(): URL {
  const packageRoot = dirname(createRequire(import.meta.url).resolve('@conloca/cloud-astro/package.json'));
  return pathToFileURL(join(packageRoot, 'src', 'skill', 'SKILL.md'));
}

type SkillLogger = { info(msg: string): void; debug(msg: string): void };

/**
 * The nearest directory, from the Astro project root up to the git root, that
 * carries a `.claude/`. Repo-root layouts are the real ones: a site's
 * Astro project is usually a workspace member below the repo root. Needs a git
 * root: a project outside any repository gets nothing.
 */
export function findClaudeHome(projectRoot: string): string | undefined {
  let dir = projectRoot;
  let home: string | undefined;
  for (;;) {
    if (home === undefined && existsSync(join(dir, '.claude'))) home = dir;
    // The git root bounds the walk; without one there is no repo to scaffold into
    // (a stray ~/.claude must never receive a global copy).
    if (existsSync(join(dir, '.git'))) return home;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Where the site's agent skill page belongs and the text this release writes there, stamped with the release and the
 * template's checksum. Null without a `.claude/` home or a readable package version.
 */
export function agentSkill(
  projectRoot: string,
): { path: string; text: string; legacyChecksums: readonly string[] } | null {
  const home = findClaudeHome(projectRoot);
  const version = packageVersion();
  if (home === undefined || version === undefined) return null;
  return {
    path: join(home, SKILL_RELATIVE_PATH),
    text: stampSkill(readFileSync(skillTemplateUrl(), 'utf8'), version),
    legacyChecksums: LEGACY_SKILL_CHECKSUMS,
  };
}

/**
 * Write the skill page once — never overwrite, never throw. A read-only CI
 * checkout must not break a build over documentation.
 */
export function scaffoldSkill(projectRoot: string, logger: SkillLogger): 'written' | 'exists' | 'skipped' | 'failed' {
  let target = SKILL_RELATIVE_PATH;
  try {
    const skill = agentSkill(projectRoot);
    if (skill === null) {
      logger.debug(
        'no .claude/ directory between the project and the git root, or no readable package version — agent skill not scaffolded',
      );
      return 'skipped';
    }
    target = skill.path;
    if (existsSync(target)) return 'exists';
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, skill.text, { flag: 'wx' });
    logger.info(`agent skill written to ${target}`);
    return 'written';
  } catch (error) {
    // The exclusive write lost a race with a concurrent build (or a symlink sits
    // at the path): the page is there, which is the truthful outcome.
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return 'exists';
    logger.info(`agent skill not written to ${target} (${messageOf(error)})`);
    return 'failed';
  }
}
