import { describe, expect, it } from 'bun:test';
import { linkRewriter } from '../preview/dispatcher.js';
import { rewritePreviewLinks } from '../preview/links.js';

const page = new URL('https://s.example/about/');
const route = '/_conloca/preview/bWFpbg';
const hosts: ReadonlySet<string> = new Set(['s.example']);
const rewrite = (html: string) => rewritePreviewLinks(html, page, route, '', hosts);
const strip = (html: string) => html.replaceAll(' data-astro-prefetch="false"', '');

describe('rewritePreviewLinks', () => {
  it('moves a page link and turns its prefetch off', () => {
    expect(rewrite('<a href="/contact">x</a>')).toBe(`<a href="${route}/contact" data-astro-prefetch="false">x</a>`);
  });

  it('re-escapes a moved value', () => {
    expect(rewrite(`<a href='/q?a=1&amp;b="2"'>x</a>`)).toBe(
      `<a href="${route}/q?a=1&amp;b=%222%22" data-astro-prefetch="false">x</a>`,
    );
    expect(rewrite('<a href="/q?a=1&amp;b=&quot;2&quot;">x</a>')).toBe(
      `<a href="${route}/q?a=1&amp;b=%222%22" data-astro-prefetch="false">x</a>`,
    );
    expect(rewrite(`<form action='/s?x=a>b&c'></form>`)).toBe(`<form action="${route}/s?x=a%3Eb&amp;c"></form>`);
  });

  it('replaces an existing prefetch attribute instead of adding a second', () => {
    expect(rewrite('<a data-astro-prefetch href=/c>x</a>')).toBe(
      `<a data-astro-prefetch="false" href="${route}/c">x</a>`,
    );
  });

  it('leaves untouched bytes identical, script and comments alone', () => {
    const before = [
      '<!doctype html><html><head><title><a href="/t"></title>',
      "<style>a[href='/s']{}</style></head><body>",
      '<!-- <a href="/x"> -->',
      `<script>"<a href='/y'>"</script>`,
      '<textarea><a href="/z"></textarea>',
      '<p class=lead id=\'i\'>K&amp;R <img src=/a.png alt="&quot;"></p>',
      "<a class=c href=/one title='t'>1</a>",
      '<a href="#top">2</a><a href="mailto:a@b.c">3</a><a href="https://other.example/p">4</a>',
      '</body></html>',
    ].join('\n');
    const after = before.replace('href=/one', `href="${route}/one" data-astro-prefetch="false"`);
    expect(rewrite(before)).toBe(after);
  });

  it('resolves links after a base element against it', () => {
    expect(rewrite('<base href="/docs/"><a href="guide">g</a>')).toBe(
      `<base href="${route}/docs/"><a href="${route}/docs/guide" data-astro-prefetch="false">g</a>`,
    );
  });

  it('moves only page candidates in srcset', () => {
    expect(rewrite('<img srcset="/a.png 1x, /b 2x">')).toBe(`<img srcset="/a.png 1x, ${route}/b 2x">`);
  });

  it('matches the Cloudflare rewriter up to prefetch and quote normalisation', async () => {
    const fixture = [
      '<html><head><base href="/en/"></head><body>',
      '<a href="x">1</a><a href="/_astro/a.js">2</a><area href="../y?q=1#h">',
      '<form action="send"></form><picture><source srcset="/p.webp 1x, p 2x"></picture>',
      '<a href="https://s.example/z">3</a><a href="/f.pdf">4</a>',
      '</body></html>',
    ].join('');
    const cloudflare = await linkRewriter(page, route, '', hosts).transform(new Response(fixture)).text();
    expect(strip(rewrite(fixture))).toBe(strip(cloudflare));
  });
});
