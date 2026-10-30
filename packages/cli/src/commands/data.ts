import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fail, withStdoutRedirected } from '../lib/cli-output.js';
import { callOptions, stringLiteral, stripComments } from '../lib/config-text.js';
import { ASTRO_CONFIG_FILES } from '../lib/connect/astro-config.js';
import { wireDataSchemas } from '../lib/connect/data-schemas.js';
import { writeEdits } from '../lib/connect/step.js';
import { contentRootOf } from '../lib/content-root.js';
import { updateDataEntry, writeDataEntry } from '../lib/data-write.js';
import { isRecord } from '../lib/is-record.js';
import { readJsonInput } from '../lib/json-input.js';
import { messageOf } from '../lib/message-of.js';
import { lockfileInstall, packageManagerCommands } from '../lib/package-manager.js';
import { PageWriteError } from '../lib/page-write.js';
import { gitText, terminalIo } from './connect.js';

export interface DataCreateOptions {
  site: string;
  name: string;
  title?: string;
  /** A JSON file, or '-' for stdin. */
  data: string;
  install: boolean;
  json: boolean;
}

export interface DataUpdateOptions {
  site: string;
  title?: string;
  /** A JSON file, or '-' for stdin. */
  data: string;
  json: boolean;
}

/** The JSON object `--data` points at; refuses anything else. */
async function readDataInput(source: string): Promise<Record<string, unknown>> {
  const value = await readJsonInput(source, '--data');
  if (!isRecord(value)) throw new PageWriteError('invalid_input', '--data must be a JSON object', '--data');
  return value;
}

/**
 * Wire the site for data entries when it is not yet: writes the wiring, then adds the packages it needs, or returns
 * that command when `install` is off. Exits through `fail` when the site's config needs a hand or the install fails.
 * `files` are relative to the project.
 */
export async function ensureDataWiring(
  projectDir: string,
  options: { json: boolean; install: boolean },
): Promise<{ files: string[]; command?: string }> {
  const dir = resolve(projectDir);
  const wiring = await wireDataSchemas(dir);
  if (wiring.state === 'done') return { files: [] };
  if (wiring.state !== 'changed') {
    fail(options.json, [wiring.message, ...(wiring.lines ?? []).map((line) => `  ${line}`)].join('\n'));
  }
  await writeEdits(wiring.edits);
  const files = wiring.edits.map((edit) => relative(dir, edit.path));
  if (wiring.packages.length === 0) return { files };

  // --show-cdup, as runConnect: the top level comes back with symlinks resolved.
  const up = await gitText(['rev-parse', '--show-cdup'], dir);
  const repoRoot = up === null ? null : resolve(dir, up);
  const commands = packageManagerCommands(lockfileInstall(dir, repoRoot ?? dir)?.packageManager ?? 'npm');
  const command = `${commands.add} ${wiring.packages.map(([name, range]) => `'${name}@${range}'`).join(' ')}`;
  if (!options.install) return { files, command };
  if (!(await terminalIo(options.json).run(command, dir))) {
    fail(options.json, `${command} failed; the wiring is written, run it again`);
  }
  return { files };
}

/**
 * A warning when the module the config's `schemasPath` names plainly does not declare `collection`, so the build
 * would fail on the new entry; null when it does or when the config does not name one plainly.
 */
async function undeclaredDataWarning(projectDir: string, collection: string): Promise<string | null> {
  const configFile = ASTRO_CONFIG_FILES.map((name) => join(projectDir, name)).find((path) => existsSync(path));
  if (configFile === undefined) return null;
  const options = callOptions(stripComments(await readFile(configFile, 'utf8')), 'conlocaCMS');
  const schemasPath = options.state === 'literal' ? stringLiteral(options.entries.get('schemasPath') ?? '') : null;
  if (schemasPath === null) return null;
  const path = resolve(projectDir, schemasPath);
  const text = await readFile(path, 'utf8');
  if (text.includes(`${collection}:`)) return null;
  return (
    `${relative(projectDir, path)} declares no data collection "${collection}", so the build fails on this entry. ` +
    'Add a type for it and a defineHostSchema entry to dataSchemas.'
  );
}

/** Create the data entry `name` in `collection`, wiring the site's data schemas first when it has none. */
export async function dataCreate(collection: string, directory: string, options: DataCreateOptions): Promise<void> {
  const { json } = options;
  try {
    const data = await readDataInput(options.data);
    const projectDir = resolve(directory);
    // Outside withStdoutRedirected: it may fail, and fail's --json report belongs on stdout.
    const wiring = await ensureDataWiring(projectDir, options);
    const written = await withStdoutRedirected(json, () =>
      writeDataEntry({
        contentRoot: contentRootOf(directory),
        site: options.site,
        collection,
        name: options.name,
        title: options.title,
        data,
      }),
    );
    const relPath = relative(process.cwd(), written.filePath);
    // Advisory only: the entry is already written, so a failed check stays silent.
    const warning = await undeclaredDataWarning(projectDir, collection).catch(() => null);

    if (json) {
      console.log(
        JSON.stringify({
          ok: true,
          id: written.id,
          path: relPath,
          ...(wiring.files.length > 0 ? { wired: wiring.files } : {}),
          ...(wiring.command === undefined ? {} : { command: wiring.command }),
          ...(warning ? { warnings: [warning] } : {}),
        }),
      );
    } else {
      if (wiring.files.length > 0) console.log(`✓ Wired data schemas: ${wiring.files.join(', ')}`);
      if (wiring.command !== undefined) console.log(`  Add their packages: ${wiring.command}`);
      console.log(`✓ Created data entry ${collection}/${options.name} (${written.id})`);
      console.log(`  File: ${relPath}`);
    }
    if (warning) console.error(`Warning: ${warning}`);
  } catch (error) {
    fail(json, messageOf(error), error instanceof PageWriteError ? error.field : undefined);
  }
}

/** Replace the data of the entry `ref` (an id or a name) in `collection`. Never wires: such an entry exists only on a wired site. */
export async function dataUpdate(
  collection: string,
  ref: string,
  directory: string,
  options: DataUpdateOptions,
): Promise<void> {
  const { json } = options;
  try {
    const data = await readDataInput(options.data);
    const written = await withStdoutRedirected(json, () =>
      updateDataEntry({
        contentRoot: contentRootOf(directory),
        site: options.site,
        collection,
        ref,
        title: options.title,
        data,
      }),
    );
    const relPath = relative(process.cwd(), written.filePath);
    if (json) {
      console.log(JSON.stringify({ ok: true, id: written.id, path: relPath }));
    } else {
      console.log(`✓ Updated data entry ${written.id} in ${collection}`);
      console.log(`  File: ${relPath}`);
    }
  } catch (error) {
    fail(json, messageOf(error), error instanceof PageWriteError ? error.field : undefined);
  }
}
