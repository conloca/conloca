import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { type ASTNode, type ProxifiedModule, parseModule } from 'magicast';
import {
  CONTENT_CONFIG_TEMPLATE,
  DATA_SCHEMAS_TEMPLATE,
  TYPIA_TSCONFIG_TEMPLATE,
  TYPIA_VITE_TEMPLATE,
} from '../../templates/project-files.js';
import { callOptions, containsOutsideStrings, stripComments } from '../config-text.js';
import { isRecord } from '../is-record.js';
import { THIRD_PARTY_VERSIONS } from '../project-template.js';
import {
  ASTRO_CONFIG_FILES,
  DEFAULT_SCHEMAS_PATH,
  objectProperties,
  printModule,
  wireDataSchemaOptions,
} from './astro-config.js';
import type { FileEdit, StepResult } from './step.js';

/** The wiring's edits plus the packages to add to `dependencies`; nothing is written or installed. */
export interface DataSchemasWiring extends StepResult {
  packages: [name: string, range: string][];
}

/** What typia-vite.mjs compiles the default schemas with, sorted by name. */
const TYPIA_PACKAGES = ['@ttsc/unplugin', 'ttsc', 'typia'] as const;

const CONTENT_SOURCE = '@conloca/astro-cms/node/content';

/** Declare the data collections in the content config Astro loads, importing `dataSchemas` from `schemasPath`. */
async function contentConfigStep(projectDir: string, schemasPath: string): Promise<StepResult> {
  // Lazy, as in doctor: only the commands that read a site's config load @conloca/astro-cms.
  const { findContentConfig } = await import('@conloca/astro-cms/checks');
  const found = findContentConfig(projectDir);
  const path = found ?? join(projectDir, 'src', 'content.config.ts');
  const target = relative(dirname(path), resolve(projectDir, schemasPath).replace(/\.[cm]?[jt]sx?$/, ''));
  const specifier = target.startsWith(`..${sep}`) ? target.split(sep).join('/') : `./${target.split(sep).join('/')}`;
  if (found === null) {
    const after = CONTENT_CONFIG_TEMPLATE.replace("'./schemas/data'", `'${specifier}'`);
    return {
      state: 'changed',
      message: `writes ${relative(projectDir, path)}`,
      edits: [{ path, before: null, after }],
    };
  }
  const text = await readFile(found, 'utf8');
  const name = relative(projectDir, found);
  if (containsOutsideStrings(stripComments(text), 'conlocaData(')) {
    return { state: 'done', message: `${name} already declares the data collections`, edits: [] };
  }
  let mod: ProxifiedModule | undefined;
  try {
    mod = parseModule(text);
  } catch {
    mod = undefined;
  }
  const program: ASTNode | undefined = mod?.$ast;
  const declarations =
    program?.type === 'Program'
      ? program.body.flatMap((statement) =>
          statement.type === 'ExportNamedDeclaration' && statement.declaration?.type === 'VariableDeclaration'
            ? statement.declaration.declarations
            : [],
        )
      : [];
  const init = declarations.find((d) => d.id.type === 'Identifier' && d.id.name === 'collections')?.init;
  if (mod === undefined || init?.type !== 'ObjectExpression') {
    return {
      state: 'needs-you',
      message: `${name} has no plain \`export const collections = { ... }\` to declare the data collections in: add these lines`,
      lines: [
        `import { conlocaData } from '${CONTENT_SOURCE}';`,
        `import { dataSchemas } from '${specifier}';`,
        '',
        '// in export const collections = { ... }',
        '...conlocaData({ dataSchemas }),',
      ],
      edits: [],
    };
  }
  init.properties.push(...objectProperties('...conlocaData({ dataSchemas })'));
  mod.imports.$append({ from: CONTENT_SOURCE, imported: 'conlocaData', local: 'conlocaData' });
  mod.imports.$append({ from: specifier, imported: 'dataSchemas', local: 'dataSchemas' });
  return {
    state: 'changed',
    message: `declared the data collections in ${name}`,
    edits: [{ path: found, before: text, after: printModule(mod, text) }],
  };
}

/**
 * Wire a connected site for data entries and uploaded media: `schemasPath`, `assetsPath` and the Typia vite plugin in
 * astro.config, `conlocaData()` in the content config, the starter schema files, and the Typia packages. Writes and
 * installs nothing; existing files are never overwritten, and a site already wired comes back `done`.
 */
export async function wireDataSchemas(projectDir: string): Promise<DataSchemasWiring> {
  const configFile = ASTRO_CONFIG_FILES.map((name) => join(projectDir, name)).find((path) => existsSync(path));
  if (configFile === undefined) {
    return { state: 'failed', message: `no astro.config in ${projectDir}`, edits: [], packages: [] };
  }
  const text = await readFile(configFile, 'utf8');
  const options = wireDataSchemaOptions({ path: configFile, text });
  if (options.schemasPath === null || options.assetsPath === null) return { ...options, packages: [] };
  const { schemasPath, assetsPath } = options;
  const content = await contentConfigStep(projectDir, schemasPath);
  if (content.state === 'needs-you') return { ...content, packages: [] };

  const own = callOptions(stripComments(text), 'conlocaCMS');
  const had = (name: string) => own.state === 'literal' && own.entries.has(name);
  const scaffold: [file: string, text: string][] = [];
  if (!had('schemasPath')) {
    scaffold.push(
      [schemasPath, DATA_SCHEMAS_TEMPLATE],
      ['typia-vite.mjs', TYPIA_VITE_TEMPLATE],
      ['tsconfig.typia.json', TYPIA_TSCONFIG_TEMPLATE],
    );
  }
  if (!had('assetsPath') && !existsSync(resolve(projectDir, assetsPath))) {
    scaffold.push([join(assetsPath, '.gitkeep'), '']);
  }
  const files: FileEdit[] = scaffold
    .map(([file, after]) => ({ path: resolve(projectDir, file), before: null, after }))
    .filter((edit) => !existsSync(edit.path));

  let packages: [string, string][] = [];
  if (schemasPath === DEFAULT_SCHEMAS_PATH) {
    const manifest: unknown = JSON.parse(await readFile(join(projectDir, 'package.json'), 'utf8').catch(() => '{}'));
    const declared = isRecord(manifest) ? [manifest.dependencies, manifest.devDependencies].filter(isRecord) : [];
    packages = TYPIA_PACKAGES.filter((name) => !declared.some((list) => name in list)).map((name) => [
      name,
      THIRD_PARTY_VERSIONS[name],
    ]);
  }

  const edits = [...options.edits, ...content.edits, ...files];
  const notes = [options, content].filter((part) => part.edits.length > 0).map((part) => part.message);
  if (files.length > 0) notes.push(`writes ${files.map((edit) => relative(projectDir, edit.path)).join(', ')}`);
  if (packages.length > 0) notes.push(`adds ${packages.map(([name]) => name).join(', ')}`);
  return edits.length === 0 && packages.length === 0
    ? { state: 'done', message: 'the data schemas and the media folder are wired', edits, packages }
    : { state: 'changed', message: notes.join('; '), edits, packages };
}
