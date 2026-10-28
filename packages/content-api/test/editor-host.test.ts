import { describe, expect, it } from 'bun:test';
import {
  branchDeploysOf,
  classifyEditorHostResponse,
  classifyFrameHeaders,
  contentPathsOf,
  EDITOR_UI_MODULE_FILES,
  type EditorPageInfo,
  editorUiOrigin,
  isEditorPageInfo,
  isFromVercel,
  isValidBranchName,
  parentRoot,
} from '../src/editor-host.js';

const info: EditorPageInfo = {
  protocol: 1,
  repo: 'conloca/website',
  siteId: 'default',
  commit: 'a'.repeat(40),
  branch: 'main',
  builtWith: '@conloca/cloud-astro@1.2.3',
  componentManifest: { path: 'component-manifest.0123456789abcdef.json', sha256: 'b'.repeat(64) },
};

describe('branchDeploysOf', () => {
  it('reads a Cloudflare Pages project', () => {
    expect(branchDeploysOf({ branchDeploys: { host: 'cloudflare-pages', project: 'power-budget' } })).toEqual({
      host: 'cloudflare-pages',
      project: 'power-budget',
    });
  });
  it('keeps only the known fields', () => {
    expect(
      branchDeploysOf({ branchDeploys: { host: 'cloudflare-pages', project: 'p', url: 'https://x.test' } }),
    ).toEqual({ host: 'cloudflare-pages', project: 'p' });
  });
  it('ignores an absent, null or malformed value, Netlify and Vercel included', () => {
    for (const branchDeploys of [
      undefined,
      null,
      'my-site',
      { host: 'vercel', project: 'web' },
      { host: 'netlify', site: 'my-site' },
      { host: 'cloudflare-pages' },
      { host: 'cloudflare-pages', project: 'Bad_Name' },
      { host: 'cloudflare-pages', project: '-x' },
      { host: 'cloudflare-pages', project: 'x-' },
      { host: 'cloudflare-pages', project: 'a'.repeat(64) },
    ]) {
      expect(branchDeploysOf({ branchDeploys })).toBeUndefined();
    }
    expect(branchDeploysOf({})).toBeUndefined();
  });
  it('leaves a conloca.json with a malformed branchDeploys valid', () => {
    expect(isEditorPageInfo({ ...info, branchDeploys: { host: 'vercel' } })).toBe(true);
  });
});

describe('contentPathsOf', () => {
  it("reads the website's content, docs and media folders", () => {
    const contentPaths = [
      'targets/website/content',
      'targets/website/src/content/docs',
      'targets/website/public/assets',
    ];
    expect(contentPathsOf({ contentPaths })).toEqual(contentPaths);
  });
  it('keeps the repository root and drops duplicates', () => {
    expect(contentPathsOf({ contentPaths: ['', 'content', 'content'] })).toEqual(['', 'content']);
  });
  it('ignores an absent, empty, over-long or malformed list', () => {
    for (const contentPaths of [
      undefined,
      null,
      'content',
      [],
      Array.from({ length: 17 }, (_, i) => `c${i}`),
      ['/abs'],
      ['content/'],
      ['a//b'],
      ['a/../b'],
      ['./a'],
      ['a\\b'],
      [7],
      ['x'.repeat(256)],
    ]) {
      expect(contentPathsOf({ contentPaths })).toBeUndefined();
    }
  });
  it('leaves a conloca.json with a malformed contentPaths valid', () => {
    expect(isEditorPageInfo({ ...info, contentPaths: ['../src'] })).toBe(true);
  });
});

describe('editor host contract', () => {
  it('derives the editor origin from an app. endpoint', () => {
    expect(editorUiOrigin(undefined)).toBe('https://app.conloca.com');
    expect(editorUiOrigin('https://app.stage.example.com/x')).toBe('https://app.stage.example.com');
    expect(editorUiOrigin('http://app.conloca.localhost:5180')).toBe('http://app.conloca.localhost:5180');
  });

  it('refuses an endpoint that is not app. plus two labels', () => {
    for (const endpoint of [
      'https://cms.example.com',
      'https://app.com',
      'https://conloca.com',
      'http://127.0.0.1:8787',
      'not a url',
      'foo://app.example.com',
      'file://app.example.com',
      'https://app.example.com.',
    ]) {
      expect(editorUiOrigin(endpoint)).toBeNull();
    }
  });

  it('takes the parent root as the host minus app.', () => {
    expect(parentRoot('https://app.conloca.com/host/v1/entry.js')).toBe('conloca.com');
    expect(parentRoot('https://app.stage.example.com/')).toBe('stage.example.com');
    expect(parentRoot('http://app.conloca.localhost:5180/')).toBe('conloca.localhost');
    expect(parentRoot('https://cms.example.com/')).toBeNull();
    expect(parentRoot('foo://app.example.com/')).toBeNull();
  });

  it('accepts a well-formed conloca.json', () => {
    expect(isEditorPageInfo(info)).toBe(true);
    expect(isEditorPageInfo({ ...info, builtWith: '@conloca/cloud-astro@1.2.3-beta.1', extra: true })).toBe(true);
  });

  it('accepts nulls where the page could not know', () => {
    expect(isEditorPageInfo({ ...info, repo: null, commit: null, branch: null, componentManifest: null })).toBe(true);
  });

  it('names one distinct .js editor UI file per bare specifier', () => {
    const files = Object.values(EDITOR_UI_MODULE_FILES);
    expect(files).toHaveLength(6);
    expect(new Set(files).size).toBe(6);
    for (const file of files) {
      expect(file).toMatch(/^[a-z-]+\.js$/);
      expect(file).not.toBe('entry.js');
    }
  });

  it('refuses each malformed field', () => {
    const { siteId: _siteId, ...withoutSiteId } = info;
    const cases: [string, unknown][] = [
      ['short commit', { ...info, commit: 'abc' }],
      ['upper-case commit', { ...info, commit: 'A'.repeat(40) }],
      ['branch with ..', { ...info, branch: 'a..b' }],
      ['branch over 255', { ...info, branch: 'x'.repeat(256) }],
      ['builtWith without a version', { ...info, builtWith: '@conloca/cloud-astro@unknown' }],
      ['repo with a host', { ...info, repo: 'gitlab.com/a/b' }],
      ['repo owner with _', { ...info, repo: 'own_er/r' }],
      ['upper-case siteId', { ...info, siteId: 'Default' }],
      ['fractional protocol', { ...info, protocol: 1.5 }],
      ['manifest path outside the folder', { ...info, componentManifest: { path: '../x', sha256: 'b'.repeat(64) } }],
      [
        'manifest sha256 of 63 hex',
        { ...info, componentManifest: { ...info.componentManifest, sha256: 'b'.repeat(63) } },
      ],
      ['missing siteId', withoutSiteId],
    ];
    for (const [label, value] of cases) {
      expect([label, isEditorPageInfo(value)]).toEqual([label, false]);
    }
  });

  it('accepts valid branch names and refuses malformed ones', () => {
    for (const name of ['main', 'feature/x-1', 'release-2026.10']) {
      expect([name, isValidBranchName(name)]).toEqual([name, true]);
    }
    for (const name of ['-x', '/x', 'x/', 'x.', 'x.lock', 'a/.b', 'a b', 'a~b', '@', 'a@{b', 'a//b']) {
      expect([name, isValidBranchName(name)]).toEqual([name, false]);
    }
  });
});

describe('isFromVercel', () => {
  it('reads an x-vercel-* header or a Vercel sign-in redirect as Vercel, anything else not', () => {
    expect(isFromVercel(new Headers({ 'x-vercel-id': 'fra1::abc' }))).toBe(true);
    expect(isFromVercel(new Headers({ location: 'https://vercel.com/sso-api?url=x' }))).toBe(true);
    expect(isFromVercel(new Headers({ location: 'https://www.site.example/', server: 'Vercel' }))).toBe(false);
    expect(isFromVercel(new Headers())).toBe(false);
  });
});

describe('classifyEditorHostResponse', () => {
  const expected = { repoUri: 'acme/site', siteId: 'default', protocols: { min: 1, max: 1 } };
  const answer = { status: 200, contentType: 'application/json', location: null, vercel: false, body: null };
  const json = (value: EditorPageInfo) => ({ ...answer, body: JSON.stringify(value) });
  const page = { ...info, repo: 'acme/site' };
  const statusOf = (response: Parameters<typeof classifyEditorHostResponse>[0]) =>
    classifyEditorHostResponse(response, expected).status;

  it('maps the HTTP status before reading the body', () => {
    expect(statusOf({ ...answer, status: 500 })).toBe('unreachable');
    expect(statusOf({ ...answer, status: 429 })).toBe('unreachable');
    expect(statusOf({ ...answer, status: 401 })).toBe('protected');
    expect(statusOf({ ...answer, status: 403 })).toBe('protected');
    expect(statusOf({ ...answer, status: 404 })).toBe('not-found');
  });

  it('calls a redirect to Vercel protected and any other redirect invalid', () => {
    const location = 'https://vercel.com/sso-api?url=https%3A%2F%2Fsite.example%2F';
    expect(statusOf({ ...answer, status: 302, location, vercel: true })).toBe('protected');
    expect(statusOf({ ...answer, status: 307, location: 'https://acme.vercel.com/login' })).toBe('protected');
    expect(statusOf({ ...answer, status: 301, location: 'https://www.site.example/', vercel: true })).toBe('invalid');
    expect(statusOf({ ...answer, status: 302, location: 'https://notvercel.com/' })).toBe('invalid');
    expect(statusOf({ ...answer, status: 302, location: '/elsewhere' })).toBe('invalid');
  });

  it('reads a host fallback page as not-found', () => {
    expect(statusOf({ ...json(page), contentType: 'text/html; charset=utf-8' })).toBe('not-found');
    expect(statusOf({ ...answer, body: '<!doctype html><title>Home</title>' })).toBe('not-found');
    expect(statusOf({ ...answer, body: '\n  <html></html>' })).toBe('not-found');
  });

  it('calls an unreadable or malformed file invalid', () => {
    expect(statusOf(answer)).toBe('invalid');
    expect(statusOf({ ...answer, body: 'not json' })).toBe('invalid');
    expect(statusOf(json({ ...page, commit: 'abc' }))).toBe('invalid');
    expect(statusOf(json({ ...page, builtWith: 'x' }))).toBe('invalid');
    expect(statusOf(json({ ...page, branch: 'a..b' }))).toBe('invalid');
  });

  it('checks protocol, repository and site, keeping the parsed file', () => {
    expect(classifyEditorHostResponse(json({ ...page, protocol: 2 }), expected)).toEqual({
      status: 'unsupported-protocol',
      info: { ...page, protocol: 2 },
    });
    expect(classifyEditorHostResponse(json({ ...page, repo: 'Acme/Site' }), expected)).toEqual({
      status: 'ready',
      info: { ...page, repo: 'Acme/Site' },
    });
    expect(classifyEditorHostResponse(json({ ...page, repo: null }), expected)).toEqual({
      status: 'wrong-repo',
      reason: 'repo-missing',
      info: { ...page, repo: null },
    });
    expect(statusOf(json({ ...page, repo: 'other/x' }))).toBe('wrong-repo');
    expect(statusOf(json({ ...page, siteId: 'blog' }))).toBe('wrong-site');
  });
});

describe('classifyFrameHeaders', () => {
  const allowed = ['https://*.conloca.com', 'https://team-one.conloca.com'];
  const frame = (xFrameOptions: string | null, csp: string | null) =>
    classifyFrameHeaders({ xFrameOptions, csp }, allowed);

  it('is blocked by X-Frame-Options or a frame-ancestors list without the workspace', () => {
    expect(frame('SAMEORIGIN', null)).toBe('frame-blocked');
    expect(frame('deny', null)).toBe('frame-blocked');
    expect(frame(null, "frame-ancestors 'self'")).toBe('frame-blocked');
    expect(frame(null, "frame-ancestors 'none'")).toBe('frame-blocked');
    expect(frame(null, 'frame-ancestors https://*.conloca.com, frame-ancestors https://other.example')).toBe(
      'frame-blocked',
    );
  });

  it('is ok when frame-ancestors admits a workspace parent or nothing restricts framing', () => {
    expect(frame(null, 'frame-ancestors https:')).toBe('ok');
    expect(frame(null, 'frame-ancestors *')).toBe('ok');
    expect(frame(null, "default-src 'self'; frame-ancestors 'self' HTTPS://*.Conloca.com")).toBe('ok');
    expect(frame(null, 'frame-ancestors https://team-one.conloca.com/')).toBe('ok');
    expect(frame(null, null)).toBe('ok');
    expect(frame(null, "default-src 'self'")).toBe('ok');
    expect(frame('ALLOW-FROM https://team-one.conloca.com', null)).toBe('ok');
  });

  it('lets frame-ancestors override X-Frame-Options, as browsers do', () => {
    expect(frame('SAMEORIGIN', 'frame-ancestors https://*.conloca.com')).toBe('ok');
  });

  it('reads only the first frame-ancestors directive of a policy, as browsers do', () => {
    expect(frame(null, "frame-ancestors https://*.conloca.com; frame-ancestors 'none'")).toBe('ok');
    expect(frame(null, "frame-ancestors 'none'; frame-ancestors https://*.conloca.com")).toBe('frame-blocked');
  });
});
