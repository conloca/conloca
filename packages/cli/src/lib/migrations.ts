import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { stripComments } from './config-text.js';
import { ASTRO_CONFIG_FILES, REMOVED_OPTIONS, wireAstroConfig } from './connect/astro-config.js';
import { wireDataSchemas } from './connect/data-schemas.js';
import { leftoversStep } from './connect/leftovers.js';
import type { StepResult, StepState } from './connect/step.js';
import { compareVersions } from './versions.js';

export interface MigrationContext {
  projectDir: string;
  repoRoot: string;
}

/** A migration's dry run: its edits, unwritten, and the dependencies it needs in package.json. */
export interface MigrationPlan extends StepResult {
  packages: [name: string, range: string][];
}

export interface Migration {
  id: string;
  since: string;
  description: string;
  plan(context: MigrationContext): Promise<MigrationPlan>;
}

/** Merge order: a later state outranks an earlier one. */
const SEVERITY: StepState[] = ['done', 'changed', 'needs-you', 'failed'];

/** The removed options the comment-free `source` still names. */
function removedNames(source: string): string[] {
  const code = stripComments(source);
  return [...REMOVED_OPTIONS].filter((name) => new RegExp(`\\b${name}\\b`).test(code));
}

/** The edit that drops removed options from conlocaCloud(), or needs-you when the config passes them some other way. */
async function removedOptionsStep(projectDir: string, repoRoot: string): Promise<StepResult | null> {
  const path = ASTRO_CONFIG_FILES.map((name) => join(projectDir, name)).find((file) => existsSync(file));
  if (path === undefined) return null;
  const text = await readFile(path, 'utf8');
  const names = removedNames(text);
  if (names.length === 0) return null;
  const wired = wireAstroConfig({ path, text, repoUri: null });
  if (wired.edits.some((edit) => removedNames(edit.after).length === 0)) {
    return { state: 'changed', message: wired.message, edits: wired.edits };
  }
  const file = relative(repoRoot, path);
  return {
    state: 'needs-you',
    message: `remove ${names.join(', ')} from conlocaCloud() in ${file}; @conloca/cloud-astro no longer accepts them`,
    edits: [],
    lines: [file],
  };
}

const keyless: Migration = {
  id: 'keyless',
  since: '0.2.3',
  description: 'remove the old build key from the workflows and conlocaCloud()',
  async plan({ projectDir, repoRoot }) {
    const leftovers = await leftoversStep(repoRoot);
    const config = await removedOptionsStep(projectDir, repoRoot);
    if (config === null) return { ...leftovers, packages: [] };
    const lines = [...(leftovers.lines ?? []), ...(config.lines ?? [])];
    return {
      state: SEVERITY.indexOf(config.state) > SEVERITY.indexOf(leftovers.state) ? config.state : leftovers.state,
      message: leftovers.state === 'done' ? config.message : `${leftovers.message}; ${config.message}`,
      edits: [...leftovers.edits, ...config.edits],
      ...(lines.length > 0 && { lines }),
      packages: [],
    };
  },
};

const dataSchemas: Migration = {
  id: 'data-schemas',
  since: '0.2.4',
  description: 'wire data entries and uploaded media: schemas, conlocaData() and the Typia packages',
  plan: ({ projectDir }) => wireDataSchemas(projectDir),
};

/** Every migration the running CLI ships, in release order. */
export const MIGRATIONS: readonly Migration[] = [keyless, dataSchemas];

/** The migrations a site whose oldest Conloca package is `from` still needs: every one with since > from. */
export function migrationsSince(from: string, migrations: readonly Migration[] = MIGRATIONS): Migration[] {
  return migrations.filter((migration) => compareVersions(migration.since, from) > 0);
}
