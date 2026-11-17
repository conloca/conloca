import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { EditorDataBindings } from '@conloca/content-api';
import { FileSystemContentAPI } from '@conloca/content-api/node';
import { emitFrameChains } from '../editor-page/frame-chains.js';

let projectDir: string;
let folder: string;
let contentRoot: string;
let framePath: string;

const DATA_BINDINGS: EditorDataBindings = {
  siteName: 'default',
  locale: 'en',
  routes: {},
  entries: [
    { name: 'blog', collection: 'blog', frame: 'blog' },
    { name: 'pages', collection: 'pages' },
  ],
};

function makeLogger() {
  const warnings: string[] = [];
  const infos: string[] = [];
  return { info: (m: string) => infos.push(m), warn: (m: string) => warnings.push(m), warnings, infos };
}

type UrlSettings = { trailingSlash: 'always' | 'never' | 'ignore'; buildFormat: 'directory' | 'file' | 'preserve' };

async function emit(
  logger = makeLogger(),
  dataBindings: EditorDataBindings = DATA_BINDINGS,
  urls: UrlSettings = { trailingSlash: 'ignore', buildFormat: 'file' },
) {
  await emitFrameChains({
    folder,
    root: projectDir,
    vite: { esbuild: { jsx: 'automatic' } },
    editorFrames: { blog: framePath },
    dataBindings,
    contentRoot,
    ...urls,
    logger,
  });
  return logger;
}

async function createPage(
  collection: string,
  pathname: string,
  schedule: { publishAt?: string; unpublishAt?: string },
) {
  const site = (await FileSystemContentAPI.create({ contentRoot })).getSite('default');
  if (!site) throw new Error('no site');
  await site.create({
    collection,
    locales: {
      en: { pathname, ...schedule, meta: { title: pathname }, content: { puckData: { content: [], root: {} } } },
    },
  });
  FileSystemContentAPI.clearCaches();
}

const framesFile = join('frames.json');

beforeEach(async () => {
  projectDir = await realpath(await mkdtemp(join(tmpdir(), 'editor-page-frames-')));
  folder = join(projectDir, 'dist', '_conloca', 'editor');
  contentRoot = join(projectDir, 'content');
  framePath = join(projectDir, 'blog-frame.tsx');
  await mkdir(folder, { recursive: true });
  await mkdir(join(projectDir, 'node_modules', '@conloca'), { recursive: true });
  // cloud-astro has no react of its own: react comes from the repository root, astro-cms is cloud-astro's dependency.
  const rootRequire = createRequire(join(import.meta.dir, '..', '..', '..', '..', 'package.json'));
  const packages = [
    ['@conloca/astro-cms', createRequire(import.meta.url)],
    ['react', rootRequire],
    ['react-dom', rootRequire],
  ] as const;
  await Promise.all(
    packages.map(([name, require]) =>
      symlink(dirname(require.resolve(`${name}/package.json`)), join(projectDir, 'node_modules', name)),
    ),
  );
  await writeFile(
    framePath,
    'export default function Frame({ children }) { return <main className="page-shell">{children}</main>; }\n',
  );
  await mkdir(contentRoot, { recursive: true });
  await writeFile(
    join(contentRoot, 'sites.json'),
    JSON.stringify({ sites: { default: { locales: ['en'], defaultLocale: 'en' } }, globalLocales: ['en'] }),
  );
  await createPage('blog', '/blog/scheduled', { publishAt: '2999-01-01T00:00:00.000Z' });
  await createPage('blog', '/blog/expired', { unpublishAt: '2000-01-01T00:00:00.000Z' });
  await createPage('blog', '/blog/live', {});
});

afterEach(async () => {
  FileSystemContentAPI.clearCaches();
  await rm(projectDir, { recursive: true, force: true });
});

describe('emitFrameChains', () => {
  it("writes the published page's served pathname and the frame's chain", async () => {
    const logger = await emit();
    expect(logger.warnings).toEqual([]);
    expect(JSON.parse(await readFile(join(folder, framesFile), 'utf8'))).toEqual({
      version: 1,
      entries: [{ route: 'blog', pathname: '/blog/live', chain: [{ tag: 'main', classes: ['page-shell'] }] }],
    });
  });

  it("records the trailing slash a directory-format build serves the page with, so CC30's fetch is not redirected", async () => {
    await emit(makeLogger(), DATA_BINDINGS, { trailingSlash: 'ignore', buildFormat: 'directory' });
    expect(JSON.parse(await readFile(join(folder, framesFile), 'utf8')).entries[0].pathname).toBe('/blog/live/');
  });

  it("renders a frame that uses hooks with the site's React", async () => {
    await writeFile(
      framePath,
      "import { useState } from 'react';\nexport default function Frame({ children }) { const [c] = useState('x'); return <main className={c}>{children}</main>; }\n",
    );
    const logger = await emit();
    expect(logger.warnings).toEqual([]);
    expect(JSON.parse(await readFile(join(folder, framesFile), 'utf8')).entries[0].chain).toEqual([
      { tag: 'main', classes: ['x'] },
    ]);
  });

  it('warns naming the route and writes nothing when the frame throws on import', async () => {
    await writeFile(framePath, "throw new Error('boom');\n");
    const logger = await emit();
    expect(logger.warnings).toHaveLength(1);
    expect(logger.warnings[0]).toContain('blog');
    expect(logger.warnings[0]).toContain(framePath);
    expect(existsSync(join(folder, framesFile))).toBe(false);
  });

  it('writes nothing when no entry has a frame', async () => {
    await emit(makeLogger(), { ...DATA_BINDINGS, entries: [{ name: 'pages', collection: 'pages' }] });
    expect(existsSync(join(folder, framesFile))).toBe(false);
  });

  it('leaves out scheduled and expired pages: a collection with only those writes nothing', async () => {
    await createPage('drafts', '/drafts/scheduled', { publishAt: '2999-01-01T00:00:00.000Z' });
    await createPage('drafts', '/drafts/expired', { unpublishAt: '2000-01-01T00:00:00.000Z' });
    const logger = await emit(makeLogger(), {
      ...DATA_BINDINGS,
      entries: [{ name: 'drafts', collection: 'drafts', frame: 'blog' }],
    });
    expect(logger.warnings).toEqual([]);
    expect(logger.infos).toContain('route drafts has no published page, so frames.json leaves its editor frame out');
    expect(existsSync(join(folder, framesFile))).toBe(false);
  });
});
