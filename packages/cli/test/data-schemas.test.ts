import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { type DataSchemasWiring, wireDataSchemas } from '../src/lib/connect/data-schemas.js';
import { writeEdits } from '../src/lib/connect/step.js';
import { readCliManifest, renderPackageJson } from '../src/lib/project-template.js';
import { CONTENT_CONFIG_TEMPLATE, DATA_SCHEMAS_TEMPLATE, renderAstroConfig } from '../src/templates/project-files.js';

/** astro.config.mjs as `conloca connect` leaves a site it set up. */
function connectedConfig(cmsOptions: string, extra = ''): string {
  return `import react from '@astrojs/react';
import { conlocaCMS } from '@conloca/astro-cms/node';
import { conlocaCloud } from '@conloca/cloud-astro';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://www.example.com',${extra}
  integrations: [
    react(),
    conlocaCMS(${cmsOptions}),
    conlocaCloud(),
  ],
});
`;
}

const STARTER_OPTIONS =
  "{ contentRoot: './content', puckConfigPath: './src/puck.config.tsx', layout: './src/layouts/Layout.astro' }";

/** The content config connect writes for a starter site. */
const CONNECT_CONTENT_CONFIG = `import { conlocaFragments, conlocaPages } from '@conloca/astro-cms/node/content';

export const collections = {
  pages: conlocaPages(),
  ...conlocaFragments(),
};
`;

const PACKAGE_JSON = `${JSON.stringify({ name: 'site', dependencies: { astro: '^7.3.1' } }, null, 2)}\n`;

const CONNECTED = {
  'package.json': PACKAGE_JSON,
  'astro.config.mjs': connectedConfig(STARTER_OPTIONS),
  'src/content.config.ts': CONNECT_CONTENT_CONFIG,
};

let dir = '';

afterEach(async () => {
  if (dir !== '') await rm(dir, { recursive: true, force: true });
  dir = '';
});

async function makeSite(files: Record<string, string>): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), 'conloca-data-schemas-'));
  await Promise.all(
    Object.entries(files).map(async ([path, text]) => {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), text);
    }),
  );
  return dir;
}

function editOf(result: DataSchemasWiring, path: string): string | undefined {
  return result.edits.find((edit) => edit.path === join(dir, path))?.after;
}

function newFiles(result: DataSchemasWiring): string[] {
  return result.edits
    .filter((edit) => edit.before === null)
    .map((edit) => relative(dir, edit.path))
    .sort();
}

/** What the package manager does for the packages the wiring asks for. */
async function addDependencies(site: string, names: string[]): Promise<void> {
  const path = join(site, 'package.json');
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  for (const name of names) manifest.dependencies[name] = '*';
  await writeFile(path, JSON.stringify(manifest));
}

describe('wireDataSchemas on a site connect set up', () => {
  test('adds schemasPath, assetsPath and the Typia plugin to astro.config', async () => {
    await makeSite(CONNECTED);
    const after = editOf(await wireDataSchemas(dir), 'astro.config.mjs');
    expect(after).toContain("schemasPath: './src/schemas/data.ts'");
    expect(after).toContain("assetsPath: './public/media'");
    expect(after).toContain('plugins: [...schemaTypia()]');
    expect(after).toContain("import { schemaTypia } from './typia-vite.mjs';");
  });

  test('declares the data collections in content.config.ts', async () => {
    await makeSite(CONNECTED);
    const after = editOf(await wireDataSchemas(dir), 'src/content.config.ts');
    expect(after).toContain('...conlocaData({ dataSchemas })');
    expect(after).toContain("import { dataSchemas } from './schemas/data';");
  });

  test('writes the schema scaffold as new files and asks for the Typia packages', async () => {
    await makeSite(CONNECTED);
    const result = await wireDataSchemas(dir);
    expect(newFiles(result)).toEqual([
      'public/media/.gitkeep',
      'src/schemas/data.ts',
      'tsconfig.typia.json',
      'typia-vite.mjs',
    ]);
    expect(result.packages).toEqual([
      ['@ttsc/unplugin', '^0.34.1'],
      ['ttsc', '0.34.1'],
      ['typia', '^14.0.4'],
    ]);
    expect(result.state).toBe('changed');
  });

  test('is done after its edits are written', async () => {
    await makeSite(CONNECTED);
    await writeEdits((await wireDataSchemas(dir)).edits);
    await addDependencies(dir, ['@ttsc/unplugin', 'ttsc', 'typia']);
    expect(await wireDataSchemas(dir)).toMatchObject({ state: 'done', edits: [], packages: [] });
  });
});

describe('wireDataSchemas on a site that already has parts of it', () => {
  test('keeps the vite plugins the site has and appends the Typia one', async () => {
    await makeSite({
      ...CONNECTED,
      'astro.config.mjs': connectedConfig(STARTER_OPTIONS, '\n  vite: { plugins: [tailwind()] },'),
    });
    const after = editOf(await wireDataSchemas(dir), 'astro.config.mjs');
    expect(after).toContain('plugins: [tailwind(), ...schemaTypia()]');
  });

  test('keeps a schemasPath of its own and imports dataSchemas from it in content.config.ts', async () => {
    await makeSite({
      ...CONNECTED,
      'astro.config.mjs': connectedConfig("{ contentRoot: './content', schemasPath: './src/cms/schemas.ts' }"),
    });
    const result = await wireDataSchemas(dir);
    expect(editOf(result, 'src/content.config.ts')).toContain("import { dataSchemas } from './cms/schemas';");
    const config = editOf(result, 'astro.config.mjs');
    expect(config).toContain("schemasPath: './src/cms/schemas.ts'");
    expect(config).not.toContain('schemaTypia');
    expect(newFiles(result)).toEqual(['public/media/.gitkeep']);
    expect(result.packages).toEqual([]);
  });

  test('never overwrites an existing src/schemas/data.ts', async () => {
    await makeSite({ ...CONNECTED, 'src/schemas/data.ts': 'export const dataSchemas = {};\n' });
    const result = await wireDataSchemas(dir);
    expect(editOf(result, 'src/schemas/data.ts')).toBeUndefined();
    expect(newFiles(result)).not.toContain('src/schemas/data.ts');
  });

  test('writes src/content.config.ts when the site has no content config', async () => {
    const { 'src/content.config.ts': _, ...withoutContentConfig } = CONNECTED;
    await makeSite(withoutContentConfig);
    expect(editOf(await wireDataSchemas(dir), 'src/content.config.ts')).toBe(CONTENT_CONFIG_TEMPLATE);
  });

  test('edits the content config the site has where it is', async () => {
    const { 'src/content.config.ts': _, ...withoutContentConfig } = CONNECTED;
    await makeSite({ ...withoutContentConfig, 'src/content/config.ts': CONNECT_CONTENT_CONFIG });
    const result = await wireDataSchemas(dir);
    expect(editOf(result, 'src/content/config.ts')).toContain("import { dataSchemas } from '../schemas/data';");
    expect(editOf(result, 'src/content.config.ts')).toBeUndefined();
  });

  test('adds conlocaData to an empty collections object', async () => {
    await makeSite({ ...CONNECTED, 'src/content.config.ts': 'export const collections = {};\n' });
    const after = editOf(await wireDataSchemas(dir), 'src/content.config.ts');
    expect(after).toContain('...conlocaData({ dataSchemas })');
    // A file without strings shows no quote style to keep, so recast picks its own.
    expect(after).toMatch(/import \{ conlocaData \} from ['"]@conloca\/astro-cms\/node\/content['"];/);
    expect(after).toMatch(/import \{ dataSchemas \} from ['"]\.\/schemas\/data['"];/);
  });

  test('puts the media folder inside a custom publicDir', async () => {
    await makeSite({
      ...CONNECTED,
      'astro.config.mjs': connectedConfig(STARTER_OPTIONS, "\n  publicDir: './static',"),
    });
    const result = await wireDataSchemas(dir);
    expect(editOf(result, 'astro.config.mjs')).toContain("assetsPath: './static/media'");
    expect(newFiles(result)).toContain('static/media/.gitkeep');
  });
});

describe('wireDataSchemas on a site made with conloca create', () => {
  test('is done', async () => {
    await makeSite({
      'package.json': renderPackageJson({ name: 'site', manifest: await readCliManifest() }),
      'astro.config.mjs': renderAstroConfig('default'),
      'src/content.config.ts': CONTENT_CONFIG_TEMPLATE,
      'src/schemas/data.ts': DATA_SCHEMAS_TEMPLATE,
      'public/media/.gitkeep': '',
    });
    expect(await wireDataSchemas(dir)).toMatchObject({ state: 'done', edits: [], packages: [] });
  });
});

describe('wireDataSchemas on a config it cannot edit', () => {
  test('needs you, with the lines to add, and writes nothing', async () => {
    await makeSite({ ...CONNECTED, 'astro.config.mjs': 'export default makeConfig();\n' });
    const result = await wireDataSchemas(dir);
    expect(result.state).toBe('needs-you');
    expect(result.edits).toEqual([]);
    expect(result.lines?.join('\n')).toContain("schemasPath: './src/schemas/data.ts'");
  });

  test('needs you when publicDir is computed', async () => {
    await makeSite({
      ...CONNECTED,
      'astro.config.mjs': connectedConfig(STARTER_OPTIONS, "\n  publicDir: resolve('x'),"),
    });
    const result = await wireDataSchemas(dir);
    expect(result.state).toBe('needs-you');
    expect(result.edits).toEqual([]);
    expect(result.message).toContain('publicDir');
  });
});
