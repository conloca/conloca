import { describe, expect, test } from 'bun:test';
import matter from 'gray-matter';
import { serializeMdxWithFrontmatter } from '../src/content-utils';

describe('serializeMdxWithFrontmatter', () => {
  test('emits keys in canonical order regardless of input order', () => {
    const out = serializeMdxWithFrontmatter(
      {
        modified: '2026-05-07T18:07:39.049Z',
        id: 'vx-abc',
        title: 'Hello',
        created: '2026-05-07T18:07:39.049Z',
        description: 'A page',
      },
      'body\n',
    );

    const yamlBlock = out.split('---\n')[1] ?? '';
    const keyOrder = yamlBlock
      .split('\n')
      .map((line) => line.match(/^(\w+):/)?.[1])
      .filter((k): k is string => Boolean(k));

    expect(keyOrder).toEqual(['title', 'description', 'id', 'created', 'modified']);
  });

  test('appends unknown keys after the canonical block, alphabetized', () => {
    const out = serializeMdxWithFrontmatter(
      {
        zeta: 1,
        alpha: 2,
        id: 'vx-abc',
        title: 'Hello',
        beta: 3,
      },
      '',
    );

    const yamlBlock = out.split('---\n')[1] ?? '';
    const keyOrder = yamlBlock
      .split('\n')
      .map((line) => line.match(/^(\w+):/)?.[1])
      .filter((k): k is string => Boolean(k));

    expect(keyOrder).toEqual(['title', 'id', 'alpha', 'beta', 'zeta']);
  });

  test('single-quotes ISO 8601 timestamp strings', () => {
    const out = serializeMdxWithFrontmatter(
      {
        id: 'vx-abc',
        created: '2025-08-04T21:04:24.692Z',
        modified: '2026-05-07T18:07:39.049Z',
      },
      '',
    );

    expect(out).toContain("created: '2025-08-04T21:04:24.692Z'");
    expect(out).toContain("modified: '2026-05-07T18:07:39.049Z'");
  });

  test('leaves non-timestamp strings as plain scalars', () => {
    const out = serializeMdxWithFrontmatter(
      {
        title: 'Welcome Hero',
        id: 'vx-abc',
      },
      '',
    );

    expect(out).toContain('title: Welcome Hero\n');
    expect(out).not.toContain("title: 'Welcome Hero'");
  });

  test('canonical fixture round-trips without diff', () => {
    const original = [
      '---',
      'title: Welcome Hero',
      'category: headers',
      'description: A hero section for the welcome page',
      'id: vx-6RmcMpA0',
      "created: '2025-08-04T21:04:24.692Z'",
      "modified: '2025-08-04T21:04:24.692Z'",
      '---',
      '',
      '# Build Better Websites with Ligma CMS',
      '',
      'Experience the power of visual editing with **Puck**.',
      '',
    ].join('\n');

    const parsed = matter(original);
    const out = serializeMdxWithFrontmatter(parsed.data, parsed.content);
    expect(out).toBe(original);
  });

  test('publishAt/unpublishAt placed after modified in canonical order', () => {
    const out = serializeMdxWithFrontmatter(
      {
        id: 'vx-abc',
        publishAt: '2026-01-01T00:00:00.000Z',
        modified: '2026-05-07T18:07:39.049Z',
        unpublishAt: '2026-12-31T23:59:59.000Z',
        created: '2026-05-07T18:07:39.049Z',
      },
      '',
    );

    const yamlBlock = out.split('---\n')[1] ?? '';
    const keyOrder = yamlBlock
      .split('\n')
      .map((line) => line.match(/^(\w+):/)?.[1])
      .filter((k): k is string => Boolean(k));

    expect(keyOrder).toEqual(['id', 'created', 'modified', 'publishAt', 'unpublishAt']);
  });
});
