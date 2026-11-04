import { describe, expect, it } from 'bun:test';
import { d8ConfigRefusal } from '@conloca/cloud-astro/node';
import { addAdapterStep } from '../src/lib/connect/adapter.js';
import type { PreviewHost } from '../src/lib/connect/host.js';
import type { StepResult } from '../src/lib/connect/step.js';

const CONFIG = `import { conlocaCloud } from '@conloca/cloud-astro';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://www.example.com',
  integrations: [conlocaCloud({ previewBuild: {} })],
});
`;

const config = (extra: string, imports = '') =>
  CONFIG.replace(
    "import { defineConfig } from 'astro/config';",
    `${imports}import { defineConfig } from 'astro/config';`,
  ).replace("  site: 'https://www.example.com',\n", `  site: 'https://www.example.com',\n${extra}`);

const run = (host: PreviewHost, text = CONFIG, more: { astroVersion?: string; yes?: boolean } = {}) =>
  addAdapterStep({
    path: '/site/astro.config.mjs',
    text,
    host,
    siteDomains: ['www.example.com'],
    astroVersion: more.astroVersion ?? '7.3.1',
    yes: more.yes ?? true,
    configRefusal: d8ConfigRefusal,
  });

const after = (result: StepResult) => result.edits[0]?.after ?? '';

describe('addAdapterStep', () => {
  it('adds vercel() and its import', () => {
    const result = run('vercel');
    expect(result.state).toBe('changed');
    expect(after(result)).toContain("import vercel from '@astrojs/vercel';");
    expect(after(result)).toContain('adapter: vercel()');
    expect(after(result)).not.toContain('isr');
  });

  it('adds netlify() and turns sessions off, never imageCDN', () => {
    const text = after(run('netlify'));
    expect(text).toContain("import netlify from '@astrojs/netlify';");
    expect(text).toContain('adapter: netlify()');
    expect(text).toContain('session: false');
    expect(text).not.toContain('imageCDN');
  });

  it('keeps a session the site configures', () => {
    const text = after(run('netlify', config("  session: { driver: 'fs' },\n")));
    expect(text).toContain("session: { driver: 'fs' }");
    expect(text).not.toContain('session: false');
  });

  it('adds node() standalone with the site domains allowed', () => {
    const text = after(run('node'));
    expect(text).toContain("import node from '@astrojs/node';");
    expect(text).toMatch(/adapter: node\(\{ mode: ['"]standalone['"] \}\)/);
    expect(text).toMatch(/allowedDomains: \[\{ hostname: ['"]www\.example\.com['"], protocol: ['"]https['"] \}\]/);
  });

  it('needs the site domains before it writes allowedDomains for node()', () => {
    const result = addAdapterStep({
      path: '/site/astro.config.mjs',
      text: CONFIG,
      host: 'node',
      siteDomains: [],
      astroVersion: '7.3.1',
      yes: true,
    });
    expect(result).toMatchObject({ state: 'needs-you', edits: [] });
    expect(result.message).toContain('sites.json');
  });

  it('adds cloudflare()', () => {
    const text = after(run('cloudflare'));
    expect(text).toContain("import cloudflare from '@astrojs/cloudflare';");
    expect(text).toContain('adapter: cloudflare()');
  });

  it('excludes the preview route under a non-root base', () => {
    const text = config(
      "  base: '/docs',\n  adapter: vercel({ isr: true }),\n",
      "import vercel from '@astrojs/vercel';\n",
    );
    expect(after(run('vercel', text))).toContain('exclude: [/^\\/docs\\/_conloca\\/preview(\\/.*)?$/]');
  });

  it('is done on a rerun once isr excludes the preview route', () => {
    const text = config('  adapter: vercel({ isr: true }),\n', "import vercel from '@astrojs/vercel';\n");
    expect(run('vercel', after(run('vercel', text)))).toMatchObject({ state: 'done', edits: [] });
  });

  it('adds the preview prefix to isr.exclude when the Vercel adapter caches with isr: true', () => {
    const text = after(
      run('vercel', config('  adapter: vercel({ isr: true }),\n', "import vercel from '@astrojs/vercel';\n")),
    );
    expect(text).toContain('exclude: [/^\\/_conloca\\/preview(\\/.*)?$/]');
  });

  it('refuses an adapter whose peer floor is above the site astro', () => {
    const result = run('cloudflare', CONFIG, { astroVersion: '7.1.0' });
    expect(result).toMatchObject({ state: 'needs-you', edits: [] });
    expect(result.message).toContain('needs astro 7.2.0 or later');
  });

  it('refuses an edge middleware option', () => {
    const text = config("  adapter: vercel({ middlewareMode: 'edge' }),\n", "import vercel from '@astrojs/vercel';\n");
    expect(run('vercel', text)).toMatchObject({ state: 'needs-you', edits: [] });
  });

  it("refuses Vercel with build.format 'file' under --yes, and warns in a terminal", () => {
    const text = config("  build: { format: 'file' },\n");
    expect(run('vercel', text)).toMatchObject({ state: 'needs-you', edits: [] });
    const asked = run('vercel', text, { yes: false });
    expect(asked.state).toBe('changed');
    expect(asked.message).toContain("build.format 'file'");
  });

  it('is done when the adapter and its options are there', () => {
    expect(run('vercel', after(run('vercel')))).toMatchObject({ state: 'done', edits: [] });
  });
});
