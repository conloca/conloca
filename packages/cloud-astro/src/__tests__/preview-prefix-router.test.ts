import { describe, expect, it } from 'bun:test';
import { previewLabel } from '../preview/label.js';
import { isEntryCodeShape } from '../preview/middleware.js';
import { answerExit, holdsPreviewCredential, routePrefixed } from '../preview/prefix-router.js';

const SLUG = 'bWFpbg';
const route = (path: string, base = '/') => routePrefixed(new URL(path, 'https://site.test'), base, 'd3');

describe('routePrefixed', () => {
  it('classifies the request', () => {
    expect(route('/x')).toEqual({ kind: 'outside' });
    // D3's `/_image` stays the dispatcher's own; d8 moves the endpoint under the route, never a slug.
    expect(route('/_image')).toEqual({ kind: 'outside' });
    expect(route('/_conloca/preview/_image')).toEqual({ kind: 'image' });
    expect(routePrefixed(new URL('https://site.test/_conloca/preview/_image'), '/', 'd8')).toEqual({ kind: 'image' });
    expect(route('/_conloca/preview/__exit')).toEqual({ kind: 'exit', slug: undefined });
    expect(route(`/_conloca/preview/${SLUG}/__exit`)).toEqual({ kind: 'exit', slug: SLUG });
    expect(route('/_conloca/preview/about')).toEqual({ kind: 'slugless', inner: '/about', entering: false });
    expect(route('/_conloca/preview/about?conloca_code=Z2l0aHViOjc.abcdefghijklmnopqrstuv')).toMatchObject({
      kind: 'slugless',
      entering: true,
    });
  });

  it('takes the slug, the page and the route under a base', () => {
    const got = route(`/docs/_conloca/preview/${SLUG}/fr/about?x=1`, '/docs/');
    expect(got).toMatchObject({
      kind: 'slugged',
      slug: SLUG,
      rest: ['fr', 'about'],
      inner: '/docs/fr/about',
      route: `/docs/_conloca/preview/${SLUG}`,
      entering: false,
    });
    expect(got.kind === 'slugged' && got.page.href).toBe('https://site.test/docs/fr/about?x=1');
  });
});

describe('holdsPreviewCredential', () => {
  it("reads only the slug's pass cookie", () => {
    expect(holdsPreviewCredential(`__Secure-conloca_preview_${SLUG}=p`, 'd3', '/', SLUG)).toBe(true);
    expect(holdsPreviewCredential('other=1', 'd3', '/', SLUG)).toBe(false);
    expect(holdsPreviewCredential(null, 'd3', '/', SLUG)).toBe(false);
  });
});

describe('answerExit', () => {
  const url = new URL('https://site.test/_conloca/preview/__exit?to=%2F');

  it('leaves for the base without a label when there is no preview build', async () => {
    const answer = await answerExit(url, undefined, null, '/', 'https://cms.test', 'd3');
    expect(answer.status).toBe(302);
    expect(answer.headers.get('location')).toBe('/');
    expect(answer.headers.get('conloca-preview')).toBeNull();
    expect(answer.headers.get('cache-control')).toBe('private, no-store');
  });

  it('answers with the label, the protocol and the mode', async () => {
    const exit = { repo: 'acme/site', siteId: 'website', branch: 'main', audience: 'acme/site' };
    const answer = await answerExit(url, undefined, exit, '/', 'https://cms.test', 'd8');
    expect(answer.status).toBe(302);
    expect(answer.headers.get('conloca-preview')).toBe(await previewLabel('acme/site', 'website', 'main'));
    expect(answer.headers.get('conloca-preview-protocol')).toBe('2');
    expect(answer.headers.get('conloca-preview-mode')).toBe('d8');
  });
});

describe('isEntryCodeShape', () => {
  it('accepts `<org token>.<secret>` only', () => {
    expect(isEntryCodeShape('Z2l0aHViOjc.abcdefghijklmnopqrstuv')).toBe(true);
    expect(isEntryCodeShape('x')).toBe(false);
    expect(isEntryCodeShape('a.b')).toBe(false);
    expect(isEntryCodeShape('Z2l0aHViOjc.abcdefghijklmnopqrstuv.x')).toBe(false);
    // `Z2l0aHViOjd` decodes to the same bytes but is not how they encode.
    expect(isEntryCodeShape('Z2l0aHViOjd.abcdefghijklmnopqrstuv')).toBe(false);
  });
});
