import { describe, expect, it } from 'bun:test';
import { extractSlugFromPathname, pathnameFromSlug } from '../src/lib/route-utils.js';

describe('extractSlugFromPathname', () => {
  it('extracts slug from catch-all pattern', () => {
    // /[...slug] + /about -> 'about'
    const result = extractSlugFromPathname('/about', '/[...slug]');
    expect(result).toBe('about');
  });

  it('handles root path returning undefined', () => {
    // /[...slug] + / -> undefined
    const result = extractSlugFromPathname('/', '/[...slug]');
    expect(result).toBeUndefined();
  });

  it('handles prefixed patterns', () => {
    // /blog/[...slug] + /blog/post-1 -> 'post-1'
    const result = extractSlugFromPathname('/blog/post-1', '/blog/[...slug]');
    expect(result).toBe('post-1');
  });

  it('handles nested paths', () => {
    // /[...slug] + /a/b/c -> 'a/b/c'
    const result = extractSlugFromPathname('/a/b/c', '/[...slug]');
    expect(result).toBe('a/b/c');
  });

  it('handles prefixed pattern with root returning undefined', () => {
    // /blog/[...slug] + /blog -> undefined
    const result = extractSlugFromPathname('/blog', '/blog/[...slug]');
    expect(result).toBeUndefined();
  });

  it('handles prefixed pattern with nested paths', () => {
    // /docs/[...path] + /docs/guide/getting-started -> 'guide/getting-started'
    const result = extractSlugFromPathname('/docs/guide/getting-started', '/docs/[...path]');
    expect(result).toBe('guide/getting-started');
  });
});

describe('pathnameFromSlug', () => {
  it('converts undefined slug to root path', () => {
    // undefined + /[...slug] -> '/'
    const result = pathnameFromSlug(undefined, '/[...slug]');
    expect(result).toBe('/');
  });

  it('converts slug to pathname', () => {
    // 'about' + /[...slug] -> '/about'
    const result = pathnameFromSlug('about', '/[...slug]');
    expect(result).toBe('/about');
  });

  it('handles prefixed patterns', () => {
    // 'post-1' + /blog/[...slug] -> '/blog/post-1'
    const result = pathnameFromSlug('post-1', '/blog/[...slug]');
    expect(result).toBe('/blog/post-1');
  });

  it('converts undefined slug with prefix to prefix path', () => {
    // undefined + /blog/[...slug] -> '/blog'
    const result = pathnameFromSlug(undefined, '/blog/[...slug]');
    expect(result).toBe('/blog');
  });

  it('handles nested slug paths', () => {
    // 'a/b/c' + /[...slug] -> '/a/b/c'
    const result = pathnameFromSlug('a/b/c', '/[...slug]');
    expect(result).toBe('/a/b/c');
  });

  it('handles prefixed pattern with nested slug', () => {
    // 'guide/getting-started' + /docs/[...path] -> '/docs/guide/getting-started'
    const result = pathnameFromSlug('guide/getting-started', '/docs/[...path]');
    expect(result).toBe('/docs/guide/getting-started');
  });
});
