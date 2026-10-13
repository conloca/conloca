import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type CallExpression, type Project, SyntaxKind } from 'ts-morph';
import { createScanProject } from '../src/discovery/extract-props-ts.js';
import {
  MAX_WORK,
  spendWork,
  unwrapExpression,
  WorkBudgetExceeded,
  withReadingSession,
} from '../src/puck-manifest/literal.js';
import { readFieldBuilderCall, readWrapperCall } from '../src/puck-manifest/read-wrapper.js';
import type { ManifestField } from '../src/puck-manifest/types.js';
import type { FieldLike } from './fixtures/puck-wrappers/cta-button-array-field.js';

/**
 * Builds a throwaway project on disk — ts-morph needs real files to follow
 * imports — and removes it however the assertions turn out, so a failing run
 * leaves nothing behind in the system temp directory.
 */
function withProject(files: Record<string, string>, body: (project: Project, root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'puck-manifest-'));
  try {
    for (const [relativePath, contents] of Object.entries(files)) {
      const absolute = join(root, relativePath);
      mkdirSync(join(absolute, '..'), { recursive: true });
      writeFileSync(absolute, contents);
    }
    const project = createScanProject();
    for (const relativePath of Object.keys(files)) project.addSourceFileAtPath(join(root, relativePath));
    body(project, root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** The `withLayout(Inner)` of `export const Wrapped = withLayout(Inner)`. */
function callOf(project: Project, root: string, file: string, name: string): CallExpression {
  const declaration = project.getSourceFileOrThrow(join(root, file)).getVariableDeclarationOrThrow(name);
  return unwrapExpression(declaration.getInitializerOrThrow()).asKindOrThrow(SyntaxKind.CallExpression);
}

/** The component every wrapper below is handed: fully written down, so only the wrapper is under test. */
const INNER = [
  'const Inner = {',
  "  label: 'Inner',",
  "  fields: { title: { type: 'text', label: 'Title' }, items: { type: 'slot', disallow: ['Hero'] } },",
  "  defaultProps: { title: 'T' },",
  '  render: () => null,',
  '};',
].join('\n');

describe('readWrapperCall', () => {
  describe('recovers a component the wrapper builds', () => {
    test('the withLayout shape — spreads plus written-down additions, the shape both of our sites use', () => {
      withProject(
        {
          'w.ts': [
            INNER,
            'const layoutField = {',
            "  type: 'object',",
            "  objectFields: { spanCol: { type: 'number', min: 1, max: 12 } },",
            '};',
            'function withLayout(config) {',
            '  return {',
            '    ...config,',
            '    fields: { ...config.fields, layout: layoutField },',
            '    defaultProps: { ...config.defaultProps, layout: { spanCol: 1 } },',
            '    resolveFields: () => ({}),',
            '  };',
            '}',
            'export const Wrapped = withLayout(Inner);',
          ].join('\n'),
        },
        (project, root) => {
          const { component, reason } = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
          expect(reason).toBeUndefined();
          expect(component?.label).toBe('Inner');
          expect(component?.fields.title).toEqual({ type: 'text', label: 'Title' });
          expect(component?.fields.items?.disallow).toEqual(['Hero']);
          expect(component?.fields.layout?.type).toBe('object');
          expect(component?.fields.layout?.objectFields?.spanCol?.max).toBe(12);
          expect(component?.defaultProps).toEqual({ title: 'T', layout: { spanCol: 1 } });
          expect(component?.dynamicFields).toBe(true);
        },
      );
    });

    test('a concise arrow body — the return is the object, with no block around it', () => {
      withProject(
        {
          'w.ts': [
            INNER,
            "const withName = (config) => ({ ...config, label: 'X' });",
            'export const Wrapped = withName(Inner);',
          ].join('\n'),
        },
        (project, root) => {
          const { component } = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
          expect(component?.label).toBe('X');
          expect(component?.fields.title?.type).toBe('text');
        },
      );
    });

    test('a defaults-only wrapper keeps the fields it never mentions', () => {
      withProject(
        {
          'w.ts': [
            INNER,
            'function withSize(config) {',
            "  return { ...config, defaultProps: { ...config.defaultProps, size: 'm' } };",
            '}',
            'export const Wrapped = withSize(Inner);',
          ].join('\n'),
        },
        (project, root) => {
          const { component } = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
          expect(component?.defaultProps).toEqual({ title: 'T', size: 'm' });
          expect(component?.fields.title?.type).toBe('text');
          expect(component?.fields.items?.type).toBe('slot');
        },
      );
    });

    test('a spread written after an override wins, exactly as it does at runtime', () => {
      withProject(
        {
          'w.ts': [
            INNER,
            'function withBase(config) {',
            "  return { label: 'FromWrapper', ...config };",
            '}',
            'export const Wrapped = withBase(Inner);',
          ].join('\n'),
        },
        (project, root) => {
          const { component } = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
          expect(component?.label).toBe('Inner');
        },
      );
    });

    test('a passthrough wrapper reads the argument whole', () => {
      withProject(
        {
          'w.ts': [INNER, 'function id(config) {', '  return config;', '}', 'export const Wrapped = id(Inner);'].join(
            '\n',
          ),
        },
        (project, root) => {
          const { component } = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
          expect(component?.label).toBe('Inner');
          expect(component?.defaultProps).toEqual({ title: 'T' });
          expect(Object.keys(component?.fields ?? {})).toEqual(['title', 'items']);
        },
      );
    });

    test('an argument written inline rather than named', () => {
      withProject(
        {
          'w.ts': [
            'function withX(config) {',
            '  return { ...config };',
            '}',
            "export const Wrapped = withX({ fields: { a: { type: 'text' } } });",
          ].join('\n'),
        },
        (project, root) => {
          const { component } = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
          expect(component?.fields.a).toEqual({ type: 'text' });
        },
      );
    });

    test('two parameters, both bound by an argument this reader could resolve', () => {
      withProject(
        {
          'w.ts': [
            INNER,
            'function withMeta(config, opts) {',
            '  return { ...config, label: opts.label };',
            '}',
            "export const Wrapped = withMeta(Inner, { label: 'Named' });",
          ].join('\n'),
        },
        (project, root) => {
          const { component } = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
          expect(component?.label).toBe('Named');
          expect(component?.fields.title?.type).toBe('text');
        },
      );
    });

    test('spreading a key the argument does not declare is an empty spread, not a failure', () => {
      withProject(
        {
          'w.ts': [
            "const Bare = { label: 'Bare', fields: { title: { type: 'text' } }, render: () => null };",
            'function withSize(config) {',
            "  return { ...config, defaultProps: { ...config.defaultProps, size: 'm' } };",
            '}',
            'export const Wrapped = withSize(Bare);',
          ].join('\n'),
        },
        (project, root) => {
          const { component, reason } = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
          expect(reason).toBeUndefined();
          expect(component?.label).toBe('Bare');
          expect(component?.defaultProps).toEqual({ size: 'm' });
          expect(component?.fields.title?.type).toBe('text');
        },
      );
    });
  });

  describe('refuses, with a reason, everything outside the summarizable shape', () => {
    test('a body that is more than one return', () => {
      withProject(
        {
          'w.ts': [
            INNER,
            'function withLocal(config) {',
            '  const x = 1;',
            '  return { ...config, min: x };',
            '}',
            'export const Wrapped = withLocal(Inner);',
          ].join('\n'),
        },
        (project, root) => {
          const reading = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
          expect(reading.component).toBeUndefined();
          expect(reading.reason).toMatch(/statements/);
        },
      );
    });

    test('a return whose value depends on a condition', () => {
      withProject(
        {
          'w.ts': [
            INNER,
            'function withMaybe(config) {',
            "  return config.label ? { ...config, label: 'A' } : config;",
            '}',
            'export const Wrapped = withMaybe(Inner);',
          ].join('\n'),
        },
        (project, root) => {
          const reading = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
          expect(reading.component).toBeUndefined();
          expect(reading.reason).toBeDefined();
        },
      );
    });

    test('an unbound parameter — THE rule that keeps this reader from lying', () => {
      // The probe proved this exact shape lies when the rule is loosened: the
      // body consults opts, the call never binds it, and the summary reports
      // label 'Inner' where the runtime says 'fallback'. It must be refused.
      withProject(
        {
          'w.ts': [
            INNER,
            'function withDefaultOpt(config, opts = {}) {',
            "  return { ...config, label: opts.label ?? 'fallback' };",
            '}',
            'export const Wrapped = withDefaultOpt(Inner);',
          ].join('\n'),
        },
        (project, root) => {
          const reading = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
          expect(reading.component).toBeUndefined();
          expect(reading.reason).toBe('the wrapper takes 2 parameters but the call passes 1');
        },
      );
    });

    test('a destructured parameter', () => {
      withProject(
        {
          'w.ts': [
            INNER,
            'function withPick({ label, fields }) {',
            '  return { label, fields };',
            '}',
            'export const Wrapped = withPick(Inner);',
          ].join('\n'),
        },
        (project, root) => {
          const reading = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
          expect(reading.component).toBeUndefined();
          expect(reading.reason).toMatch(/destructured/);
        },
      );
    });

    test('a wrapper held by a let, which says what it was, not what it is', () => {
      withProject(
        {
          'w.ts': [
            INNER,
            "let withName = (config) => ({ ...config, label: 'X' });",
            'export const Wrapped = withName(Inner);',
          ].join('\n'),
        },
        (project, root) => {
          const reading = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
          expect(reading.component).toBeUndefined();
          expect(reading.reason).toMatch(/let/);
        },
      );
    });

    test('a nested wrapper call, whose result is a value and not a node', () => {
      withProject(
        {
          'w.ts': [
            INNER,
            "const withA = (config) => ({ ...config, label: 'A' });",
            "const withB = (config) => ({ ...config, label: 'B' });",
            'export const Wrapped = withA(withB(Inner));',
          ].join('\n'),
        },
        (project, root) => {
          const reading = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
          expect(reading.component).toBeUndefined();
          expect(reading.reason).toMatch(/another call's result/);
        },
      );
    });

    test('a spread of a computed value in the body', () => {
      withProject(
        {
          'w.ts': [
            INNER,
            'function makeBase() {',
            "  return { label: 'Base' };",
            '}',
            'function withComputed(config) {',
            "  return { ...makeBase(), label: 'X' };",
            '}',
            'export const Wrapped = withComputed(Inner);',
          ].join('\n'),
        },
        (project, root) => {
          const reading = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
          expect(reading.component).toBeUndefined();
          expect(reading.reason).toBeDefined();
        },
      );
    });

    test('a spread that leads back to where it started, rather than following it forever', () => {
      // Source that could not have loaded at runtime either — but it reaches
      // this reader from a file someone is still typing, and a walk that never
      // returns takes the caller down with it instead of reporting anything.
      withProject(
        {
          'w.ts': [
            "const A = { ...B, label: 'A' };",
            "const B = { ...A, label: 'B' };",
            'function w(config) {',
            '  return { ...config };',
            '}',
            'export const Wrapped = w(A);',
          ].join('\n'),
        },
        (project, root) => {
          const reading = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
          expect(reading.component).toBeUndefined();
          expect(reading.reason).toMatch(/cycle/);
        },
      );
    });

    test('a props cycle reached through a nested object, which must not restart the count', () => {
      withProject(
        {
          'w.ts': [
            "const D = { nested: { ...D }, size: 'm' };",
            "const Inner = { label: 'Inner', fields: {} };",
            'function w(config) {',
            '  return { ...config, defaultProps: D };',
            '}',
            'export const Wrapped = w(Inner);',
          ].join('\n'),
        },
        (project, root) => {
          const reading = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
          expect(reading.component).toBeUndefined();
          expect(reading.reason).toMatch(/cycle/);
        },
      );
    });

    // `w(...config)` binds an ARRAY, so a body spreading it produces
    // `{ 0: … }` — nothing like the component the count check would say was
    // bound. The lie is confident: the reader would report the argument's own
    // fields as the wrapper's answer.
    test('a wrapper whose only parameter is a rest', () => {
      withProject(
        {
          'w.ts': [
            INNER,
            'function w(...config) {',
            '  return { ...config };',
            '}',
            'export const Wrapped = w(Inner);',
          ].join('\n'),
        },
        (project, root) => {
          const reading = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
          expect(reading.component).toBeUndefined();
          expect(reading.reason).toMatch(/rest/);
        },
      );
    });

    test('a wrapper with a rest tail after a real parameter', () => {
      withProject(
        {
          'w.ts': [
            INNER,
            'function w(config, ...extras) {',
            '  return { ...config };',
            '}',
            'export const Wrapped = w(Inner);',
          ].join('\n'),
        },
        (project, root) => {
          const reading = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
          expect(reading.component).toBeUndefined();
          expect(reading.reason).toMatch(/rest/);
        },
      );
    });

    test('an async wrapper, whose call is a promise and not a component', () => {
      withProject(
        {
          'w.ts': [
            INNER,
            'async function w(config) {',
            '  return { ...config };',
            '}',
            'export const Wrapped = w(Inner);',
          ].join('\n'),
        },
        (project, root) => {
          const reading = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
          expect(reading.component).toBeUndefined();
          expect(reading.reason).toMatch(/async/);
        },
      );
    });

    test('a generator wrapper, whose call is an iterator', () => {
      withProject(
        {
          'w.ts': [
            INNER,
            'function* w(config) {',
            '  return { ...config };',
            '}',
            'export const Wrapped = w(Inner);',
          ].join('\n'),
        },
        (project, root) => {
          const reading = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
          expect(reading.component).toBeUndefined();
          expect(reading.reason).toMatch(/generator/);
        },
      );
    });

    test('an argument that is neither a literal nor a name for one', () => {
      withProject(
        {
          'w.ts': ['function w(config) {', '  return { ...config };', '}', 'export const Wrapped = w(42);'].join('\n'),
        },
        (project, root) => {
          const reading = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
          expect(reading.component).toBeUndefined();
          expect(reading.reason).toMatch(/not an object written out in the source or a name for one/);
        },
      );
    });

    test('a callee that is not a function at all', () => {
      withProject(
        {
          'w.ts': [INNER, 'const w = 42 as never;', 'export const Wrapped = w(Inner);'].join('\n'),
        },
        (project, root) => {
          const reading = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
          expect(reading.component).toBeUndefined();
          expect(reading.reason).toBeDefined();
        },
      );
    });
  });

  // A parameter is a binding, not a word. Matching on the text alone hands
  // every identifier that happens to share the name — a module-level const in
  // the file a spread leads into — the wrapper's own argument, which is where
  // invented field sets and false cycle refusals both come from.
  describe('binds parameters by declaration, not by name', () => {
    test('a const sharing the parameter name resolves to itself, not to the argument', () => {
      withProject(
        {
          'w.ts': [
            "const config = { size: 'm' };",
            "const Inner = { label: 'Inner', fields: { title: { type: 'text' } }, defaultProps: { ...config } };",
            'function withX(config) {',
            '  return { ...config };',
            '}',
            'export const Wrapped = withX(Inner);',
          ].join('\n'),
        },
        (project, root) => {
          const { component, reason } = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
          expect(reason).toBeUndefined();
          expect(component?.defaultProps).toEqual({ size: 'm' });
          expect(component?.label).toBe('Inner');
        },
      );
    });

    test('a field set spreading such a const keeps its own fields, not the argument top level', () => {
      withProject(
        {
          'w.ts': [
            "const config = { extra: { type: 'number' } };",
            "const Inner = { label: 'Inner', fields: { ...config, title: { type: 'text' } } };",
            'function withX(config) {',
            '  return { ...config };',
            '}',
            'export const Wrapped = withX(Inner);',
          ].join('\n'),
        },
        (project, root) => {
          const { component, reason } = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
          expect(reason).toBeUndefined();
          expect(Object.keys(component?.fields ?? {}).sort()).toEqual(['extra', 'title']);
          expect(component?.fields.extra?.type).toBe('number');
        },
      );
    });
  });

  // Runtime does not care which shape a key is written in: `{ ...config,
  // fields }` overwrites the spread's field set just as `fields: {…}` does.
  // Reading only assignments leaves the spread's value standing as if the
  // override had never been written.
  describe('an override this reader cannot read still takes the spread with it', () => {
    test('a shorthand fields override', () => {
      withProject(
        {
          'w.ts': [
            INNER,
            'const fields = mapped();',
            'function withX(config) {',
            '  return { ...config, fields };',
            '}',
            'export const Wrapped = withX(Inner);',
          ].join('\n'),
        },
        (project, root) => {
          const { component } = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
          expect(component?.fields).toEqual({});
          expect(component?.fieldsUnreadable).toBe(true);
        },
      );
    });

    test('a method-shorthand label override', () => {
      withProject(
        {
          'w.ts': [
            INNER,
            'function withX(config) {',
            "  return { ...config, label() { return 'Computed'; } };",
            '}',
            'export const Wrapped = withX(Inner);',
          ].join('\n'),
        },
        (project, root) => {
          const { component } = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
          expect(component?.label).toBeUndefined();
        },
      );
    });

    test('a getter over defaultProps', () => {
      withProject(
        {
          'w.ts': [
            INNER,
            'function withX(config) {',
            "  return { ...config, get defaultProps() { return { title: 'Late' }; } };",
            '}',
            'export const Wrapped = withX(Inner);',
          ].join('\n'),
        },
        (project, root) => {
          const { component } = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
          expect(component?.defaultProps).toBeUndefined();
          expect(component?.fields.title?.type).toBe('text');
        },
      );
    });

    test('a computed key, which may name any of the keys read here', () => {
      withProject(
        {
          'w.ts': [
            INNER,
            'function withX(config) {',
            "  return { ...config, resolveData: () => ({}), [key]: 'whatever' };",
            '}',
            'export const Wrapped = withX(Inner);',
          ].join('\n'),
        },
        (project, root) => {
          const { component } = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
          expect(component?.label).toBeUndefined();
          expect(component?.defaultProps).toBeUndefined();
          expect(component?.fields).toEqual({});
          expect(component?.fieldsUnreadable).toBe(true);
          // The key may be `resolveData` itself, written with anything at all,
          // so whether the wrapper's behaviour survives cannot be read.
          expect(component?.unreadableKeys).toEqual([
            'label',
            'defaultProps',
            'ai',
            'resolveFields',
            'resolveData',
            'resolvePermissions',
          ]);
          expect(component?.derivedProps).toBeUndefined();
        },
      );
    });

    test('a computed label override, where the stale value would read as fact', () => {
      withProject(
        {
          'w.ts': [
            INNER,
            'function withX(config) {',
            '  return { ...config, label: makeLabel() };',
            '}',
            'export const Wrapped = withX(Inner);',
          ].join('\n'),
        },
        (project, root) => {
          const { component } = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
          expect(component?.label).toBeUndefined();
          expect(component?.unreadableKeys).toEqual(['label']);
          expect(component?.fields.title?.type).toBe('text');
        },
      );
    });

    test('an ai override that cannot be read', () => {
      withProject(
        {
          'w.ts': [
            "const Inner = { label: 'Inner', fields: {}, ai: { schema: { type: 'string' } } };",
            'function withX(config) {',
            '  return { ...config, ai: buildAi() };',
            '}',
            'export const Wrapped = withX(Inner);',
          ].join('\n'),
        },
        (project, root) => {
          const { component } = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
          expect(component?.ai).toBeUndefined();
        },
      );
    });

    test('a populated field set never stands beside the unreadable marker', () => {
      withProject(
        {
          'w.ts': [
            INNER,
            'function withX(config) {',
            '  return { fields: { early: { type: 5 } }, ...config, fields: mapped() };',
            '}',
            'export const Wrapped = withX(Inner);',
          ].join('\n'),
        },
        (project, root) => {
          const { component } = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
          expect(component?.fieldsUnreadable).toBe(true);
          expect(component?.fields).toEqual({});
        },
      );
    });
  });

  // A key an argument inherits or names is a key it has. Reading only its
  // written-out assignments makes `{ ...config.defaultProps }` look like a
  // spread of nothing, and the values vanish with no marker to say so.
  describe('sees the keys an argument declares indirectly', () => {
    test('a shorthand-declared defaultProps on the argument', () => {
      withProject(
        {
          'w.ts': [
            "const defaultProps = { title: 'T' };",
            "const Inner = { label: 'Inner', fields: { title: { type: 'text' } }, defaultProps };",
            'function withSize(config) {',
            "  return { ...config, defaultProps: { ...config.defaultProps, size: 'm' } };",
            '}',
            'export const Wrapped = withSize(Inner);',
          ].join('\n'),
        },
        (project, root) => {
          const { component } = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
          expect(component?.defaultProps).toEqual({ title: 'T', size: 'm' });
        },
      );
    });

    test('a defaultProps the argument inherits through a spread of its own', () => {
      withProject(
        {
          'w.ts': [
            "const Base = { defaultProps: { title: 'T' } };",
            "const Inner = { ...Base, label: 'Inner', fields: { title: { type: 'text' } } };",
            'function withSize(config) {',
            "  return { ...config, defaultProps: { ...config.defaultProps, size: 'm' } };",
            '}',
            'export const Wrapped = withSize(Inner);',
          ].join('\n'),
        },
        (project, root) => {
          const { component } = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
          expect(component?.defaultProps).toEqual({ title: 'T', size: 'm' });
        },
      );
    });

    test('a defaultProps written as a method is not read as absent', () => {
      withProject(
        {
          'w.ts': [
            "const Inner = { label: 'Inner', fields: {}, defaultProps() { return { title: 'T' }; } };",
            'function withSize(config) {',
            "  return { ...config, defaultProps: { ...config.defaultProps, size: 'm' } };",
            '}',
            'export const Wrapped = withSize(Inner);',
          ].join('\n'),
        },
        (project, root) => {
          const { component } = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
          // The method may hand the spread anything, so only what follows it is
          // known — and the admission says the rest was not read.
          expect(component?.defaultProps).toEqual({ size: 'm' });
          expect(component?.unreadableKeys).toEqual(['defaultProps']);
        },
      );
    });
  });

  test('a later spread that empties the field set really does empty it', () => {
    withProject(
      {
        'w.ts': [
          INNER,
          'const Clear = { fields: {} };',
          'function withX(config) {',
          '  return { ...config, ...Clear };',
          '}',
          'export const Wrapped = withX(Inner);',
        ].join('\n'),
      },
      (project, root) => {
        const { component } = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
        expect(component?.fields).toEqual({});
        expect(component?.fieldsUnreadable).toBeUndefined();
        expect(component?.label).toBe('Inner');
      },
    );
  });

  test('a spread that says nothing about fields still keeps the ones already read', () => {
    withProject(
      {
        'w.ts': [
          INNER,
          "const Extra = { label: 'Extra' };",
          'function withX(config) {',
          '  return { ...config, ...Extra };',
          '}',
          'export const Wrapped = withX(Inner);',
        ].join('\n'),
      },
      (project, root) => {
        const { component } = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
        expect(component?.fields.title?.type).toBe('text');
        expect(component?.label).toBe('Extra');
      },
    );
  });

  test('a concise arrow that returns its parameter unchanged', () => {
    withProject(
      {
        'w.ts': [INNER, 'const register = (config) => config;', 'export const Wrapped = register(Inner);'].join('\n'),
      },
      (project, root) => {
        const { component, reason } = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
        expect(reason).toBeUndefined();
        expect(component?.label).toBe('Inner');
        expect(component?.fields.title?.type).toBe('text');
      },
    );
  });

  test('an overloaded wrapper is read from the declaration that has a body', () => {
    withProject(
      {
        'w.ts': [
          INNER,
          'function withLabel(config: object): object;',
          'function withLabel(config: object, extra: object): object;',
          'function withLabel(config) {',
          "  return { ...config, label: 'Overloaded' };",
          '}',
          'export const Wrapped = withLabel(Inner);',
        ].join('\n'),
      },
      (project, root) => {
        const { component, reason } = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
        expect(reason).toBeUndefined();
        expect(component?.label).toBe('Overloaded');
      },
    );
  });

  test('an ai block the wrapper adds, read with the argument in scope', () => {
    withProject(
      {
        'w.ts': [
          INNER,
          'function withAi(config) {',
          '  return { ...config, ai: { hint: config.label } };',
          '}',
          'export const Wrapped = withAi(Inner);',
        ].join('\n'),
      },
      (project, root) => {
        const { component } = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
        expect(component?.ai).toEqual({ hint: 'Inner' });
      },
    );
  });

  test('a props key overwritten by something computed is dropped, not left stale', () => {
    withProject(
      {
        'w.ts': [
          INNER,
          'function withX(config) {',
          '  return { ...config, defaultProps: { ...config.defaultProps, title: makeTitle() } };',
          '}',
          'export const Wrapped = withX(Inner);',
        ].join('\n'),
      },
      (project, root) => {
        const { component } = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
        // Nothing of the defaults read, so none are claimed — only admitted.
        expect(component?.defaultProps).toBeUndefined();
        expect(component?.unreadableKeys).toEqual(['defaultProps']);
      },
    );
  });

  test('a field set that spreads in a cycle is admitted, and the rest of the component still reads', () => {
    withProject(
      {
        'w.ts': [
          'const F = { ...G };',
          'const G = { ...F };',
          "const Inner = { label: 'Inner', fields: {} };",
          'function withX(config) {',
          '  return { ...config, fields: F };',
          '}',
          'export const Wrapped = withX(Inner);',
        ].join('\n'),
      },
      (project, root) => {
        const { component, reason } = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
        expect(reason).toBeUndefined();
        expect(component?.label).toBe('Inner');
        expect(component?.fields).toEqual({});
        expect(component?.fieldsUnreadable).toBe(true);
      },
    );
  });

  test('a cap says how far it went rather than accusing the config of a cycle', () => {
    withProject(
      {
        'w.ts': [
          "const A = { ...B, label: 'A' };",
          "const B = { ...A, label: 'B' };",
          'function w(config) {',
          '  return { ...config };',
          '}',
          'export const Wrapped = w(A);',
        ].join('\n'),
      },
      (project, root) => {
        const { reason } = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
        expect(reason).toMatch(/16 deep/);
        expect(reason).toMatch(/usually a cycle/);
      },
    );
  });

  test('an error that is not a refusal is not swallowed as one', () => {
    withProject(
      {
        'w.ts': [INNER, 'const w = (config) => ({ ...config });', 'export const Wrapped = w(Inner);'].join('\n'),
      },
      (project, root) => {
        const call = callOf(project, root, 'w.ts', 'Wrapped');
        project.getSourceFileOrThrow(join(root, 'w.ts')).forget();
        expect(() => readWrapperCall(call)).toThrow();
      },
    );
  });

  // The argument's `[K]` may be `fields` itself, so `config.fields` is not
  // provably the field set written above it.
  test('a field set looked up past a computed key the argument cannot name is admitted', () => {
    withProject(
      {
        'w.ts': [
          'const K = pickKey();',
          "const Inner = { label: 'Inner', fields: { stale: { type: 'text' } }, [K]: {} };",
          'function withX(config) {',
          "  return { fields: { ...config.fields, x: { type: 'text' } } };",
          '}',
          'export const Wrapped = withX(Inner);',
        ].join('\n'),
      },
      (project, root) => {
        const { component } = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
        expect(component?.fields).toEqual({ x: { type: 'text' } });
        expect(component?.fieldsUnreadable).toBe(true);
      },
    );
  });

  test('a wrapper that maps over the fields reports them unread, and still reads the rest', () => {
    withProject(
      {
        'w.ts': [
          INNER,
          'function withMappedFields(config) {',
          '  return { ...config, fields: Object.fromEntries(Object.entries(config.fields)) };',
          '}',
          'export const Wrapped = withMappedFields(Inner);',
        ].join('\n'),
      },
      (project, root) => {
        const { component } = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
        expect(component).toBeDefined();
        expect(component?.fields).toEqual({});
        expect(component?.fieldsUnreadable).toBe(true);
        expect(component?.label).toBe('Inner');
      },
    );
  });
});

/**
 * A field declared through a helper — `buttons: ctaButtonArrayField()` — is the
 * same summarizable shape a wrapper is: one return of an object literal, every
 * parameter accounted for. Only what the returned literal is read AS differs,
 * so every rule the suite above pins holds here too, and the cases below are
 * the ones where a FIELD reading can differ from a component one.
 */
describe('readFieldBuilderCall', () => {
  describe('recovers a field a builder declares', () => {
    test('the ctaButtonArrayField shape — a zero-argument builder returning the whole field', () => {
      withProject(
        {
          'f.ts': [
            'function ctaButtonArrayField() {',
            '  return {',
            "    type: 'array',",
            '    min: 1,',
            '    max: 4,',
            '    arrayFields: {',
            "      id: { type: 'text', visible: false },",
            "      label: { type: 'text' },",
            "      variant: { type: 'radio', options: [{ label: 'Primary', value: 'primary' }] },",
            '    },',
            '  };',
            '}',
            'export const Field = ctaButtonArrayField();',
          ].join('\n'),
        },
        (project, root) => {
          const { field, reason } = readFieldBuilderCall(callOf(project, root, 'f.ts', 'Field'));
          expect(reason).toBeUndefined();
          expect(field?.type).toBe('array');
          expect(field?.min).toBe(1);
          expect(field?.max).toBe(4);
          expect(Object.keys(field?.arrayFields ?? {})).toEqual(['id', 'label', 'variant']);
          expect(field?.arrayFields?.variant?.options).toEqual([{ label: 'Primary', value: 'primary' }]);
          // Nothing in this field is written in a shape the reader cannot
          // follow, so it claims completeness rather than admitting a gap.
          expect(field?.unreadable).toBeUndefined();
        },
      );
    });

    test('an argument the builder writes into the field', () => {
      withProject(
        {
          'f.ts': [
            'function labelledText(label) {',
            "  return { type: 'text', label: label };",
            '}',
            "export const Field = labelledText('Title');",
          ].join('\n'),
        },
        (project, root) => {
          const { field, reason } = readFieldBuilderCall(callOf(project, root, 'f.ts', 'Field'));
          expect(reason).toBeUndefined();
          expect(field?.type).toBe('text');
          expect(field?.label).toBe('Title');
          // The parameter is bound by the call, and what it binds is read
          // whole: nothing is left unread, so nothing is admitted.
          expect(field?.unreadable).toBeUndefined();
        },
      );
    });

    // The real builder takes an optional `overrides` and spreads it, and five
    // of the six calls in the site it comes from pass nothing. An argument the
    // call omits binds undefined — a fact rather than a guess — so the spread
    // carries nothing and the bounds written above it are the ones the field
    // really has.
    test('an omitted optional argument, which is what most real calls pass', () => {
      withProject(
        {
          'f.ts': [
            'function ctaButtonArrayField(overrides) {',
            "  return { type: 'array', min: 1, max: 4, ...overrides };",
            '}',
            'export const Field = ctaButtonArrayField();',
          ].join('\n'),
        },
        (project, root) => {
          const { field, reason } = readFieldBuilderCall(callOf(project, root, 'f.ts', 'Field'));
          expect(reason).toBeUndefined();
          // Nothing was left unread: a spread carrying nothing is a fact about
          // the call, not a gap in what the reader could see.
          expect(field).toEqual({ type: 'array', min: 1, max: 4 });
        },
      );
    });

    // `ctaButtonArrayField({ max: 2 })` — the sixth of those calls. The bound
    // written above the spread is not the field's: the argument overwrites it
    // where it is written, and reporting 4 would be exactly the confident wrong
    // answer this reader exists to avoid.
    test('an argument spread over the bounds written above it', () => {
      withProject(
        {
          'f.ts': [
            'function ctaButtonArrayField(overrides) {',
            "  return { type: 'array', min: 1, max: 4, ...overrides };",
            '}',
            'export const Field = ctaButtonArrayField({ max: 2 });',
          ].join('\n'),
        },
        (project, root) => {
          const { field, reason } = readFieldBuilderCall(callOf(project, root, 'f.ts', 'Field'));
          expect(reason).toBeUndefined();
          expect(field).toEqual({ type: 'array', min: 1, max: 2 });
        },
      );
    });

    // The mirror case: an argument written BEFORE the keys it would have
    // overridden loses to them, exactly as at runtime.
    test('an argument spread before the bounds written under it', () => {
      withProject(
        {
          'f.ts': [
            'function ctaButtonArrayField(overrides) {',
            "  return { ...overrides, type: 'array', max: 4 };",
            '}',
            'export const Field = ctaButtonArrayField({ max: 2, min: 1 });',
          ].join('\n'),
        },
        (project, root) => {
          const { field, reason } = readFieldBuilderCall(callOf(project, root, 'f.ts', 'Field'));
          expect(reason).toBeUndefined();
          expect(field).toEqual({ type: 'array', min: 1, max: 4 });
        },
      );
    });

    test('a function-valued key is admitted as a gap, not refused', () => {
      withProject(
        {
          'f.ts': [
            'function ctaButtonArrayField() {',
            "  return { type: 'array', min: 1, max: 4, getItemSummary: (item) => item.label };",
            '}',
            'export const Field = ctaButtonArrayField();',
          ].join('\n'),
        },
        (project, root) => {
          const { field, reason } = readFieldBuilderCall(callOf(project, root, 'f.ts', 'Field'));
          expect(reason).toBeUndefined();
          expect(field?.type).toBe('array');
          expect(field?.max).toBe(4);
          expect(field?.unreadable).toBe(true);
        },
      );
    });
  });

  describe('refuses, with a reason, everything outside the summarizable shape', () => {
    test('a body that is more than one return', () => {
      withProject(
        {
          'f.ts': [
            'function widthField() {',
            '  const max = 12;',
            "  return { type: 'number', max: max };",
            '}',
            'export const Field = widthField();',
          ].join('\n'),
        },
        (project, root) => {
          const reading = readFieldBuilderCall(callOf(project, root, 'f.ts', 'Field'));
          expect(reading.field).toBeUndefined();
          expect(reading.reason).toMatch(/statements/);
        },
      );
    });

    test('a parameter carrying a default, whose bound value this reader would have to compute', () => {
      withProject(
        {
          'f.ts': [
            'function labelledText(opts = {}) {',
            "  return { type: 'text', label: opts.label ?? 'fallback' };",
            '}',
            'export const Field = labelledText();',
          ].join('\n'),
        },
        (project, root) => {
          const reading = readFieldBuilderCall(callOf(project, root, 'f.ts', 'Field'));
          expect(reading.field).toBeUndefined();
          expect(reading.reason).toMatch(/default value/);
        },
      );
    });

    test('a spread this reader cannot follow, which may overwrite what is written beside it', () => {
      withProject(
        {
          'f.ts': [
            'function ctaButtonArrayField(overrides) {',
            "  return { type: 'array', min: 1, max: 4, ...overrides, ...tweaks() };",
            '}',
            'export const Field = ctaButtonArrayField({ max: 2 });',
          ].join('\n'),
        },
        (project, root) => {
          const reading = readFieldBuilderCall(callOf(project, root, 'f.ts', 'Field'));
          expect(reading.field).toBeUndefined();
          expect(reading.reason).toBe(
            'the field spreads tweaks(), which this reader cannot follow and which may overwrite what is beside it',
          );
        },
      );
    });

    test('a builder that returns something other than an object', () => {
      withProject(
        {
          'f.ts': ['function widthField() {', '  return 42;', '}', 'export const Field = widthField();'].join('\n'),
        },
        (project, root) => {
          const reading = readFieldBuilderCall(callOf(project, root, 'f.ts', 'Field'));
          expect(reading.field).toBeUndefined();
          expect(reading.reason).toBe(
            'the function returns something other than an object written out in its body or the argument it was passed',
          );
        },
      );
    });

    test('an async builder, whose call is a promise and not a field', () => {
      withProject(
        {
          'f.ts': [
            'async function textField() {',
            "  return { type: 'text' };",
            '}',
            'export const Field = textField();',
          ].join('\n'),
        },
        (project, root) => {
          const reading = readFieldBuilderCall(callOf(project, root, 'f.ts', 'Field'));
          expect(reading.field).toBeUndefined();
          expect(reading.reason).toMatch(/async/);
        },
      );
    });
  });

  /**
   * The same guardrail the wrapper fixtures carry, for the builder this reader
   * was written for: the fixture is a real site's own `ctaButtonArrayField`,
   * and the suite both READS it and RUNS it, so the module rather than a
   * matching assumption decides what the field is.
   */
  describe('agrees with the builder it reads', () => {
    const FIXTURE = join(import.meta.dir, 'fixtures', 'puck-wrappers', 'cta-button-array-field.ts');

    function reading(): ManifestField {
      const project = createScanProject();
      const source = project.addSourceFileAtPath(FIXTURE);
      const call = unwrapExpression(
        source.getVariableDeclarationOrThrow('Field').getInitializerOrThrow(),
      ).asKindOrThrow(SyntaxKind.CallExpression);
      const { field, reason } = readFieldBuilderCall(call);
      if (!field) throw new Error(`the fixture builder was refused: ${reason}`);
      return field;
    }

    test('every constraint the reading claims is one the executed builder has', async () => {
      const read = reading();
      const { Field: actual } = (await import(FIXTURE)) as { Field: FieldLike };

      expect(read.type).toBe(actual.type);
      expect(read.min).toBe(actual.min);
      expect(read.max).toBe(actual.max);
      expect(Object.keys(read.arrayFields ?? {}).sort()).toEqual(Object.keys(actual.arrayFields ?? {}).sort());
      for (const [name, item] of Object.entries(read.arrayFields ?? {})) {
        if (item.unreadable) continue;
        expect(item.type).toBe(actual.arrayFields?.[name]?.type as string);
      }
      // The comparison is only worth running if it can fail: the fixture
      // carries real bounds and item fields rather than empty objects that
      // agree by default.
      expect(actual.max).toBe(4);
      expect(Object.keys(actual.arrayFields ?? {}).sort()).toEqual(['href', 'id', 'label', 'variant']);
    });
  });
});

// A parameter typed after a const — `o?: typeof DEFAULTS` — is a promise about
// shape, not a value: the checker points `o.label` at DEFAULTS' declaration, and
// reading that is reporting another object's value as the call's. Every read
// through a parameter goes to what the call binds, or admits it cannot.
describe('a read through a parameter is a read of the argument', () => {
  const DEFAULTS = [
    "const label = 'Default';",
    'const max = 10;',
    "const items = { fromDefaults: { type: 'text' } };",
    "const options = [{ label: 'Default', value: 'd' }];",
    'const DEFAULTS = { label, max, items, options };',
  ].join('\n');

  test('an argument the call passes is the value read', () => {
    withProject(
      {
        'f.ts': [
          DEFAULTS,
          "function b(o?: typeof DEFAULTS) { return { type: 'number', label: o?.label, max: o?.max }; }",
          "export const Given = b({ label: 'CTA', max: 2 });",
        ].join('\n'),
      },
      (project, root) => {
        const { field, reason } = readFieldBuilderCall(callOf(project, root, 'f.ts', 'Given'));
        expect(reason).toBeUndefined();
        expect(field?.label).toBe('CTA');
        expect(field?.max).toBe(2);
      },
    );
  });

  test('an argument the call omits reads as nothing, and says so', () => {
    withProject(
      {
        'f.ts': [
          DEFAULTS,
          "function b(o?: typeof DEFAULTS) { return { type: 'number', label: o?.label, max: o?.max }; }",
          'export const Omitted = b();',
        ].join('\n'),
      },
      (project, root) => {
        const { field, reason } = readFieldBuilderCall(callOf(project, root, 'f.ts', 'Omitted'));
        expect(reason).toBeUndefined();
        expect(field?.type).toBe('number');
        expect(field?.label).toBeUndefined();
        expect(field?.max).toBeUndefined();
        expect(field?.unreadable).toBe(true);
      },
    );
  });

  test('a Partial of the const is read the same way', () => {
    withProject(
      {
        'f.ts': [
          DEFAULTS,
          "function p(o: Partial<typeof DEFAULTS>) { return { type: 'number', label: o.label, max: o.max }; }",
          "export const Given = p({ label: 'CTA', max: 2 });",
          'export const Empty = p({});',
        ].join('\n'),
      },
      (project, root) => {
        const given = readFieldBuilderCall(callOf(project, root, 'f.ts', 'Given')).field;
        expect(given?.label).toBe('CTA');
        expect(given?.max).toBe(2);
        const empty = readFieldBuilderCall(callOf(project, root, 'f.ts', 'Empty')).field;
        expect(empty?.label).toBeUndefined();
        expect(empty?.max).toBeUndefined();
        expect(empty?.unreadable).toBe(true);
      },
    );
  });

  test('item fields and options named through the parameter are the argument’s', () => {
    withProject(
      {
        'f.ts': [
          DEFAULTS,
          "function list(o?: typeof DEFAULTS) { return { type: 'array', arrayFields: o?.items }; }",
          "function pick(o?: typeof DEFAULTS) { return { type: 'select', options: o?.options }; }",
          "export const Given = list({ items: { fromArgument: { type: 'number' } } });",
          'export const Omitted = list();',
          "export const Picked = pick({ options: [{ label: 'Argument', value: 'a' }] });",
          'export const Unpicked = pick();',
        ].join('\n'),
      },
      (project, root) => {
        const given = readFieldBuilderCall(callOf(project, root, 'f.ts', 'Given')).field;
        expect(Object.keys(given?.arrayFields ?? {})).toEqual(['fromArgument']);
        const omitted = readFieldBuilderCall(callOf(project, root, 'f.ts', 'Omitted')).field;
        expect(omitted?.arrayFields).toBeUndefined();
        expect(omitted?.unreadable).toBe(true);
        const picked = readFieldBuilderCall(callOf(project, root, 'f.ts', 'Picked')).field;
        expect(picked?.options).toEqual([{ label: 'Argument', value: 'a' }]);
        const unpicked = readFieldBuilderCall(callOf(project, root, 'f.ts', 'Unpicked')).field;
        expect(unpicked?.options).toBeUndefined();
        expect(unpicked?.unreadable).toBe(true);
      },
    );
  });

  test('a bound argument value handed over by name is read through the name', () => {
    withProject(
      {
        'f.ts': [
          'const LIMIT = 3;',
          "function b(o) { return { type: 'number', max: o.max }; }",
          'export const Given = b({ max: LIMIT });',
        ].join('\n'),
      },
      (project, root) => {
        const { field, reason } = readFieldBuilderCall(callOf(project, root, 'f.ts', 'Given'));
        expect(reason).toBeUndefined();
        expect(field?.max).toBe(3);
      },
    );
  });

  test('a shorthand of a bound parameter reads what the call passed', () => {
    withProject(
      {
        'f.ts': ["function b(label) { return { type: 'text', label }; }", "export const Given = b('Title');"].join(
          '\n',
        ),
      },
      (project, root) => {
        const { field } = readFieldBuilderCall(callOf(project, root, 'f.ts', 'Given'));
        expect(field?.label).toBe('Title');
      },
    );
  });

  // `[key]` is whatever the call passed — `'max'` here — so the 4 above it is
  // not the field's bound. Reported as written it is the builder's own lie.
  test('a computed key named by a parameter takes the keys it could have overwritten', () => {
    withProject(
      {
        'f.ts': [
          "function b(key) { return { type: 'number', max: 4, [key]: 99 }; }",
          "export const Keyed = b('max');",
        ].join('\n'),
      },
      (project, root) => {
        const { field } = readFieldBuilderCall(callOf(project, root, 'f.ts', 'Keyed'));
        expect(field?.max).toBeUndefined();
        expect(field?.unreadable).toBe(true);
      },
    );
  });

  // An argument that carries a computed key it cannot name, or a prototype,
  // may hold the key being spread — so it is not proven absent, and the
  // spread is not an empty one.
  test('a spread of a key the argument may hold through a computed name or a prototype is not empty', () => {
    withProject(
      {
        'f.ts': [
          'const K = pickKey();',
          'const EXTRA = { extra: { max: 5 } };',
          "function b(o) { return { type: 'number', max: 4, ...o.extra }; }",
          'export const Computed = b({ [K]: { max: 5 } });',
          'export const Inherited = b({ __proto__: EXTRA });',
        ].join('\n'),
      },
      (project, root) => {
        for (const name of ['Computed', 'Inherited']) {
          const { field, reason } = readFieldBuilderCall(callOf(project, root, 'f.ts', name));
          expect(field).toBeUndefined();
          expect(reason).toBe(
            'the field spreads o.extra, which this reader cannot follow and which may overwrite what is beside it',
          );
        }
      },
    );
  });

  test('a wrapper’s label read through its parameter is the argument’s label', () => {
    withProject(
      {
        'w.ts': [
          "const label = 'Base';",
          'const Base = { label, fields: {}, render: () => null };',
          'function withName(config: typeof Base) { return { ...config, label: config.label }; }',
          "const Other = { label: 'Other', fields: {}, render: () => null };",
          'export const Wrapped = withName(Other);',
        ].join('\n'),
      },
      (project, root) => {
        const { component, reason } = readWrapperCall(callOf(project, root, 'w.ts', 'Wrapped'));
        expect(reason).toBeUndefined();
        expect(component?.label).toBe('Other');
      },
    );
  });
});

describe('wrapper value work budget', () => {
  test('charges array values read through a wrapper rather than counting only their containing property', () => {
    const items = Array.from({ length: 100 }, (_, i) => String(i)).join(',');
    withProject(
      {
        'config.ts': `function wrap(config) { return { ...config, defaultProps: { values: [${items}] } }; } export const use = wrap({ fields: {} });`,
      },
      (project, root) => {
        const call = callOf(project, root, 'config.ts', 'use');
        expect(() =>
          withReadingSession(() => {
            for (let i = 0; i < MAX_WORK - 50; i++) spendWork();
            readWrapperCall(call);
          }),
        ).toThrow(WorkBudgetExceeded);
      },
    );
  });
});
