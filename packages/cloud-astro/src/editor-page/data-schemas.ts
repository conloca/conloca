import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isRecord } from '@conloca/content-api/component-vocabulary';
import { DATA_SCHEMAS_FILE } from '@conloca/content-api/editor-host';
import { runnerImport, type UserConfig } from 'vite';
import { PACKAGE_NAME } from '../constants.js';
import { messageOf } from '../message-of.js';

/** The schemas module's exports the editor page uses, or why it failed to load. */
export type LoadedSchemasModule = { dataSchemas: unknown; mdxComponents: unknown } | { error: string };

/**
 * Loads the schemas module through the site's own Vite plugins, as the content config does, so schema generators such
 * as typia's transform apply. Never throws: a failed load is returned as its message.
 */
export async function loadSchemasModule(input: {
  root: string;
  vite: UserConfig;
  schemasPath: string;
}): Promise<LoadedSchemasModule> {
  try {
    // shortcut: runnerImport resolves plugins in serve mode, so an apply: 'build' schema transform is skipped (warning, no file); upgrade if a site needs one.
    const { module } = await runnerImport<{ dataSchemas?: unknown; mdxComponents?: unknown }>(
      resolve(input.root, input.schemasPath),
      { ...input.vite, configFile: false, root: input.root, logLevel: 'warn' },
    );
    return { dataSchemas: module.dataSchemas, mdxComponents: module.mdxComponents };
  } catch (error) {
    return { error: messageOf(error) };
  }
}

/**
 * Writes `<folder>/data-schemas.json`: the JSON schema `metadata` of each `dataSchemas` collection in the loaded
 * schemas module, in the module's order. A module that failed to load costs the file, not the build.
 */
export async function emitDataSchemas(input: {
  folder: string;
  schemasPath: string;
  loaded: LoadedSchemasModule;
  logger: { warn(message: string): void };
}): Promise<void> {
  const { loaded } = input;
  if ('error' in loaded) {
    input.logger.warn(
      `${PACKAGE_NAME}: the schemas module at ${input.schemasPath} failed to load, so ${DATA_SCHEMAS_FILE} is not written: ${loaded.error}`,
    );
    return;
  }
  const { dataSchemas } = loaded;
  if (!isRecord(dataSchemas)) return;
  const collections = Object.fromEntries(
    Object.entries(dataSchemas).flatMap(([name, entry]) => {
      const metadata = isRecord(entry) ? entry.metadata : undefined;
      return isRecord(metadata) && isRecord(metadata.schema) && isRecord(metadata.components)
        ? [[name, metadata] as const]
        : [];
    }),
  );
  await writeFile(join(input.folder, DATA_SCHEMAS_FILE), `${JSON.stringify({ collections }, null, 2)}\n`);
}
