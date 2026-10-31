import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  childAdapterOptions,
  cloudflareAdapter,
  parseWranglerConfig,
  resolveCloudflareAdapter,
} from '../preview/cloudflare-adapter.js';

let root = '';
afterEach(async () => {
  if (root !== '') await rm(root, { recursive: true, force: true });
  root = '';
});

/** A project whose node_modules holds the Cloudflare adapter this package develops against. */
async function projectWithAdapter(wrangler?: string): Promise<string> {
  root = await mkdtemp(join(tmpdir(), 'cloudflare-adapter-'));
  await writeFile(join(root, 'package.json'), '{"name":"site","type":"module"}\n');
  await mkdir(join(root, 'node_modules', '@astrojs'), { recursive: true });
  const adapter = dirname(Bun.resolveSync('@astrojs/cloudflare/package.json', import.meta.dir));
  await symlink(adapter, join(root, 'node_modules', '@astrojs', 'cloudflare'), 'dir');
  if (wrangler !== undefined) await writeFile(join(root, 'wrangler.jsonc'), wrangler);
  return root;
}

describe('parseWranglerConfig', () => {
  it('reads comments and trailing commas', () => {
    expect(parseWranglerConfig('{\n  // the site\n  "name": "site",\n}\n')).toEqual({ name: 'site' });
  });

  it('answers undefined for anything but an object', () => {
    expect(parseWranglerConfig('[1]')).toBeUndefined();
  });
});

describe('cloudflareAdapter', () => {
  it('names the package to install when the project has no Cloudflare adapter', async () => {
    root = await mkdtemp(join(tmpdir(), 'cloudflare-adapter-'));
    expect(() => resolveCloudflareAdapter(root)).toThrow('install @astrojs/cloudflare');
  });

  it('builds the D3 preview server from a copy of wrangler.jsonc without main and assets, in every env block too', async () => {
    const dir = await projectWithAdapter(
      '{\n  "name": "site",\n  "main": ".conloca/dispatcher/index.mjs",\n  "assets": { "directory": "./dist" },\n  "vars": { "A": "1" },\n' +
        '  "env": { "staging": { "name": "site-staging", "main": "x.mjs", "assets": { "directory": "./dist" }, "vars": { "A": "2" } } }\n}\n',
    );
    const adapter = await cloudflareAdapter(pathToFileURL(`${dir}/`), 'd3');
    expect(adapter.name).toBe('@astrojs/cloudflare');
    expect(JSON.parse(await readFile(join(dir, '.conloca', 'wrangler.child.json'), 'utf8'))).toEqual({
      name: 'site',
      vars: { A: '1' },
      env: { staging: { name: 'site-staging', vars: { A: '2' } } },
    });
  });

  it('compiles images at build time for the D3 child, which has no images binding', () => {
    expect(childAdapterOptions('d3', '/site/.conloca/wrangler.child.json')).toEqual({
      configPath: '/site/.conloca/wrangler.child.json',
      imageService: { build: 'compile', runtime: 'passthrough' },
    });
    expect(childAdapterOptions('d4', undefined)).toEqual({});
  });
});
