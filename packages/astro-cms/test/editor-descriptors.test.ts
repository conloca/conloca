import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EDITOR_DESCRIPTORS_ENV_VAR, readEditorDescriptors } from '../src/editor-descriptors.js';
import { conlocaCMS } from '../src/plugin-spa.js';

const registry = { contentRoot: './content', componentFolders: ['src/components/mdx'], projectRoot: '/site' };

describe('readEditorDescriptors', () => {
  it('reads back exactly what conlocaCMS published', () => {
    const raw = JSON.stringify({ schemasPath: '/site/src/schemas/data.ts', registry });

    expect(readEditorDescriptors({ [EDITOR_DESCRIPTORS_ENV_VAR]: raw })).toEqual({
      schemasPath: '/site/src/schemas/data.ts',
      registry,
    });
  });

  it('returns undefined when the channel is absent — a CMS-less build', () => {
    expect(readEditorDescriptors({})).toBeUndefined();
  });

  it('returns undefined for malformed JSON instead of failing the build', () => {
    expect(readEditorDescriptors({ [EDITOR_DESCRIPTORS_ENV_VAR]: '{not json' })).toBeUndefined();
  });

  it('returns undefined when the scan inputs are not the expected shape', () => {
    const raw = JSON.stringify({ registry: { contentRoot: './content', componentFolders: 'nope' } });

    expect(readEditorDescriptors({ [EDITOR_DESCRIPTORS_ENV_VAR]: raw })).toBeUndefined();
  });

  it('drops a non-string schemasPath rather than handing it to esbuild', () => {
    const raw = JSON.stringify({ schemasPath: 42, registry });

    expect(readEditorDescriptors({ [EDITOR_DESCRIPTORS_ENV_VAR]: raw })).toEqual({ registry });
  });

  it('reads back the data bindings an editor builds its data context from', () => {
    const dataBindings = { siteName: 'default', locale: 'en', routes: { pages: { pages: { prefix: '/' } } } };
    const raw = JSON.stringify({ registry, dataBindings });

    expect(readEditorDescriptors({ [EDITOR_DESCRIPTORS_ENV_VAR]: raw })).toEqual({ registry, dataBindings });
  });

  it('drops data bindings with no site name and keeps the rest of the channel', () => {
    const raw = JSON.stringify({ registry, dataBindings: { locale: 'en', routes: {} } });

    expect(readEditorDescriptors({ [EDITOR_DESCRIPTORS_ENV_VAR]: raw })).toEqual({ registry });
  });

  it('carries the options a build add-on inherits, exactly as published', () => {
    const channel = {
      puckConfigPath: '/abs/src/puck.config.tsx',
      siteStyles: ['/abs/src/styles/site.scss', '/abs/src/styles/print.css'],
      editorStyles: ['/abs/asides.css'],
      editorCSS: 'body{color:red}',
      registry: { contentRoot: '/abs/content', componentFolders: ['src/components/mdx'] },
    };

    const read = readEditorDescriptors({ [EDITOR_DESCRIPTORS_ENV_VAR]: JSON.stringify(channel) });

    expect(read).toEqual(channel);
  });

  it('drops a malformed style list and a non-string puckConfigPath but keeps the rest', () => {
    const raw = {
      puckConfigPath: 42,
      siteStyles: ['/abs/a.css', 7],
      editorStyles: 'x',
      editorCSS: 3,
      registry: { contentRoot: '/c', componentFolders: [] },
    };

    const read = readEditorDescriptors({ [EDITOR_DESCRIPTORS_ENV_VAR]: JSON.stringify(raw) });

    expect(read).toEqual({ registry: { contentRoot: '/c', componentFolders: [] } });
  });

  it('drops a malformed contentPaths and keeps the rest of the channel', () => {
    const raw = { registry, contentPaths: ['relative'] };

    expect(readEditorDescriptors({ [EDITOR_DESCRIPTORS_ENV_VAR]: JSON.stringify(raw) })).toEqual({ registry });
  });
});

const noop = () => {};

describe('the content paths conlocaCMS publishes', () => {
  const originalCwd = process.cwd();
  // The config hook publishes these two; restore each so the run does not leak into other test files.
  const originalEnv = {
    CONLOCA_CONTENT_ROOT: process.env.CONLOCA_CONTENT_ROOT,
    [EDITOR_DESCRIPTORS_ENV_VAR]: process.env[EDITOR_DESCRIPTORS_ENV_VAR],
  };
  let projectRoot = '';
  afterEach(() => {
    process.chdir(originalCwd);
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(projectRoot, { recursive: true, force: true });
  });

  /** A temp Astro project laid out like the website, then the build's config hook run in it. */
  async function publishFrom(mdxPages: string | undefined, assetsPath?: string): Promise<string[] | undefined> {
    const sites = { sites: { default: { locales: ['en'], defaultLocale: 'en', mdxPages } }, globalLocales: ['en'] };
    projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'conloca-content-paths-')));
    mkdirSync(join(projectRoot, 'content'), { recursive: true });
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    writeFileSync(join(projectRoot, 'content', 'sites.json'), JSON.stringify(sites));
    writeFileSync(
      join(projectRoot, 'src', 'content.config.ts'),
      "import { createConlocaCollections } from '@conloca/astro-cms/node/content';\n" +
        'export const { collections } = await createConlocaCollections();\n',
    );
    process.chdir(projectRoot);
    const integration = conlocaCMS({
      contentRoot: './content',
      puckConfigPath: './src/puck.config.tsx',
      ...(assetsPath ? { assetsPath } : {}),
    });
    // SAFETY: the setup hook reads only the config fields, callbacks, command and logger stubbed here.
    // oxlint-disable typescript/no-unsafe-type-assertion -- same reason as the SAFETY note.
    await integration.hooks['astro:config:setup']?.({
      config: {
        output: 'static',
        root: pathToFileURL(`${projectRoot}/`),
        publicDir: pathToFileURL(`${projectRoot}/public/`),
        base: '/',
      },
      updateConfig: noop,
      injectRoute: noop,
      command: 'build',
      logger: { info: noop, warn: noop, error: noop, debug: noop },
    } as never);
    // oxlint-enable typescript/no-unsafe-type-assertion
    return readEditorDescriptors(process.env)?.contentPaths;
  }

  it("publishes the website's real relative configuration as absolute content paths, and reads them back", async () => {
    const paths = await publishFrom('./src/content/docs', './public/assets');

    expect(paths).toEqual([
      join(projectRoot, 'content'),
      join(projectRoot, 'src/content/docs'),
      join(projectRoot, 'public/assets'),
    ]);
  });

  it('publishes only the content root when no site declares mdxPages and no assetsPath is set', async () => {
    const paths = await publishFrom(undefined);

    expect(paths).toEqual([join(projectRoot, 'content')]);
  });
});
