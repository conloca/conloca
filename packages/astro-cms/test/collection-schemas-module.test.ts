import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { definePageSchema } from '@conloca/cms-spa/page-schemas';
import { z } from 'zod';
import { pageCollectionSchema, previewCollectionSchemas } from '../src/internal/collection-schemas.js';
import { generateContentSchemasModule } from '../src/lib/virtual-module-generators.js';
import type { ResolvedRoutingConfig } from '../src/types.js';

// The generated module is what a preview render reads its schema inputs from,
// so it is evaluated here as written, against a module on disk.
async function evaluate(source: string, dir: string): Promise<{ loadContentSchemas(): Promise<unknown> }> {
  const modulePath = join(dir, 'content-schemas.mjs');
  writeFileSync(modulePath, source);
  return import(pathToFileURL(modulePath).href);
}

describe('generateContentSchemasModule', () => {
  test("loads the site's contentSchemasPath module", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'conloca-content-schemas-'));
    try {
      const schemasPath = join(dir, 'page-schemas.mjs');
      writeFileSync(schemasPath, 'export const pageSchemas = { "/blog/": {} };\n');
      const { loadContentSchemas } = await evaluate(generateContentSchemasModule(schemasPath), dir);
      expect(await loadContentSchemas()).toMatchObject({ pageSchemas: { '/blog/': {} } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a site that names no module has no schema inputs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'conloca-content-schemas-'));
    try {
      const { loadContentSchemas } = await evaluate(generateContentSchemasModule(undefined), dir);
      expect(await loadContentSchemas()).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('previewCollectionSchemas', () => {
  const routing = {
    enabled: true,
    locale: 'en',
    siteName: 'default',
    fallback: '404',
    routes: { pages: { pattern: '/[...slug]', collection: 'pages', dataBindings: { collections: ['events'] } } },
  } as unknown as ResolvedRoutingConfig;
  const pageSchemas = { '/blog/': definePageSchema({ schema: z.object({ author: z.string().optional() }) }) };
  const dataSchemas = { events: z.object({ startsAt: z.coerce.date(), badge: z.string().default('new') }) };

  test('builds the page schema conlocaPages declares and parses publish dates', () => {
    const schemas = previewCollectionSchemas(routing, { pageSchemas });
    const page = { id: 'p', locale: 'en', title: 'T', pathname: '/blog/p', publishAt: '2026-09-08T00:00:00.000Z' };
    const parsed = schemas.pages.parse(page) as { publishAt: Date };
    const built: unknown = pageCollectionSchema(pageSchemas).parse(page);
    expect(parsed).toEqual(built as { publishAt: Date });
    expect(parsed.publishAt).toBeInstanceOf(Date);
    expect(schemas.pages.safeParse({ ...page, author: 42 }).success).toBe(false);
  });

  test("runs a bound data collection's payload schema: coerced dates and defaults", () => {
    const schemas = previewCollectionSchemas(routing, { dataSchemas });
    const parsed = schemas.events.parse({
      id: 'e',
      locale: 'en',
      name: 'e',
      title: 'E',
      data: { startsAt: '2026-10-01' },
    }) as { data: { startsAt: Date; badge: string } };
    expect(parsed.data.startsAt).toBeInstanceOf(Date);
    expect(parsed.data.badge).toBe('new');
  });

  test('declares the fragments aggregate', () => {
    expect(Object.keys(previewCollectionSchemas(routing, {}))).toEqual(['__conloca_fragments', 'pages', 'events']);
  });
});
