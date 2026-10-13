import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { SyntaxKind } from 'ts-morph';
import { createScanProject } from '../src/discovery/extract-props-ts.js';
import { readWrapperCall } from '../src/puck-manifest/read-wrapper.js';
import { Component as runtime } from './fixtures/puck-wrappers/computed-label.js';

test('a computed runtime label is absent only with an explicit label admission', () => {
  const source = createScanProject().addSourceFileAtPath(
    join(import.meta.dir, 'fixtures/puck-wrappers/computed-label.ts'),
  );
  const call = source
    .getVariableDeclarationOrThrow('Component')
    .getInitializerOrThrow()
    .asKindOrThrow(SyntaxKind.CallExpression);
  const result = readWrapperCall(call);
  expect(result.reason).toBeUndefined();
  expect(runtime.label).toBe('Computed');
  expect(result.component).toBeDefined();
  expect(result.component?.label).toBeUndefined();
  expect(result.component?.unreadableKeys).toContain('label');
  expect(result.component?.fields).toEqual(runtime.fields);
});
