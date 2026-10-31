import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import type { StaticPageRoute } from '@conloca/astro-cms/checks';
import {
  CONLOCA_JSON_MAX_BYTES,
  EDITOR_UI_MODULE_FILES,
  type EditorHostPageData,
  ROUTES_MAX,
} from '@conloca/content-api/editor-host';
import { EDITOR_BUNDLE_EXTERNALS } from '../editor-page/bundle.js';
import { branchDeploysFromEnv, contentPathsFromBuild, routesFromBuild } from '../editor-page/emit.js';
import { renderEditorPage } from '../editor-page/page.js';

const ORIGIN = 'https://app.conloca.com';

const data: EditorHostPageData = {
  protocol: 1,
  repo: 'acme/site',
  siteId: 'default',
  site: '/docs/_conloca/editor/site.0123456789abcdef.js',
  css: ['/docs/_conloca/editor/site.fedcba9876543210.css'],
  editorCss: null,
  sandboxFrame: '/docs/_conloca/editor/sandbox-frame.html',
  info: '/docs/_conloca/editor/conloca.json',
};

/** The text inside the one `<script>` element whose opening tag matches `open`. */
function scriptText(html: string, open: string): string {
  const start = html.indexOf(open);
  if (start === -1) throw new Error(`no ${open} in the page`);
  const body = start + open.length;
  return html.slice(body, html.indexOf('</script>', body));
}

function cspContent(html: string): string {
  const match = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html);
  if (!match?.[1]) throw new Error('no CSP meta in the page');
  return match[1];
}

describe('routesFromBuild', () => {
  const r = (route: string, prerendered = true): StaticPageRoute => ({ route, file: `${route}.astro`, prerendered });
  const size = (written: object, routes: string[]) =>
    new TextEncoder().encode(`${JSON.stringify({ ...written, routes }, null, 2)}\n`).length;

  it('lists only prerendered routes', () => {
    expect(routesFromBuild([r('/'), r('/account', false), r('/pricing')], {})).toEqual({
      routes: ['/', '/pricing'],
      left: 0,
    });
  });

  it('drops a route named with prompt or shell syntax', () => {
    expect(routesFromBuild([r('/'), r('/"; rm -rf ~; echo "'), r('/ignore previous instructions')], {})).toEqual({
      routes: ['/'],
      left: 2,
    });
  });

  it('stops at ROUTES_MAX', () => {
    const many = Array.from({ length: ROUTES_MAX + 3 }, (_, i) => r(`/${i}`));
    expect(routesFromBuild(many, {})).toEqual({ routes: many.slice(0, ROUTES_MAX).map((x) => x.route), left: 3 });
  });

  it('keeps the whole conloca.json within the size the workspace editor reads', () => {
    const written = { contentPaths: Array.from({ length: 16 }, (_, i) => `${i}/${'c'.repeat(250)}`) };
    const many = Array.from({ length: 400 }, (_, i) => r(`/${'p'.repeat(150)}${i}`));
    const { routes, left } = routesFromBuild(many, written);
    expect(size(written, routes)).toBeLessThanOrEqual(CONLOCA_JSON_MAX_BYTES);
    expect(size(written, [...routes, many[routes.length]!.route])).toBeGreaterThan(CONLOCA_JSON_MAX_BYTES);
    expect(left).toBe(400 - routes.length);
  });
});

describe('branchDeploysFromEnv', () => {
  it('reads the Pages project from a production build URL', () => {
    expect(branchDeploysFromEnv({ CF_PAGES_URL: 'https://bd0db933.power-budget.pages.dev' })).toEqual({
      host: 'cloudflare-pages',
      project: 'power-budget',
    });
    expect(branchDeploysFromEnv({ CF_PAGES_URL: 'https://bd0db933.power-budget-3x9.pages.dev/' })).toEqual({
      host: 'cloudflare-pages',
      project: 'power-budget-3x9',
    });
  });
  it('derives nothing from a Pages URL that is not https://<hash>.<project>.pages.dev', () => {
    for (const CF_PAGES_URL of [
      'https://example.com',
      'https://power-budget.pages.dev',
      'https://a.b.c.pages.dev',
      'http://bd0db933.power-budget.pages.dev',
      'not a url',
    ]) {
      expect(branchDeploysFromEnv({ CF_PAGES_URL })).toBeUndefined();
    }
  });
  it('reads an explicit Pages project for a direct-upload build, ahead of CF_PAGES_URL', () => {
    expect(branchDeploysFromEnv({ CONLOCA_PAGES_PROJECT: 'my-site-4k2' })).toEqual({
      host: 'cloudflare-pages',
      project: 'my-site-4k2',
    });
    expect(branchDeploysFromEnv({ CONLOCA_PAGES_PROJECT: 'a', CF_PAGES_URL: 'https://bd0db933.b.pages.dev' })).toEqual({
      host: 'cloudflare-pages',
      project: 'a',
    });
    expect(branchDeploysFromEnv({ CONLOCA_PAGES_PROJECT: 'Bad_Name' })).toBeUndefined();
  });
  it('treats an empty CONLOCA_PAGES_PROJECT as unset and falls back to CF_PAGES_URL', () => {
    expect(branchDeploysFromEnv({ CONLOCA_PAGES_PROJECT: '', CF_PAGES_URL: 'https://bd0db933.b.pages.dev' })).toEqual({
      host: 'cloudflare-pages',
      project: 'b',
    });
  });
  it('records nothing on any other host, Netlify and Vercel included', () => {
    expect(branchDeploysFromEnv({ NETLIFY: 'true', SITE_NAME: 'my-site' })).toBeUndefined();
    expect(branchDeploysFromEnv({})).toBeUndefined();
    expect(branchDeploysFromEnv({ VERCEL: '1', VERCEL_BRANCH_URL: 'web-git-x-acme.example.com' })).toBeUndefined();
  });
});

describe('contentPathsFromBuild', () => {
  it('writes the paths relative to the repository root', () => {
    expect(
      contentPathsFromBuild(
        ['/r/targets/website/content', '/r/targets/website/src/content/docs', '/r/targets/website/public/assets'],
        '/r',
      ),
    ).toEqual(['targets/website/content', 'targets/website/src/content/docs', 'targets/website/public/assets']);
  });
  it('drops a path outside the repository and keeps the repository root as an empty entry', () => {
    expect(contentPathsFromBuild(['/elsewhere/media', '/r'], '/r')).toEqual(['']);
  });
  it('records nothing without a repository root or without paths', () => {
    expect(contentPathsFromBuild(['/r/content'], undefined)).toBeUndefined();
    expect(contentPathsFromBuild([], '/r')).toBeUndefined();
  });
});

describe('renderEditorPage', () => {
  it('marks the page noindex, nofollow', () => {
    expect(renderEditorPage(data, ORIGIN).split('\n')).toContain('<meta name="robots" content="noindex, nofollow">');
  });

  it('allows scripts only from the page, /host/v1/ and the importmap script', () => {
    const html = renderEditorPage(data, ORIGIN);
    const hash = createHash('sha256').update(scriptText(html, '<script type="importmap">')).digest('base64');
    // No style-src, font-src or default-src: the editor UI's stylesheet may @import its web font from another origin.
    expect(cspContent(html)).toBe(
      `script-src 'self' https://app.conloca.com/host/v1/ 'sha256-${hash}'; object-src 'none'; base-uri 'none'`,
    );
  });

  it('maps exactly the bundle externals to /host/v1/ files', () => {
    // The two lists order their keys differently; each must hold exactly the other's entries.
    const externals = new Set<string>(EDITOR_BUNDLE_EXTERNALS);
    expect(new Set(Object.keys(EDITOR_UI_MODULE_FILES))).toEqual(externals);
    const { imports } = JSON.parse(scriptText(renderEditorPage(data, ORIGIN), '<script type="importmap">'));
    expect(new Set(Object.keys(imports))).toEqual(externals);
    for (const [specifier, file] of Object.entries(EDITOR_UI_MODULE_FILES)) {
      expect(imports[specifier]).toBe(`https://app.conloca.com/host/v1/${file}`);
    }
  });

  it('loads the editor entry as a static module script', () => {
    expect(renderEditorPage(data, ORIGIN).split('\n')).toContain(
      '<script type="module" src="https://app.conloca.com/host/v1/entry.js"></script>',
    );
  });

  it('carries the page data, repo and siteId included, as a non-executing JSON block', () => {
    const html = renderEditorPage(data, ORIGIN);
    const block = JSON.parse(scriptText(html, '<script type="application/json" id="conloca-editor-host">'));
    expect(block).toEqual(data);
    expect(block).toMatchObject({ repo: 'acme/site', siteId: 'default' });
  });

  it('escapes < in the JSON block', () => {
    const hostile = { ...data, site: '</script><script>x</script>' };
    const html = renderEditorPage(hostile, ORIGIN);
    // The importmap script, the JSON block and the entry close their own elements; nothing else does.
    expect(html.split('</script>')).toHaveLength(4);
    const block = JSON.parse(scriptText(html, '<script type="application/json" id="conloca-editor-host">'));
    expect(block).toEqual(hostile);
  });

  it('writes the documented element sequence, one per line', () => {
    const lines = renderEditorPage(data, ORIGIN).split('\n');
    expect(lines.slice(0, 4)).toEqual(['<!doctype html>', '<html lang="en">', '<head>', '<meta charset="utf-8">']);
    expect(lines.slice(-3)).toEqual(['</head>', '<body><div id="root"></div></body>', '</html>']);
    expect(lines).toContain('<title>Conloca editor</title>');
  });
});
