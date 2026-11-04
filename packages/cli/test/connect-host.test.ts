import { afterEach, describe, expect, it } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { detectHost, type HostAnswer } from '../src/lib/connect/host.js';
import { makeRepo } from './fixture-repo.js';

const NODE_CONFIG = "import node from '@astrojs/node';\nexport default { adapter: node({ mode: 'standalone' }) };\n";
const PLAIN_CONFIG = 'export default {};\n';
const UNKNOWN: HostAnswer = {
  ok: false,
  reason: 'unknown',
  message: "can't tell where this site deploys: pass --host vercel|netlify|cloudflare|node",
};
const conflict = (message: string): HostAnswer => ({
  ok: false,
  reason: 'conflict',
  message: `${message}: pass --host vercel|netlify|cloudflare|node`,
});

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function detect(files: Record<string, string>, options: { site?: string; astroText?: string } = {}) {
  const root = await makeRepo(files, []);
  roots.push(root);
  return detectHost({
    projectDir: join(root, options.site ?? '.'),
    repoRoot: root,
    astroText: options.astroText ?? PLAIN_CONFIG,
  });
}

describe('detectHost', () => {
  it('finds vercel.json at the root of a monorepo for a site in apps/web', async () => {
    const answer = await detect({ 'vercel.json': '{}', 'apps/web/package.json': '{}' }, { site: 'apps/web' });
    expect(answer).toEqual({ ok: true, host: 'vercel', evidence: ['vercel.json'] });
  });

  it('reads netlify.toml', async () => {
    expect(await detect({ 'netlify.toml': '[build]\n' })).toMatchObject({ ok: true, host: 'netlify' });
  });

  it('keeps a D3 dispatcher config on cloudflare-d3 despite a leftover vercel.json and .vercel/', async () => {
    const answer = await detect({
      'wrangler.jsonc': '{ "main": ".conloca/dispatcher/index.mjs" }',
      'vercel.json': '{}',
      '.vercel/project.json': '{}',
    });
    expect(answer).toMatchObject({ ok: true, host: 'cloudflare-d3' });
  });

  it('reads any other wrangler.jsonc as cloudflare', async () => {
    const answer = await detect({ 'wrangler.jsonc': '{ "name": "s", "assets": { "directory": "./dist" } }' });
    expect(answer).toEqual({ ok: true, host: 'cloudflare', evidence: ['wrangler.jsonc'] });
  });

  it('never counts .vercel/ alone', async () => {
    expect(await detect({ '.vercel/project.json': '{}' })).toEqual(UNKNOWN);
  });

  it('takes no node evidence from a Dockerfile serving dist with nginx, and refuses under --yes', async () => {
    const answer = await detect({ Dockerfile: 'FROM nginx\nCOPY dist /usr/share/nginx/html\nCMD ["nginx"]\n' });
    expect(answer).toEqual(UNKNOWN);
  });

  it('does not read `astro dev` as a node server', async () => {
    const answer = await detect({ 'package.json': JSON.stringify({ scripts: { start: 'astro dev' } }) });
    expect(answer).toEqual(UNKNOWN);
  });

  it('is node when the repo starts the server entry and astro.config names node()', async () => {
    const answer = await detect(
      { 'package.json': JSON.stringify({ scripts: { start: 'node dist/server/entry.mjs' } }) },
      { astroText: NODE_CONFIG },
    );
    expect(answer).toEqual({ ok: true, host: 'node', evidence: ['astro.config', 'package.json'] });
  });

  it('does not answer node from a node() adapter no file starts', async () => {
    expect(await detect({}, { astroText: NODE_CONFIG })).toEqual(UNKNOWN);
  });

  it('reads a Dockerfile CMD, a Procfile and a fly.toml starting the server entry', async () => {
    const files: Record<string, string>[] = [
      { Dockerfile: 'FROM node:22\nCMD ["node", ".conloca/preview-server/server/entry.mjs"]\n' },
      { Procfile: 'web: node dist/server/entry.mjs\n' },
      { 'fly.toml': '[processes]\napp = "node dist/server/entry.mjs"\n' },
    ];
    for (const answer of await Promise.all(files.map((repo) => detect(repo)))) {
      expect(answer).toMatchObject({ ok: true, host: 'node' });
    }
  });

  it('ignores a commented-out adapter import', async () => {
    const astroText = "// import vercel from '@astrojs/vercel';\n/* import node from '@astrojs/node'; */\n";
    expect(await detect({ 'netlify.toml': '' }, { astroText })).toMatchObject({ ok: true, host: 'netlify' });
  });

  it('refuses naming both when astro.config names node() but wrangler.toml deploys dist', async () => {
    const answer = await detect(
      { 'wrangler.toml': 'name = "s"\n[assets]\ndirectory = "./dist/"\n' },
      { astroText: NODE_CONFIG },
    );
    expect(answer).toEqual(conflict('astro.config names node but wrangler.toml deploys to cloudflare'));
  });

  it('refuses vercel.json beside netlify.toml', async () => {
    expect(await detect({ 'vercel.json': '{}', 'netlify.toml': '' })).toEqual(
      conflict('vercel.json names vercel but netlify.toml deploys to netlify'),
    );
  });

  it('lets --host win over any evidence', async () => {
    const root = await makeRepo({ 'vercel.json': '{}' }, []);
    roots.push(root);
    const answer = await detectHost({
      projectDir: root,
      repoRoot: root,
      astroText: '',
      flag: 'netlify',
    });
    expect(answer).toMatchObject({ ok: true, host: 'netlify' });
  });

  it('reads nothing outside the repository and skips a Dockerfile folder', async () => {
    const root = await makeRepo({ 'vercel.json': '{}', 'repo/Dockerfile.d/x': '', 'other/site/x': '' }, []);
    roots.push(root);
    const repoRoot = join(root, 'repo');
    const answers = await Promise.all(
      [repoRoot, join(root, 'other', 'site')].map((projectDir) => detectHost({ projectDir, repoRoot, astroText: '' })),
    );
    expect(answers).toEqual([UNKNOWN, UNKNOWN]);
  });

  it('reads no wrangler config of a project outside the repository', async () => {
    const root = await makeRepo(
      { 'other/site/wrangler.jsonc': '{ "main": ".conloca/dispatcher/index.mjs" }', 'repo/x': '' },
      [],
    );
    roots.push(root);
    const answer = await detectHost({
      projectDir: join(root, 'other', 'site'),
      repoRoot: join(root, 'repo'),
      astroText: '',
    });
    expect(answer).toEqual(UNKNOWN);
  });

  it('answers unknown when nothing tells', async () => {
    expect(await detect({})).toEqual(UNKNOWN);
  });
});
