import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { framingSnippets } from '@conloca/cloud-astro';
import { framingStep } from '../src/lib/connect/framing.js';

const PACKAGE_DIR = dirname(Bun.resolveSync('@conloca/cloud-astro/package.json', import.meta.dir));
const SNIPPETS = framingSnippets('conloca.com');

let project = '';

/** A project holding `files`, with @conloca/cloud-astro installed unless `installed` is false. */
async function makeProject(files: Record<string, string>, installed = true): Promise<string> {
  project = await mkdtemp(join(tmpdir(), 'conloca-connect-framing-'));
  const all = { 'package.json': '{ "name": "site", "type": "module" }\n', ...files };
  await Promise.all(
    Object.entries(all).map(async ([path, text]) => {
      await mkdir(dirname(join(project, path)), { recursive: true });
      await writeFile(join(project, path), text);
    }),
  );
  if (installed) {
    await mkdir(join(project, 'node_modules', '@conloca'), { recursive: true });
    await symlink(PACKAGE_DIR, join(project, 'node_modules', '@conloca/cloud-astro'), 'dir');
  }
  return project;
}

afterEach(async () => {
  if (project !== '') await rm(project, { recursive: true, force: true });
  project = '';
});

const SITE_WIDE_XFO = '/*\n  X-Frame-Options: DENY\n';

describe('framingStep', () => {
  test('writes nothing when no committed rule blocks framing', async () => {
    const dir = await makeProject({ 'public/_headers': '/*\n  X-Content-Type-Options: nosniff\n' });
    expect(await framingStep(dir, undefined)).toMatchObject({ state: 'done', edits: [] });
  });

  test('adds the editor block after a site-wide X-Frame-Options in public/_headers', async () => {
    const dir = await makeProject({ 'public/_headers': SITE_WIDE_XFO });
    const result = await framingStep(dir, undefined);
    expect(result.state).toBe('changed');
    expect(result.edits).toEqual([
      {
        path: join(dir, 'public/_headers'),
        before: SITE_WIDE_XFO,
        after: `${SITE_WIDE_XFO}\n${SNIPPETS.cloudflareHeaders}`,
      },
    ]);
    expect(result.edits[0]?.after).toContain('/_conloca/editor/*');
    expect(result.edits[0]?.after).toContain('! X-Frame-Options');
  });

  test('reports done once the editor block is there', async () => {
    const dir = await makeProject({ 'public/_headers': `${SITE_WIDE_XFO}\n${SNIPPETS.cloudflareHeaders}` });
    expect(await framingStep(dir, undefined)).toMatchObject({ state: 'done', edits: [] });
  });

  test('keeps a different /_conloca/editor/ rule and reports differs', async () => {
    const dir = await makeProject({ 'public/_headers': `${SITE_WIDE_XFO}\n/_conloca/editor/*\n  ! X-Frame-Options\n` });
    expect(await framingStep(dir, undefined)).toMatchObject({ state: 'differs', edits: [] });
  });

  test('adds the editor source to vercel.json headers', async () => {
    const vercel = {
      headers: [{ source: '/(.*)', headers: [{ key: 'X-Frame-Options', value: 'DENY' }] }],
    };
    const before = `${JSON.stringify(vercel, null, 2)}\n`;
    const dir = await makeProject({ 'vercel.json': before });
    const result = await framingStep(dir, undefined);
    expect(result.state).toBe('changed');
    expect(result.edits).toHaveLength(1);
    expect(result.edits[0]?.path).toBe(join(dir, 'vercel.json'));
    const after = result.edits[0]?.after ?? '';
    expect(after).toBe(`${JSON.stringify({ headers: [...vercel.headers, ...SNIPPETS.vercelHeaders] }, null, 2)}\n`);
    expect(after).toContain('"source": "/_conloca/editor/:path*"');
  });

  test('marks a site-wide frame-ancestors CSP as needs-you', async () => {
    const dir = await makeProject({ 'public/_headers': "/*\n  Content-Security-Policy: frame-ancestors 'none'\n" });
    const result = await framingStep(dir, undefined);
    expect(result).toMatchObject({ state: 'needs-you', edits: [] });
    expect(result.lines?.join('\n')).toContain('/_conloca/editor/*');
  });

  test('writes the Netlify path rule for a site-wide X-Frame-Options in netlify.toml', async () => {
    const dir = await makeProject({
      'netlify.toml': '[[headers]]\n  for = "/*"\n  [headers.values]\n    X-Frame-Options = "DENY"\n',
    });
    const result = await framingStep(dir, undefined);
    expect(result.state).toBe('changed');
    expect(result.edits).toEqual([
      { path: join(dir, 'public/_headers'), before: null, after: SNIPPETS.netlifyHeaders },
    ]);
  });

  test('fails for an endpoint that is not the editor app address', async () => {
    const dir = await makeProject({ 'public/_headers': SITE_WIDE_XFO });
    expect(await framingStep(dir, 'https://editor.example.com')).toMatchObject({ state: 'failed', edits: [] });
  });

  test('skips when @conloca/cloud-astro is not installed', async () => {
    const dir = await makeProject({ 'public/_headers': SITE_WIDE_XFO }, false);
    expect(await framingStep(dir, undefined)).toMatchObject({
      state: 'skipped',
      message: 'install @conloca/cloud-astro first',
      edits: [],
    });
  });

  test('fails with the reason when the installed @conloca/cloud-astro cannot load', async () => {
    const dir = await makeProject({ 'public/_headers': SITE_WIDE_XFO }, false);
    const broken = join(dir, 'node_modules', '@conloca', 'cloud-astro');
    await mkdir(broken, { recursive: true });
    await writeFile(join(broken, 'package.json'), '{ "name": "@conloca/cloud-astro", "main": "index.js" }\n');
    await writeFile(join(broken, 'index.js'), "throw new Error('broken install');\n");
    const result = await framingStep(dir, undefined);
    expect(result).toMatchObject({ state: 'failed', edits: [] });
    expect(result.message).toContain('broken install');
  });

  test('names the changed files relative to a project given with a trailing slash', async () => {
    const dir = await makeProject({ 'public/_headers': SITE_WIDE_XFO });
    expect((await framingStep(`${dir}/`, undefined)).message).toBe('added the editor page rules to public/_headers');
  });
});
