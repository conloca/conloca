import { describe, expect, it } from 'vitest';
import { normalizeRoutingConfig, resolveRouteConfig, validateRoutePattern } from '../lib/routing-config.js';

describe('normalizeRoutingConfig', () => {
  it('returns undefined for undefined input', () => {
    const result = normalizeRoutingConfig(undefined);
    expect(result).toBeUndefined();
  });

  it('expands true to full default config', () => {
    const result = normalizeRoutingConfig(true);
    expect(result).toEqual({
      enabled: true,
      routes: {
        pages: {
          pattern: '/[...slug]',
          collection: 'pages',
          prerender: true,
        },
      },
      fallback: '404',
      onConflict: 'warn',
    });
  });

  it('returns { enabled: false } for false input', () => {
    const result = normalizeRoutingConfig(false);
    expect(result).toEqual({ enabled: false });
  });

  it('returns object input unchanged', () => {
    const customConfig = {
      enabled: true,
      routes: {
        blog: {
          pattern: '/blog/[...slug]',
          collection: 'posts',
          prerender: false,
        },
      },
      fallback: 'passthrough' as const,
      onConflict: 'error' as const,
    };
    const result = normalizeRoutingConfig(customConfig);
    expect(result).toEqual(customConfig);
  });
});

describe('resolveRouteConfig', () => {
  it('applies default collection "pages"', () => {
    const result = resolveRouteConfig({ pattern: '/[...slug]' });
    expect(result.collection).toBe('pages');
  });

  it('applies default prerender true', () => {
    const result = resolveRouteConfig({ pattern: '/[...slug]' });
    expect(result.prerender).toBe(true);
  });

  it('applies default meta {}', () => {
    const result = resolveRouteConfig({ pattern: '/[...slug]' });
    expect(result.meta).toEqual({});
  });

  it('applies default layout empty string', () => {
    const result = resolveRouteConfig({ pattern: '/[...slug]' });
    expect(result.layout).toBe('');
  });

  it('preserves explicit values', () => {
    const result = resolveRouteConfig({
      pattern: '/blog/[slug]',
      collection: 'posts',
      layout: './layouts/BlogLayout.astro',
      prerender: false,
      meta: { title: 'Blog' },
    });
    expect(result).toEqual({
      pattern: '/blog/[slug]',
      collection: 'posts',
      layout: './layouts/BlogLayout.astro',
      prerender: false,
      meta: { title: 'Blog' },
      dataBindings: { collections: [] },
    });
  });
});

describe('validateRoutePattern', () => {
  it('accepts valid patterns starting with /', () => {
    expect(() => validateRoutePattern('/[...slug]', 'pages')).not.toThrow();
    expect(() => validateRoutePattern('/blog/[...slug]', 'blog')).not.toThrow();
    expect(() => validateRoutePattern('/docs/[slug]', 'docs')).not.toThrow();
    expect(() => validateRoutePattern('/a/b/c/[id]', 'nested')).not.toThrow();
  });

  it('throws for patterns not starting with /', () => {
    expect(() => validateRoutePattern('[...slug]', 'pages')).toThrow(
      "Route 'pages': pattern must start with '/', got '[...slug]'",
    );
    expect(() => validateRoutePattern('blog/[slug]', 'blog')).toThrow(
      "Route 'blog': pattern must start with '/', got 'blog/[slug]'",
    );
  });

  it('throws for invalid characters', () => {
    expect(() => validateRoutePattern('/path?query', 'invalid')).toThrow(
      "Route 'invalid': pattern contains invalid characters: ?",
    );
    expect(() => validateRoutePattern('/path#hash', 'invalid')).toThrow(
      "Route 'invalid': pattern contains invalid characters: #",
    );
    expect(() => validateRoutePattern('/path with spaces', 'invalid')).toThrow(
      "Route 'invalid': pattern contains invalid characters:  ",
    );
  });

  it('throws for unbalanced brackets', () => {
    expect(() => validateRoutePattern('/[slug', 'unbalanced')).toThrow(
      "Route 'unbalanced': pattern has unbalanced brackets: '/[slug'",
    );
    expect(() => validateRoutePattern('/slug]', 'unbalanced')).toThrow(
      "Route 'unbalanced': pattern has unbalanced brackets: '/slug]'",
    );
    expect(() => validateRoutePattern('/[[slug]', 'unbalanced')).toThrow(
      "Route 'unbalanced': pattern has unbalanced brackets: '/[[slug]'",
    );
  });
});
