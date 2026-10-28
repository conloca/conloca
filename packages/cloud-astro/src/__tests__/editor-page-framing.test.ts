import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SitesConfig } from '@conloca/content-api';
import { findFramingBlockers, framingSnippets } from '../editor-page/framing.js';
import { baseMismatch } from '../editor-page/site-base.js';

describe('framingSnippets', () => {
  it('writes the Cloudflare rule that detaches site-wide framing headers', () => {
    expect(framingSnippets('conloca.com').cloudflareHeaders).toBe(
      [
        '/_conloca/editor/*',
        '  ! X-Frame-Options',
        '  ! Content-Security-Policy',
        "  Content-Security-Policy: frame-ancestors 'self' https://*.conloca.com",
        '',
        '/_conloca/editor/sandbox-frame.html',
        '  Content-Security-Policy: sandbox allow-scripts',
        '',
      ].join('\n'),
    );
  });

  it('writes no removal lines for Netlify', () => {
    expect(framingSnippets('conloca.com').netlifyHeaders).toBe(
      [
        '/_conloca/editor/*',
        "  Content-Security-Policy: frame-ancestors 'self' https://*.conloca.com",
        '',
        '/_conloca/editor/sandbox-frame.html',
        '  Content-Security-Policy: sandbox allow-scripts',
        '',
      ].join('\n'),
    );
  });

  it('sandboxes the MDX frame on every host', () => {
    const snippets = framingSnippets('conloca.com');
    const sandboxRule = '/_conloca/editor/sandbox-frame.html\n  Content-Security-Policy: sandbox allow-scripts\n';
    expect(snippets.cloudflareHeaders).toContain(sandboxRule);
    expect(snippets.netlifyHeaders).toContain(sandboxRule);
    expect(snippets.vercelHeaders).toEqual([
      {
        source: '/_conloca/editor/:path*',
        headers: [{ key: 'Content-Security-Policy', value: "frame-ancestors 'self' https://*.conloca.com" }],
      },
      {
        source: '/_conloca/editor/sandbox-frame.html',
        headers: [{ key: 'Content-Security-Policy', value: 'sandbox allow-scripts' }],
      },
    ]);
  });
});

describe('findFramingBlockers', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'framing-'));
    await mkdir(join(root, 'public'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reports a site-wide X-Frame-Options with no editor rule', async () => {
    await writeFile(join(root, 'public/_headers'), '/*\n  X-Frame-Options: DENY\n');
    expect(await findFramingBlockers(root)).toEqual([{ file: 'public/_headers', header: 'X-Frame-Options' }]);
  });

  it('reports a lowercase x-frame-options', async () => {
    await writeFile(join(root, 'public/_headers'), '/*\n  x-frame-options: DENY\n');
    expect(await findFramingBlockers(root)).toEqual([{ file: 'public/_headers', header: 'X-Frame-Options' }]);
  });

  it('reports nothing once the editor rule is present', async () => {
    await writeFile(
      join(root, 'public/_headers'),
      `/*\n  X-Frame-Options: DENY\n\n${framingSnippets('conloca.com').cloudflareHeaders}`,
    );
    expect(await findFramingBlockers(root)).toEqual([]);
  });

  it('reports nothing when the editor rule sits in another header file', async () => {
    await writeFile(
      join(root, 'netlify.toml'),
      '[[headers]]\n  for = "/*"\n  [headers.values]\n    X-Frame-Options = "DENY"\n',
    );
    await writeFile(join(root, 'public/_headers'), framingSnippets('conloca.com').netlifyHeaders);
    expect(await findFramingBlockers(root)).toEqual([]);
  });

  it('reports a vercel.json frame-ancestors rule', async () => {
    await writeFile(
      join(root, 'vercel.json'),
      JSON.stringify({
        headers: [{ source: '/(.*)', headers: [{ key: 'Content-Security-Policy', value: "frame-ancestors 'none'" }] }],
      }),
    );
    expect(await findFramingBlockers(root)).toEqual([{ file: 'vercel.json', header: 'frame-ancestors' }]);
  });
});

/** A sites.json with one site, `default`. */
function sites(site: SitesConfig['sites'][string]): SitesConfig {
  return { sites: { default: site }, globalLocales: ['en'] };
}

describe('baseMismatch', () => {
  it('warns when the address site base differs', () => {
    expect(baseMismatch(sites({ locales: ['en'], defaultLocale: 'en', base: '/docs/' }), '/')).toContain(
      '/docs/_conloca/editor/',
    );
  });

  it('treats a missing base as /', () => {
    const config = sites({ locales: ['en'], defaultLocale: 'en' });
    expect(baseMismatch(config, '/')).toBeUndefined();
    expect(baseMismatch(config, '/docs')).toBe(
      'Astro\'s base is /docs/ but sites.json gives the site "default" base /: the workspace editor looks for the editor page under /_conloca/editor/ and will not find it. Make them match.',
    );
  });

  it('stays quiet without an address site', () => {
    const blog = { locales: ['en'], defaultLocale: 'en', base: '/blog/' };
    expect(baseMismatch({ sites: { blog, docs: blog }, globalLocales: ['en'] }, '/')).toBeUndefined();
  });
});
