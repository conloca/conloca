import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { isEditorPageInfo } from '@conloca/content-api/editor-host';
import {
  BUILD_TIMEOUT,
  createFixtureSite,
  type FixtureSiteOptions,
  runAstroBuild,
  snapshotTree,
} from './fixture-site.js';

const CASES: readonly { name: string; client: string; base: string; options?: FixtureSiteOptions }[] = [
  { name: 'static', client: 'dist', base: '/' },
  { name: 'static-base', client: 'dist', base: '/docs/', options: { base: '/docs', trailingSlash: 'never' } },
  { name: 'cloudflare', client: 'dist/client', base: '/', options: { adapter: 'cloudflare' } },
];

const UI_PREFIX = 'https://app.conloca.com/host/v1/';

/**
 * Astro draws a fresh server-islands key for every server build and writes it into
 * `dist/server/chunks/entrypoints_*.mjs`; a fixed `ASTRO_KEY` keeps that file comparable instead of excluded.
 */
const ASTRO_KEY = Buffer.alloc(32, 1).toString('base64');

/** Every path added, removed or changed between two snapshots, as `<path>: <before> -> <after>`. */
function changes(before: Map<string, string>, after: Map<string, string>): string[] {
  const paths = [...new Set([...before.keys(), ...after.keys()])];
  paths.sort();
  return paths
    .filter((path) => before.get(path) !== after.get(path))
    .map((path) => `${path}: ${before.get(path) ?? 'none'} -> ${after.get(path) ?? 'none'}`);
}

/** Builds a fresh site and snapshots its folder, `node_modules` left out. */
async function buildAndSnapshot(name: string, options: FixtureSiteOptions): Promise<Map<string, string>> {
  const site = await createFixtureSite(name, options);
  const result = runAstroBuild(site, { ASTRO_KEY });
  expect(result.status, result.stderr).toBe(0);
  return snapshotTree(site, (path) => path === 'node_modules');
}

describe('conlocaCloud() with no options and no key', () => {
  for (const { name, client, base, options = {} } of CASES) {
    it(
      `keeps every byte outside _conloca/editor/ unchanged: ${name}`,
      async () => {
        const first = await buildAndSnapshot(name, { ...options, withoutIntegration: true });
        const second = await buildAndSnapshot(name, { ...options, withoutIntegration: true });
        expect(changes(first, second)).toEqual([]);

        const withPage = await buildAndSnapshot(name, options);
        const editor = `${client}/_conloca/editor`;
        const outside = new Map(
          [...withPage].filter(
            // The `_conloca` folder only holds the editor folder; a file the integration put beside it still shows.
            ([path]) => path !== editor && !path.startsWith(`${editor}/`) && path !== `${client}/_conloca`,
          ),
        );
        first.delete('astro.config.mjs');
        outside.delete('astro.config.mjs');
        expect(changes(first, outside)).toEqual([]);

        const files = [...withPage]
          .filter(([path, state]) => path.startsWith(`${editor}/`) && state !== 'folder')
          .map(([path]) => path.slice(editor.length + 1).replace(/\.[0-9a-f]{16}\./, '.<h>.'));
        const assets = files.filter((file) => file.startsWith('assets/'));
        const named = files.filter((file) => !file.startsWith('assets/'));
        named.sort();
        expect(named).toEqual([
          'component-manifest.<h>.json',
          'conloca.json',
          'index.html',
          'sandbox-frame.html',
          'site.<h>.css',
          'site.<h>.js',
        ]);
        expect(assets.filter((file) => file.endsWith('.woff2'))).toHaveLength(2);

        const site = join(import.meta.dirname, '..', 'tmp', name);
        const html = await readFile(join(site, editor, 'index.html'), 'utf8');
        expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
        const importMap = /<script type="importmap">(.*?)<\/script>/.exec(html)?.[1] ?? '{}';
        const block = /<script type="application\/json" id="conloca-editor-host">(.*?)<\/script>/.exec(html)?.[1];
        const data = JSON.parse(block ?? '{}');
        const urls = [
          ...[...html.matchAll(/\ssrc="([^"]+)"/g)].map((match) => match[1]),
          ...Object.values(JSON.parse(importMap).imports ?? {}).map(String),
          data.site,
          ...data.css,
          ...(data.editorCss === null ? [] : [data.editorCss]),
          data.sandboxFrame,
          data.info,
        ];
        expect(urls.length).toBeGreaterThan(5);
        expect(urls.filter((url) => !url.startsWith(`${base}_conloca/editor/`) && !url.startsWith(UI_PREFIX))).toEqual(
          [],
        );
        expect(isEditorPageInfo(JSON.parse(await readFile(join(site, editor, 'conloca.json'), 'utf8')))).toBe(true);

        const sitemaps = [...withPage.keys()].filter(
          (path) => path.startsWith(`${client}/`) && /^sitemap.*\.xml$/.test(basename(path)),
        );
        expect(sitemaps.length).toBeGreaterThan(0);
        const listed = await Promise.all(sitemaps.map((path) => readFile(join(site, path), 'utf8')));
        expect(listed.filter((xml) => xml.includes('_conloca'))).toEqual([]);
      },
      BUILD_TIMEOUT * 3,
    );
  }
});
