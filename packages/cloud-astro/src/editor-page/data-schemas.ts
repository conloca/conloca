import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isRecord } from '@conloca/content-api/component-vocabulary';
import { DATA_SCHEMAS_FILE } from '@conloca/content-api/editor-host';
import { runnerImport, type UserConfig } from 'vite';
import { PACKAGE_NAME } from '../constants.js';
import { messageOf } from '../message-of.js';

/**
 * Writes `<folder>/data-schemas.json`: the JSON schema `metadata` of each `dataSchemas` collection in the schemas
 * module, in the module's order. The module runs through the site's own Vite plugins, as the content config does, so
 * schema generators such as typia's transform apply. A module that fails to load costs the file, not the build.
 */
export async function emitDataSchemas(input: {
  folder: string;
  root: string;
  vite: UserConfig;
  schemasPath: string;
  logger: { warn(message: string): void };
}): Promise<void> {
  let dataSchemas: unknown;
  try {
    // shortcut: runnerImport resolves plugins in serve mode, so an apply: 'build' schema transform is skipped (warning, no file); upgrade if a site needs one.
    const { module } = await runnerImport<{ dataSchemas?: unknown }>(resolve(input.root, input.schemasPath), {
      ...input.vite,
      configFile: false,
      root: input.root,
      logLevel: 'warn',
    });
    dataSchemas = module.dataSchemas;
  } catch (error) {
    input.logger.warn(
      `${PACKAGE_NAME}: the schemas module at ${input.schemasPath} failed to load, so ${DATA_SCHEMAS_FILE} is not written: ${messageOf(error)}`,
    );
    return;
  }
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
