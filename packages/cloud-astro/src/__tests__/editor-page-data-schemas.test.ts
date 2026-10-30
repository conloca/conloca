import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { emitDataSchemas } from '../editor-page/data-schemas.js';

/** What typia's `json.schema<T>()` generates: an `IJsonSchemaUnit` 3.1. */
const UNIT = {
  version: '3.1',
  schema: { $ref: '#/components/schemas/Member' },
  components: {
    schemas: {
      Member: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    },
  },
};

let projectDir: string;
let folder: string;
let schemasPath: string;

function makeLogger(): { warn(message: string): void; warnings: string[] } {
  const warnings: string[] = [];
  return { warn: (message) => warnings.push(message), warnings };
}

async function emit(plugins: Plugin[] = []) {
  const logger = makeLogger();
  await emitDataSchemas({ folder, root: projectDir, vite: { plugins }, schemasPath, logger });
  return logger;
}

beforeEach(async () => {
  // Real path: Vite resolves symlinks (macOS's /var), and the transform test compares module ids.
  projectDir = await realpath(await mkdtemp(join(tmpdir(), 'editor-page-data-schemas-')));
  folder = join(projectDir, 'dist', '_conloca', 'editor');
  await mkdir(folder, { recursive: true });
  schemasPath = join(projectDir, 'schemas.ts');
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe('emitDataSchemas', () => {
  it('writes each collection’s generated JSON schema metadata', async () => {
    await writeFile(
      schemasPath,
      [
        `const UNIT = ${JSON.stringify(UNIT)};`,
        'const validate = () => ({ success: true });',
        'export const dataSchemas = {',
        '  team: { validate, metadata: UNIT },',
        '  noMetadata: { validate },',
        "  noComponents: { validate, metadata: { version: '3.1', schema: {} } },",
        '  people: { validate, metadata: UNIT },',
        '};',
      ].join('\n'),
    );

    const logger = await emit();

    const text = await readFile(join(folder, 'data-schemas.json'), 'utf8');
    // toEqual ignores key order, and the keys keep the dataSchemas order.
    expect(JSON.parse(text)).toEqual({ collections: { team: UNIT, people: UNIT } });
    expect(Object.keys(JSON.parse(text).collections)).toEqual(['team', 'people']);
    expect(logger.warnings).toEqual([]);
  });

  it('writes no file when the module exports no dataSchemas', async () => {
    await writeFile(schemasPath, "export const pageSchemas = { 'type:mdx': { label: 'MDX page' } };\n");

    const logger = await emit();

    expect(existsSync(join(folder, 'data-schemas.json'))).toBe(false);
    expect(logger.warnings).toEqual([]);
  });

  it('runs the site’s Vite transforms over the schemas module', async () => {
    await writeFile(schemasPath, 'export const dataSchemas = { team: { metadata: __UNIT__ } };\n');
    const transform: Plugin = {
      name: 'test-transform',
      transform(source, id) {
        if (id !== schemasPath) return null;
        return source.replace('__UNIT__', JSON.stringify(UNIT));
      },
    };

    await emit([transform]);

    expect(JSON.parse(await readFile(join(folder, 'data-schemas.json'), 'utf8'))).toEqual({
      collections: { team: UNIT },
    });
  });

  it('warns once and writes nothing when the module throws on import', async () => {
    await writeFile(schemasPath, "throw new Error('schema compiler rejected the author type');\n");

    const logger = await emit();

    expect(existsSync(join(folder, 'data-schemas.json'))).toBe(false);
    expect(logger.warnings).toHaveLength(1);
    expect(logger.warnings[0]).toContain(schemasPath);
    expect(logger.warnings[0]).toContain('schema compiler rejected the author type');
  });
});
