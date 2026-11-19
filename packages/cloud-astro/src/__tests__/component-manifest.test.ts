import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COMPONENT_MANIFEST_LIMITS } from '@conloca/content-api/component-vocabulary';
import { EDITOR_PAGE_INFO_FORMATS } from '@conloca/content-api/editor-host';
import { emitComponentManifest } from '../component-manifest.js';

function makeLogger() {
  const infos: string[] = [];
  const warnings: string[] = [];
  return { info: (m: string) => infos.push(m), warn: (m: string) => warnings.push(m), infos, warnings };
}

async function readWritten(root: string, artifact: { url: string } | undefined) {
  if (artifact === undefined) throw new Error('expected an artifact');
  return JSON.parse(await readFile(join(root, 'dist', artifact.url), 'utf8'));
}

describe('emitComponentManifest', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'component-manifest-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes the config vocabulary as a content-addressed artifact under _conloca', async () => {
    await writeFile(
      join(root, 'puck.config.tsx'),
      "export default { components: { Hero: { fields: { title: { type: 'text' } } } } };\n",
    );
    const logger = makeLogger();
    const artifact = await emitComponentManifest({
      dir: join(root, 'dist'),
      puckConfigPath: 'puck.config.tsx',
      projectRoot: root,
      vite: {},
      logger,
    });
    expect(artifact?.url).toMatch(/^\/_conloca\/component-manifest\.[0-9a-f]{16}\.json$/);
    if (artifact === undefined) throw new Error('expected an artifact');
    const bytes = await readFile(join(root, 'dist', artifact.url));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(artifact.hash);
    expect(JSON.parse(bytes.toString('utf8')).components.Hero.fields.title.type).toBe('text');
    expect(logger.infos.some((m) => m.includes('(1 components, 0 fragment components)'))).toBe(true);
    expect(logger.warnings).toEqual([]);
  });

  it('ships the manifest of a config it cannot read, and says why in the build log', async () => {
    const logger = makeLogger();
    const artifact = await emitComponentManifest({
      dir: join(root, 'dist'),
      puckConfigPath: 'missing.config.tsx',
      projectRoot: root,
      vite: {},
      logger,
    });
    if (artifact === undefined) throw new Error('expected an artifact');
    const manifest = JSON.parse(await readFile(join(root, 'dist', artifact.url), 'utf8'));
    expect(manifest.unreadable).toBe(true);
    expect(logger.warnings.some((m) => m.startsWith('component manifest is incomplete: '))).toBe(true);
  });

  it('names each component it could not resolve', async () => {
    await writeFile(
      join(root, 'puck.config.tsx'),
      "import { Hero } from './nowhere';\nexport default { components: { Hero } };\n",
    );
    const logger = makeLogger();
    await emitComponentManifest({
      dir: join(root, 'dist'),
      puckConfigPath: 'puck.config.tsx',
      projectRoot: root,
      vite: {},
      logger,
    });
    expect(logger.warnings.some((m) => m.startsWith('component Hero could not be read'))).toBe(true);
  });

  it('writes into the folder it is given', async () => {
    await writeFile(join(root, 'puck.config.tsx'), 'export default { components: {} };\n');
    const artifact = await emitComponentManifest({
      dir: join(root, 'dist'),
      folder: '_conloca/editor',
      puckConfigPath: 'puck.config.tsx',
      projectRoot: root,
      vite: {},
      logger: makeLogger(),
    });
    if (artifact === undefined) throw new Error('expected an artifact');
    expect(artifact.filename).toMatch(EDITOR_PAGE_INFO_FORMATS.manifestPath);
    expect(artifact.url).toBe(`/_conloca/editor/${artifact.filename}`);
    expect(await readdir(join(root, 'dist', '_conloca', 'editor'))).toEqual([artifact.filename]);
  });

  it('costs the manifest, never the build, when it cannot be written', async () => {
    await writeFile(join(root, 'puck.config.tsx'), 'export default { components: {} };\n');
    await writeFile(join(root, 'dist'), 'a file where the build directory should be');
    const logger = makeLogger();
    const artifact = await emitComponentManifest({
      dir: join(root, 'dist'),
      puckConfigPath: 'puck.config.tsx',
      projectRoot: root,
      vite: {},
      logger,
    });
    expect(artifact).toBeUndefined();
    expect(logger.warnings.some((m) => m.startsWith('component manifest skipped'))).toBe(true);
  });

  describe('fragments', () => {
    // A plain vocabulary object: a module under tmpdir cannot resolve workspace packages.
    const renderModule = [
      'const Callout = () => null;',
      'const Eyebrow = () => null;',
      'export const fragmentComponents = { components: { Callout }, elements: { h2: Eyebrow } };',
    ].join('\n');

    it('lists the fragment components, element overrides and host-authored props', async () => {
      await writeFile(join(root, 'puck.config.tsx'), 'export default { components: {} };\n');
      await writeFile(join(root, 'render.mjs'), renderModule);
      const logger = makeLogger();
      const artifact = await emitComponentManifest({
        dir: join(root, 'dist'),
        puckConfigPath: 'puck.config.tsx',
        projectRoot: root,
        vite: {},
        fragmentComponentsPath: 'render.mjs',
        schemas: {
          mdxComponents: [
            { name: 'Callout', kind: 'flow', hasChildren: true, props: [{ name: 'tone', type: 'string' }] },
          ],
        },
        discoveredMdxComponents: [{ name: 'Callout', kind: 'text', props: [{ name: 'tone', type: 'number' }] }],
        logger,
      });
      expect((await readWritten(root, artifact)).fragments).toEqual({
        components: { Callout: { kind: 'flow', children: true, props: { tone: { type: 'string' } } } },
        elements: ['h2'],
      });
      expect(logger.infos.some((m) => m.includes('(0 components, 1 fragment components)'))).toBe(true);
      expect(logger.warnings).toEqual([]);
    });

    it('lists no fragment components for a site without them', async () => {
      await writeFile(join(root, 'puck.config.tsx'), 'export default { components: {} };\n');
      const artifact = await emitComponentManifest({
        dir: join(root, 'dist'),
        puckConfigPath: 'puck.config.tsx',
        projectRoot: root,
        vite: {},
        logger: makeLogger(),
      });
      expect((await readWritten(root, artifact)).fragments).toEqual({ components: {}, elements: [] });
    });

    it('still ships the Puck vocabulary when the render module fails to load', async () => {
      await writeFile(
        join(root, 'puck.config.tsx'),
        "export default { components: { Hero: { fields: { title: { type: 'text' } } } } };\n",
      );
      await writeFile(join(root, 'broken.mjs'), "throw new Error('cannot load here');\n");
      const logger = makeLogger();
      const artifact = await emitComponentManifest({
        dir: join(root, 'dist'),
        puckConfigPath: 'puck.config.tsx',
        projectRoot: root,
        vite: {},
        fragmentComponentsPath: 'broken.mjs',
        logger,
      });
      const manifest = await readWritten(root, artifact);
      expect(manifest.components.Hero.fields.title.type).toBe('text');
      expect(manifest.fragments.unreadable).toBe(true);
      expect(logger.warnings).toEqual([
        expect.stringMatching(/^fragment components are missing from the component manifest: .*cannot load here/),
      ]);
    });
  });
  it.each([3_999_999, 4_000_000, 4_000_001])(
    'only publishes an endpoint-readable artifact at %i UTF-8 bytes',
    async (byteLength) => {
      const envelope = JSON.stringify({
        components: { Hero: { fields: {}, label: '' } },
        unresolved: [],
        fragments: { components: {}, elements: [] },
      });
      const paddingBytes = byteLength - Buffer.byteLength(envelope);
      const label = 'é'.repeat(Math.floor(paddingBytes / 2)) + (paddingBytes % 2 === 1 ? 'x' : '');
      await writeFile(
        join(root, 'puck.config.tsx'),
        `export default { components: { Hero: { fields: {}, label: ${JSON.stringify(label)} } } };`,
      );
      const logger = makeLogger();
      const artifact = await emitComponentManifest({
        dir: join(root, 'dist'),
        puckConfigPath: 'puck.config.tsx',
        projectRoot: root,
        vite: {},
        logger,
      });
      if (byteLength > 4_000_000) {
        expect(artifact).toBeUndefined();
        expect(logger.warnings.join('\n')).toContain(`limit of ${COMPONENT_MANIFEST_LIMITS.bytes} bytes`);
        expect(logger.infos).toEqual([]);
        expect(await readdir(join(root, 'dist', '_conloca')).catch(() => [])).toEqual([]);
      } else {
        expect(artifact).toBeDefined();
        if (!artifact) throw new Error('Expected an endpoint-readable artifact');
        const bytes = await readFile(join(root, 'dist', artifact.url));
        expect(bytes.byteLength).toBe(byteLength);
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(artifact.hash);
        expect(logger.warnings).toEqual([]);
      }
    },
    30_000,
  );
  it.each(['nodes', 'depth'])(
    'refuses a manifest beyond the endpoint %s budget and writes nothing',
    async (kind) => {
      let value: unknown = Array.from({ length: 100_001 }, () => 0);
      if (kind === 'depth') {
        value = 0;
        for (let i = 0; i < 70; i++) value = { child: value };
      }
      await writeFile(
        join(root, 'puck.config.tsx'),
        `export default { components: { Hero: { fields: {}, defaultProps: { value: ${JSON.stringify(value)} } } } };`,
      );
      const logger = makeLogger();
      const artifact = await emitComponentManifest({
        dir: join(root, 'dist'),
        puckConfigPath: 'puck.config.tsx',
        projectRoot: root,
        vite: {},
        logger,
      });
      expect(artifact).toBeUndefined();
      expect(logger.warnings.join(' ')).toContain(kind);
      expect(await readdir(join(root, 'dist', '_conloca')).catch(() => [])).toEqual([]);
    },
    30_000,
  );
});
