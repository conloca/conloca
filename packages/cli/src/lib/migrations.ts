import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { callOptions, parseObjectEntries, stringLiteral, stripComments } from './config-text.js';
import { addAdapterStep } from './connect/adapter.js';
import {
  ASTRO_CONFIG_FILES,
  REMOVED_OPTIONS,
  removedKeyOptions,
  wireAstroConfig,
  withoutPreviewBuildOptions,
} from './connect/astro-config.js';
import { wireDataSchemas } from './connect/data-schemas.js';
import { D2_ENTRY, D8_ENTRY, foldersUp, isStarterFile } from './connect/host.js';
import { leftoversStep } from './connect/leftovers.js';
import { previewBuildKeys, previewSetupOf, siteAdapterOf } from './connect/preview-deploy.js';
import type { FileEdit, StepResult, StepState } from './connect/step.js';
import { contentRootOf } from './content-root.js';
import { siteDomainsOf } from './sites-config.js';
import { compareVersions, D8_SINCE } from './versions.js';

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
  /** The package whose release `since` introduced this migration. */
  package: string;
  since: string;
  description: string;
  plan(context: MigrationContext): Promise<MigrationPlan>;
}

/** Merge order: a later state outranks an earlier one. */
const SEVERITY: StepState[] = ['done', 'changed', 'needs-you', 'failed'];

/**
 * The removed options `source` still gives conlocaCloud(). When its options cannot be read, the whole comment-free file,
 * leaving out fragmentPreviewRoute: conlocaCMS() still takes that one.
 */
function removedNames(source: string): string[] {
  const passed = removedKeyOptions(source);
  if (passed !== null) return passed;
  const code = stripComments(source);
  return [...REMOVED_OPTIONS].filter(
    (name) => name !== 'fragmentPreviewRoute' && new RegExp(`\\b${name}\\b`).test(code),
  );
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
  package: '@conloca/cloud-astro',
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
  package: '@conloca/astro-cms',
  since: '0.2.4',
  description: 'wire data entries and uploaded media: schemas, conlocaData() and the Typia packages',
  plan: ({ projectDir }) => wireDataSchemas(projectDir),
};

/** previewBuild options the site's own build ignores. */
const DEAD_PREVIEW_OPTIONS: ReadonlySet<string> = new Set(['adapter', 'config', 'outDir', 'required']);
const D8_NOTES = [
  'open preview tabs from before this upgrade stop working; editors reopen Preview',
  'the preview mode already changed when @conloca/cloud-astro was updated: the next build serves d8, or turns preview off while previewBuild.adapter remains',
];

/** The repository's Dockerfiles, package.json, Procfile and fly.toml that start the D2 preview server, pointed at d8's. */
async function startCommandEdits(dirs: string[]): Promise<FileEdit[]> {
  const listed = await Promise.all(
    dirs.map(async (dir) =>
      (await readdir(dir, { withFileTypes: true }).catch(() => []))
        .filter((entry) => entry.isFile())
        .filter(({ name }) => isStarterFile(name))
        .map(({ name }) => join(dir, name)),
    ),
  );
  const paths = listed.flat();
  const texts = await Promise.all(paths.map((path) => readFile(path, 'utf8')));
  return paths.flatMap((path, index) => {
    const before = texts[index] ?? '';
    return before.includes(D2_ENTRY) ? [{ path, before, after: before.replaceAll(D2_ENTRY, D8_ENTRY) }] : [];
  });
}

const done = (message: string): MigrationPlan => ({ state: 'done', message, edits: [], packages: [] });
const needs = (message: string): MigrationPlan => ({ state: 'needs-you', message, edits: [], packages: [] });

const d8: Migration = {
  id: 'd8',
  package: '@conloca/cloud-astro',
  since: D8_SINCE,
  description: "move draft preview into the site's own build (d8)",
  async plan({ projectDir, repoRoot }) {
    const path = ASTRO_CONFIG_FILES.map((name) => join(projectDir, name)).find((file) => existsSync(file));
    if (path === undefined) return done('no astro.config');
    const text = await readFile(path, 'utf8');
    const code = stripComments(text);
    const integration = callOptions(code, 'conlocaCloud');
    const raw = integration.state === 'literal' ? integration.entries.get('previewBuild') : undefined;
    if (raw === undefined || raw.trim() === 'false') return done('no draft preview build to move');
    const adapter = siteAdapterOf(callOptions(code, 'defineConfig'), code);
    const keys = previewBuildKeys(raw);
    const own = parseObjectEntries(raw.trim());
    const previewAdapter =
      own === null ? undefined : siteAdapterOf({ state: 'literal', entries: own.entries, hasSpread: false }, code);
    if (adapter === undefined && previewAdapter === '@astrojs/cloudflare' && !keys.separate) {
      return needs(
        [
          'a static site previews next to itself on Cloudflare (D3): remove previewBuild.adapter and run conloca connect',
          ...D8_NOTES,
        ].join('; '),
      );
    }
    if (adapter === undefined && keys.adapter && !keys.separate) {
      return needs(
        [
          'a static site on its own server has no same-address preview: use previewBuild: { separate: true } (a Cloudflare preview deploy) or remove previewBuild',
          ...D8_NOTES,
        ].join('; '),
      );
    }
    const file = relative(repoRoot, path);
    const setup = previewSetupOf(integration, callOptions(code, 'defineConfig'), null, code);
    // A separate preview deploy keeps its options; only the adapter the build refuses goes.
    if (setup.kind === 'd4' && keys.adapter) {
      const dropped = withoutPreviewBuildOptions(text, new Set(['adapter']));
      if (dropped === null) return done('no D2 preview server to move');
      if (dropped === 'computed') return needs(`remove adapter from previewBuild in conlocaCloud() in ${file}`);
      return {
        state: 'changed',
        message:
          'removed previewBuild.adapter, which the build refuses: the separate preview deploy builds with the adapter in astro.config',
        edits: [{ path, before: text, after: dropped.after }],
        packages: [],
      };
    }
    // Only a D2 site (previewBuild.adapter beside the site's adapter) or a d8 one: D3 and D4 still use these options.
    const d2 = setup.kind === 'off' && setup.refusal !== undefined && !keys.separate;
    if (!d2 && setup.kind !== 'd8') return done('no D2 preview server to move');
    const dropped = withoutPreviewBuildOptions(text, DEAD_PREVIEW_OPTIONS);
    if (
      dropped === 'computed' &&
      [...DEAD_PREVIEW_OPTIONS].some((name) => new RegExp(`\\b${name}\\s*:`, 'u').test(raw))
    ) {
      return needs(
        `remove adapter, config, outDir and required from previewBuild in conlocaCloud() in ${file}: drafts render in the site's own build`,
      );
    }
    let after = typeof dropped === 'object' && dropped !== null ? dropped.after : text;
    const notes = after === text ? [] : ['removed the previewBuild options the site build ignores'];
    let starts: FileEdit[] = [];
    if (adapter === '@astrojs/node') {
      const cms = callOptions(code, 'conlocaCMS');
      const root = cms.state === 'literal' ? stringLiteral(cms.entries.get('contentRoot') ?? '') : null;
      const sites = join(root === null ? contentRootOf(projectDir) : resolve(projectDir, root), 'sites.json');
      const sitesText = await readFile(sites, 'utf8').catch(() => '');
      const node = addAdapterStep({
        path,
        text: after,
        host: 'node',
        siteDomains: siteDomainsOf(sitesText),
        astroVersion: '',
        yes: true,
      });
      if (node.state === 'needs-you') return needs([node.message, ...D8_NOTES].join('; '));
      if (node.state === 'changed') notes.push('added security.allowedDomains');
      after = node.edits[0]?.after ?? after;
      starts = await startCommandEdits(foldersUp(projectDir, repoRoot));
      if (starts.length > 0) notes.push(`the start command is now ${D8_ENTRY}`);
      for (const edit of starts) {
        if (edit.after.includes('.conloca/preview-server')) {
          notes.push(
            `${relative(repoRoot, edit.path)} still names .conloca/preview-server: make sure dist/server is in the image`,
          );
        }
      }
    }
    const edits = [...(after === text ? [] : [{ path, before: text, after }]), ...starts];
    if (edits.length === 0) return done("draft preview already renders in the site's own build (d8)");
    // Not a stop: the start command may also live in a host dashboard, which only the site owner can change.
    const reminder =
      adapter === '@astrojs/node'
        ? [`if your host's dashboard, or any other file, starts ${D2_ENTRY}, change it to ${D8_ENTRY}`]
        : [];
    return { state: 'changed', message: [...notes, ...reminder, ...D8_NOTES].join('; '), edits, packages: [] };
  },
};

/** Every migration the running CLI ships, in release order. */
export const MIGRATIONS: readonly Migration[] = [keyless, dataSchemas, d8];

/**
 * The migrations a site still needs, given the lowest version it declares of each Conloca package: every one whose
 * package is below its `since`. A site that does not declare a migration's package skips it.
 */
export function migrationsSince(
  floors: ReadonlyMap<string, string>,
  migrations: readonly Migration[] = MIGRATIONS,
): Migration[] {
  return migrations.filter((migration) => {
    const floor = floors.get(migration.package);
    return floor !== undefined && compareVersions(migration.since, floor) > 0;
  });
}
