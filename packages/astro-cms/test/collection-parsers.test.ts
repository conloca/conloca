import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { definePageSchema } from '@conloca/cms-spa/page-schemas';
import { previewEntryParsers } from '../src/internal/collection-parsers.js';
import { createPageEntryParser } from '../src/internal/entry-validation.js';
import {
  generateContentSchemasModule,
  generateFragmentComponentsModule,
  generateSiteRenderModule,
} from '../src/lib/virtual-module-generators.js';
import type { ResolvedRoutingConfig } from '../src/types.js';
import { optionalAuthorFields, testimonialPayload } from './fixtures/typia/host-schemas.js';

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

/** Evaluates a generated fragment components module next to a `fragments.mjs` and calls its loader. */
async function load(source: string): Promise<object> {
  const dir = mkdtempSync(join(tmpdir(), 'conloca-fragment-components-'));
  try {
    const modulePath = join(dir, 'fragment-components-virtual.mjs');
    writeFileSync(join(dir, 'fragments.mjs'), 'export const fragmentComponents = { components: {}, elements: {} };\n');
    writeFileSync(modulePath, source.replace(/__DIR__/g, dir));
    const { loadFragmentComponents } = await import(pathToFileURL(modulePath).href);
    return await loadFragmentComponents();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('generateFragmentComponentsModule', () => {
  test("loads the site's fragmentComponentsPath module", async () => {
    expect(await load(generateFragmentComponentsModule('__DIR__/fragments.mjs'))).toMatchObject({
      fragmentComponents: { components: {}, elements: {} },
    });
  });

  test('a site that names no module has no fragment components', async () => {
    expect(await load(generateFragmentComponentsModule(undefined))).toEqual({});
  });

  test('exports the resolved fragmentComponentsPath', () => {
    expect(generateFragmentComponentsModule('/abs/fc.tsx')).toContain(
      'export const fragmentComponentsPath = "/abs/fc.tsx"',
    );
    expect(generateFragmentComponentsModule(undefined)).toContain('export const fragmentComponentsPath = undefined');
  });
});

describe('generateSiteRenderModule', () => {
  test("imports the site's render module and each frame module", () => {
    const source = generateSiteRenderModule('/a/fragments.tsx', { blog: '/a/f.tsx' });
    expect(source).toContain('import * as fragmentRender from "/a/fragments.tsx"');
    expect(source).toContain('import * as frame0 from "/a/f.tsx"');
    expect(source).toContain('export const editorFrames = { "blog": frame0.default }');
    expect(source).toContain('export { evaluateMDXToComponent } from');
  });

  test('a site with neither imports no render module and has no frames', () => {
    const source = generateSiteRenderModule(undefined, {});
    expect(source).not.toContain('import * as');
    expect(source).toContain('export const fragmentComponents = undefined');
    expect(source).toMatch(/export const editorFrames = \{\s*\}/);
  });
});

describe('previewEntryParsers', () => {
  const routing = {
    enabled: true,
    locale: 'en',
    siteName: 'default',
    fallback: '404',
    routes: { pages: { pattern: '/[...slug]', collection: 'pages', dataBindings: { collections: ['events'] } } },
  } as unknown as ResolvedRoutingConfig;
  const pageSchemas = { '/blog/': definePageSchema({ schema: optionalAuthorFields }) };
  const dataSchemas = { events: testimonialPayload };

  test('builds the page parser conlocaPages declares and parses publish dates', () => {
    const parsers = previewEntryParsers(routing, { pageSchemas });
    const page = { id: 'p', locale: 'en', title: 'T', pathname: '/blog/p', publishAt: '2026-09-08T00:00:00.000Z' };
    const parsed = parsers.pages(page);
    expect(parsed).toEqual(createPageEntryParser(pageSchemas)(page));
    expect(parsed.success && parsed.data.publishAt).toEqual(new Date('2026-09-08T00:00:00.000Z'));
    expect(parsers.pages({ ...page, author: 42 }).success).toBe(false);
  });

  test("runs a bound data collection's payload validator", () => {
    const parsers = previewEntryParsers(routing, { dataSchemas });
    const entry = { id: 'e', locale: 'en', name: 'e', title: 'E' };
    const parsed = parsers.events({ ...entry, data: { quote: 'Great', stray: 1 } });
    expect(parsed.success && parsed.data.data).toEqual({ quote: 'Great' });
    expect(parsers.events({ ...entry, data: { quote: 42 } }).success).toBe(false);
  });

  test('a bound data collection without a payload schema checks only Conloca fields', () => {
    const parsed = previewEntryParsers(routing, {}).events({
      id: 'e',
      locale: 'en',
      name: 'e',
      title: 'E',
      data: { anything: 1 },
    });
    expect(parsed.success && parsed.data.data).toEqual({ anything: 1 });
  });

  test('declares the fragments aggregate', () => {
    expect(Object.keys(previewEntryParsers(routing, {}))).toEqual(['__conloca_fragments', 'pages', 'events']);
  });
});
