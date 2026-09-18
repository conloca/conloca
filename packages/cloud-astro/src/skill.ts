import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { messageOf } from './message-of.js';

export const SKILL_RELATIVE_PATH = join('.claude', 'skills', 'conloca-cloud', 'SKILL.md');

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
 * Write the skill page once — never overwrite, never throw. A read-only CI
 * checkout must not break a build over documentation.
 */
export function scaffoldSkill(projectRoot: string, logger: SkillLogger): 'written' | 'exists' | 'skipped' | 'failed' {
  const home = findClaudeHome(projectRoot);
  if (home === undefined) {
    logger.debug('no .claude/ directory between the project and the git root — agent skill not scaffolded');
    return 'skipped';
  }
  const target = join(home, SKILL_RELATIVE_PATH);
  if (existsSync(target)) return 'exists';
  try {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(skillTemplateUrl(), 'utf8'), { flag: 'wx' });
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
