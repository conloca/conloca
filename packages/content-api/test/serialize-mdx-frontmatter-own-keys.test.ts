import { describe, expect, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';
import { parse } from 'yaml';
import { FRONT_MATTER, frontMatterText } from '../src/front-matter.js';
import { serializeMdxWithFrontmatter } from '../src/mdx-frontmatter.js';
import type { JsonObject, JsonValue } from '../src/types.js';
import { testTempDir } from './test-temp-dir.js';

function jsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return true;
  }
  if (Array.isArray(value)) return value.every(jsonValue);
  return typeof value === 'object' && !(value instanceof Date) && Object.values(value).every(jsonValue);
}

function mapping(value: unknown): JsonObject {
  if (!jsonValue(value) || typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected JSON frontmatter mapping');
  }
  return value;
}

function readFrontmatter(source: string): JsonObject {
  const block = frontMatterText(source);
  if (block === '') throw new Error('Missing frontmatter');
  return mapping(parse(block));
}

const SPECIAL_KEYS = ['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty'];

describe('MDX frontmatter own keys', () => {
  test.each(SPECIAL_KEYS)('serializes %s as an own data key', (key) => {
    const input = Object.fromEntries([
      ['title', 'Author data'],
      [key, 'kept'],
    ]);
    const output = readFrontmatter(serializeMdxWithFrontmatter(input, '# Body\n'));
    expect(Object.hasOwn(output, key)).toBe(true);
    expect(output[key]).toBe('kept');
    expect(Object.getPrototypeOf(input)).toBe(Object.prototype);
    expect(input[key]).toBe('kept');
  });

  test('keeps nested prototype-shaped values without modifying the input or global prototypes', () => {
    const input = mapping(
      JSON.parse(
        '{"__proto__":{"frontmatterPolluted":true},"constructor":{"prototype":{"nested":"data"}},"title":"Own"}',
      ),
    );
    const before = JSON.stringify(input);
    const prototypeBefore = Object.getOwnPropertyDescriptors(Object.prototype);
    const output = readFrontmatter(serializeMdxWithFrontmatter(input, 'body'));
    expect(output).toEqual(input);
    expect(Object.hasOwn(output, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(output)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(prototypeBefore);
    expect(JSON.stringify(input)).toBe(before);
  });

  test('preserves own prototype-shaped keys in raw nested mappings and array entries', () => {
    const input = mapping(
      JSON.parse(
        '{"title":"Nested","nested":{"__proto__":{"saved":true},"constructor":{"prototype":{"marker":"kept"}}},"rows":[{"__proto__":"row-data","constructor":"row-constructor"}]}',
      ),
    );
    const before = JSON.stringify(input);
    const prototypeBefore = Object.getOwnPropertyDescriptors(Object.prototype);
    const output = readFrontmatter(serializeMdxWithFrontmatter(input, 'body'));
    const nested = mapping(output.nested);
    const rows = output.rows;
    if (!Array.isArray(rows)) throw new Error('Expected fixture rows');
    const row = mapping(rows[0]);

    expect(Object.getOwnPropertyDescriptor(nested, '__proto__')?.value).toEqual({ saved: true });
    expect(Object.getOwnPropertyDescriptor(nested, 'constructor')?.value).toEqual({ prototype: { marker: 'kept' } });
    expect(Object.getOwnPropertyDescriptor(row, '__proto__')?.value).toBe('row-data');
    expect(Object.getOwnPropertyDescriptor(row, 'constructor')?.value).toBe('row-constructor');
    expect(Object.getPrototypeOf(output)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(nested)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(prototypeBefore);
    expect(JSON.stringify(input)).toBe(before);
  });

  test('ignores inherited canonical metadata instead of persisting it as author data', () => {
    const input = mapping(Object.create({ title: 'Inherited', description: 'Inherited' }));
    input.id = 'vx-own';
    const output = readFrontmatter(serializeMdxWithFrontmatter(input, ''));
    expect(output).toEqual({ id: 'vx-own' });
  });

  test('preserves the canonical prefix and alphabetical own-key suffix', () => {
    const input = Object.fromEntries([
      ['valueOf', 'value'],
      ['__proto__', 'proto'],
      ['constructor', 'ctor'],
      ['zeta', 'last'],
      ['title', 'First'],
      ['id', 'vx-own'],
      ['alpha', 'earlier'],
    ]);
    const output = serializeMdxWithFrontmatter(input, '');
    expect(Object.keys(readFrontmatter(output))).toEqual([
      'title',
      'id',
      '__proto__',
      'alpha',
      'constructor',
      'valueOf',
      'zeta',
    ]);
  });

  test('retains every Object.prototype name across repeated parse and save cycles', () => {
    const keys = Object.getOwnPropertyNames(Object.prototype);
    for (const reverse of [false, true]) {
      const entries: [string, string][] = keys.map((key, index) => [key, `author-${index}`]);
      const ordered = reverse
        ? entries.reduceRight<[string, string][]>((acc, entry) => {
            acc.push(entry);
            return acc;
          }, [])
        : entries;
      const input = Object.fromEntries(ordered);
      let output = serializeMdxWithFrontmatter(input, '\n# Stable body\n');
      for (let round = 0; round < 3; round++) {
        const parsed = matter(output, FRONT_MATTER);
        const data = mapping(parsed.data);
        expect(new Set(Object.keys(data))).toEqual(new Set(keys));
        expect(Object.keys(data)).toHaveLength(keys.length);
        for (const key of keys) expect(data[key]).toBe(input[key]);
        const next = serializeMdxWithFrontmatter(data, parsed.content);
        expect(next).toBe(output);
        output = next;
      }
    }
  });
});

describe('MDX frontmatter file round trip', () => {
  test('keeps special author keys when an MDX file is parsed, saved and reloaded', async () => {
    const dir = testTempDir('content-api-frontmatter');
    try {
      await mkdir(dir, { recursive: true });
      const path = join(dir, 'page.en.mdx');
      const source = '---\ntitle: Before\n__proto__:\n  saved: true\nconstructor: author-value\n---\n\n# Kept body\n';
      await writeFile(path, source);
      const loaded = matter(await readFile(path, 'utf8'), FRONT_MATTER);
      const metadata = mapping(loaded.data);
      metadata.title = 'After';
      await writeFile(path, serializeMdxWithFrontmatter(metadata, loaded.content));
      const saved = matter(await readFile(path, 'utf8'), FRONT_MATTER);
      const savedData = mapping(saved.data);
      expect(savedData.title).toBe('After');
      expect(Object.hasOwn(saved.data, '__proto__')).toBe(true);
      expect(Object.getOwnPropertyDescriptor(saved.data, '__proto__')?.value).toEqual({ saved: true });
      expect(Object.hasOwn(saved.data, 'constructor')).toBe(true);
      expect(Object.getOwnPropertyDescriptor(saved.data, 'constructor')?.value).toBe('author-value');
      expect(Object.getPrototypeOf(saved.data)).toBe(Object.prototype);
      expect(saved.content).toBe('\n# Kept body\n');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
