import { describe, expect, test } from 'bun:test';
import { resolveBuildSiteId } from '../site-id.js';

const files = (map: Record<string, string>) => (path: string) => {
  if (!(path in map)) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
  return map[path];
};

describe('resolveBuildSiteId', () => {
  test('explicit top-level siteId is read from <CONLOCA_CONTENT_ROOT>/sites.json', () => {
    const read = files({
      'targets/website/content/sites.json': JSON.stringify({
        siteId: 'website',
        sites: {},
        globalLocales: ['en'],
      }),
    });
    expect(resolveBuildSiteId({ contentRoot: 'targets/website/content', override: undefined, readFile: read })).toBe(
      'website',
    );
  });

  test('clean file WITHOUT a siteId → implicit "default" (zero-config repo, NOT an error)', () => {
    const read = files({ 'content/sites.json': JSON.stringify({ sites: {}, globalLocales: ['en'] }) });
    expect(resolveBuildSiteId({ contentRoot: 'content', override: undefined, readFile: read })).toBe('default');
  });

  test('missing file, unparseable file, and no-sites-object all FAIL the build', () => {
    expect(() => resolveBuildSiteId({ contentRoot: 'content', override: undefined, readFile: files({}) })).toThrow(
      /sites\.json/,
    );
    expect(() =>
      resolveBuildSiteId({
        contentRoot: 'content',
        override: undefined,
        readFile: files({ 'content/sites.json': '{not json' }),
      }),
    ).toThrow(/parse/i);
    expect(() =>
      resolveBuildSiteId({
        contentRoot: 'content',
        override: undefined,
        readFile: files({ 'content/sites.json': JSON.stringify({ globalLocales: ['en'] }) }),
      }),
    ).toThrow(/sites/);
  });

  test('invalid slug in the file FAILS the build', () => {
    const read = files({
      'content/sites.json': JSON.stringify({ siteId: 'Bad Slug', sites: {}, globalLocales: ['en'] }),
    });
    expect(() => resolveBuildSiteId({ contentRoot: 'content', override: undefined, readFile: read })).toThrow(/siteId/);
  });

  test('override: agrees with the channel → ok; differs → FAIL (both explicit and implicit-default)', () => {
    const explicit = files({
      'content/sites.json': JSON.stringify({ siteId: 'website', sites: {}, globalLocales: ['en'] }),
    });
    expect(resolveBuildSiteId({ contentRoot: 'content', override: 'website', readFile: explicit })).toBe('website');
    expect(() => resolveBuildSiteId({ contentRoot: 'content', override: 'other', readFile: explicit })).toThrow(
      /override/,
    );
    const idless = files({ 'content/sites.json': JSON.stringify({ sites: {}, globalLocales: ['en'] }) });
    // An override quietly beating the implicit default would mis-attach a zero-id root's build.
    expect(() => resolveBuildSiteId({ contentRoot: 'content', override: 'other', readFile: idless })).toThrow(
      /override/,
    );
  });

  test('CMS-less build: override stands alone; neither channel nor override FAILS', () => {
    expect(resolveBuildSiteId({ contentRoot: undefined, override: 'api-docs', readFile: files({}) })).toBe('api-docs');
    expect(() => resolveBuildSiteId({ contentRoot: undefined, override: undefined, readFile: files({}) })).toThrow(
      /CONLOCA_CONTENT_ROOT/,
    );
  });
});
