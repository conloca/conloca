import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createScanProject } from '../src/discovery/extract-props-ts.js';
import { readFieldSet } from '../src/puck-manifest/read-field.js';

/** Every generated module is test-owned code; no user configuration is executed. */
test('bounded builder compositions match their executed fields in both spread orders', async () => {
  const root = mkdtempSync(join(tmpdir(), 'puck-field-grammar-'));
  try {
    let index = 0;
    for (const type of ['text', 'number']) {
      for (const override of ['{}', '{ label: "" }', '{ min: 0, max: 3 }', '{ max: 0 }']) {
        for (const order of ['...base, ...overrides', '...overrides, ...base']) {
          const path = join(root, `case-${index++}.ts`);
          writeFileSync(
            path,
            `const base = { type: '${type}', label: 'Base', max: 9 };
            function build(overrides) { return { ${order} }; }
            export const fields = { item: build(${override}) };`,
          );
          const source = createScanProject().addSourceFileAtPath(path);
          const reading = readFieldSet(source.getVariableDeclarationOrThrow('fields').getInitializerOrThrow());
          const runtime = await import(path);
          expect(reading?.unreadable).toBe(false);
          expect(reading?.fields).toEqual(runtime.fields);
        }
      }
    }
    expect(index).toBe(16);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
