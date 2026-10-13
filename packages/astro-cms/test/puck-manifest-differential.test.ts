import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { SyntaxKind } from 'ts-morph';
import { createScanProject } from '../src/discovery/extract-props-ts.js';
import { unwrapExpression } from '../src/puck-manifest/literal.js';
import { readPuckConfig } from '../src/puck-manifest/read-config.js';
import { readFieldBuilderCall, readWrapperCall } from '../src/puck-manifest/read-wrapper.js';
import type { ManifestComponent, ManifestField, PuckManifest } from '../src/puck-manifest/types.js';
import type { ComponentLike, ConfigLike } from './fixtures/puck-wrappers/component-like.js';

/**
 * The guardrail the other wrapper suites cannot be: every fixture here is a
 * real module that this suite both RUNS and READS, and the two answers are
 * compared key by key.
 *
 * Every other test in this area asserts what the reader should say, which means
 * a reader and a test can agree on the same wrong answer — and four of them
 * did, each one confidently reporting a field set or a label the module does
 * not have. Executing the fixture removes the shared assumption: the module
 * itself decides what is true.
 *
 * Running these modules is not a hole in the never-execute rule. That rule is
 * about a stranger's config in production; these are files in this repo,
 * written to be run.
 */

const FIXTURES = join(import.meta.dir, 'fixtures', 'puck-wrappers');

/** A field as a fixture module builds it: a type, and whatever else the declaration carries. */
type RuntimeField = ComponentLike['fields'][string];

/** Field types Puck cannot infer a shape for without an `ai.schema` — what `opaque` claims. */
const OPAQUE_TYPES = new Set(['custom', 'external']);

/** Field keys whose value the manifest copies as plain data. `options` and the nested maps are compared on their own. */
const FIELD_VALUE_KEYS = ['label', 'min', 'max', 'allow', 'disallow', 'ai'] as const;

/** Component keys whose value the manifest copies as plain data. No component-level admission covers them. */
const COMPONENT_VALUE_KEYS = ['label', 'defaultProps', 'ai'] as const;

/** Each behaviour marker, beside the runtime key whose presence it reports. */
const MARKERS = [
  ['resolveFields', 'dynamicFields'],
  ['resolveData', 'derivedProps'],
  ['resolvePermissions', 'hasPlacementRules'],
] as const;

/** The call a fixture exports under `name`, read without running it. */
function exportedCall(file: string, name: string) {
  const source = createScanProject().addSourceFileAtPath(join(FIXTURES, file));
  return unwrapExpression(source.getVariableDeclarationOrThrow(name).getInitializerOrThrow()).asKindOrThrow(
    SyntaxKind.CallExpression,
  );
}

/** What the reader says a wrapper fixture's `Component` is — the entry `read-config` reaches for a wrapper-built name. */
function componentReading(file: string): ManifestComponent {
  const { component, reason } = readWrapperCall(exportedCall(file, 'Component'));
  if (!component) throw new Error(`${file} was refused: ${reason}`);
  return component;
}

/** What the reader says a builder-built field exported as `name` is. */
function fieldReading(file: string, name: string): ManifestField {
  const { field, reason } = readFieldBuilderCall(exportedCall(file, name));
  if (!field) throw new Error(`${file}#${name} was refused: ${reason}`);
  return field;
}

/** One export of a fixture, once the module has run. */
async function executed<T>(file: string, name: string): Promise<T> {
  const module = (await import(join(FIXTURES, file))) as Record<string, T>;
  return module[name] as T;
}

/**
 * The value a runtime key takes on the wire. A manifest is JSON, so a function
 * or an explicit `undefined` inside the value is not something it could carry.
 */
function wire(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function show(value: unknown): string {
  return value === undefined ? 'nothing' : JSON.stringify(value);
}

/**
 * One modeled key held to the runtime: a value the reading carries must equal
 * the module's, and a value the module has that the reading lacks must be
 * covered by an admission — a bare absence reads as "the module has none".
 */
function keyMismatches(path: string, read: unknown, actual: unknown, admitted: boolean): string[] {
  if (read !== undefined) {
    return Bun.deepEquals(read, wire(actual), true) ? [] : [`${path}: read ${show(read)}, module has ${show(actual)}`];
  }
  if (actual !== undefined && !admitted) return [`${path}: module has ${show(actual)}, reading omits it unadmitted`];
  return [];
}

/**
 * One field held to the runtime on every key the manifest models.
 *
 * `unreadable` is the field's admission: with it, a key the reading lacks is
 * unknown rather than absent, and `type: 'unknown'` names a prop whose shape
 * nothing was claimed about. A key the reading DOES carry is compared whatever
 * the admission says — an admission excuses silence, never a wrong value.
 */
function fieldMismatches(path: string, read: ManifestField, actual: RuntimeField): string[] {
  const admitted = read.unreadable === true;
  const mismatches: string[] = [];

  if (!(admitted && read.type === 'unknown') && read.type !== actual.type) {
    mismatches.push(`${path}.type: read ${show(read.type)}, module has ${show(actual.type)}`);
  }
  for (const key of FIELD_VALUE_KEYS) {
    mismatches.push(...keyMismatches(`${path}.${key}`, read[key], actual[key], admitted));
  }

  // Puck reads only the label/value pair of each option, so that is the part compared.
  const options = Array.isArray(actual.options)
    ? actual.options.map(({ label, value }: { label: unknown; value: unknown }) => ({ label, value }))
    : actual.options;
  mismatches.push(...keyMismatches(`${path}.options`, read.options, options, admitted));

  for (const key of ['arrayFields', 'objectFields'] as const) {
    const nested = actual[key] as Record<string, RuntimeField> | undefined;
    if (read[key] === undefined || nested === undefined) {
      mismatches.push(...keyMismatches(`${path}.${key}`, read[key], nested, admitted));
    } else mismatches.push(...fieldMapMismatches(`${path}.${key}`, read[key], nested));
  }

  // `opaque` is a claim about the runtime field too: a custom or external type
  // with no schema. Once the reading has admitted a gap, what it could not see
  // may be the schema itself.
  const opaque = OPAQUE_TYPES.has(actual.type) && (actual.ai as { schema?: unknown } | undefined)?.schema === undefined;
  if (!admitted && (read.opaque === true) !== opaque) {
    mismatches.push(`${path}.opaque: read ${show(read.opaque)}, module ${opaque ? 'is' : 'is not'} opaque`);
  }
  return mismatches;
}

/** A field map held to the runtime: the same names, and each field held key by key. */
function fieldMapMismatches(
  path: string,
  read: Record<string, ManifestField>,
  actual: Record<string, RuntimeField>,
): string[] {
  const mismatches: string[] = [];
  for (const name of Object.keys(actual)) {
    if (!(name in read)) mismatches.push(`${path}.${name}: module has this field, reading omits it`);
  }
  for (const [name, field] of Object.entries(read)) {
    const runtime = actual[name];
    if (runtime === undefined) mismatches.push(`${path}.${name}: reading names a field the module does not have`);
    else mismatches.push(...fieldMismatches(`${path}.${name}`, field, runtime));
  }
  return mismatches;
}

/**
 * One component held to the runtime on every key the manifest models.
 *
 * Functions — `render`, `resolveFields` and the rest — are never compared: they
 * are exactly what the markers admit, so each marker is held to the PRESENCE of
 * its runtime key, both ways.
 */
function componentMismatches(path: string, read: ManifestComponent, actual: ComponentLike): string[] {
  const mismatches: string[] = [];
  for (const key of COMPONENT_VALUE_KEYS) {
    mismatches.push(...keyMismatches(`${path}.${key}`, read[key], actual[key], false));
  }

  if (read.fieldsUnreadable) {
    // The admission covers the whole map, so the map it stands beside must claim nothing.
    if (Object.keys(read.fields).length > 0) {
      mismatches.push(`${path}.fields: admitted unreadable, yet names ${Object.keys(read.fields).join(', ')}`);
    }
  } else mismatches.push(...fieldMapMismatches(`${path}.fields`, read.fields, actual.fields));

  for (const [runtimeKey, marker] of MARKERS) {
    const present = actual[runtimeKey] !== undefined;
    if ((read[marker] === true) !== present) {
      mismatches.push(
        `${path}.${marker}: read ${show(read[marker])}, module ${present ? 'has' : 'lacks'} ${runtimeKey}`,
      );
    }
  }
  return mismatches;
}

/**
 * A whole manifest held to the config the module exports: every runtime
 * component read and matching, or named in `unresolved`; nothing read that the
 * config does not declare; page fields and sidebar groups as the config has them.
 */
function manifestMismatches(read: PuckManifest, actual: ConfigLike): string[] {
  const mismatches: string[] = [];
  const admitted = read.unreadable === true;

  for (const [name, component] of Object.entries(actual.components)) {
    const reading = read.components[name];
    if (reading) mismatches.push(...componentMismatches(`components.${name}`, reading, component));
    else if (!read.unresolved.includes(name) && !admitted) {
      mismatches.push(`components.${name}: module has this component, reading neither reads nor admits it`);
    }
  }
  for (const name of [...Object.keys(read.components), ...read.unresolved]) {
    if (!(name in actual.components)) mismatches.push(`components.${name}: module declares no such component`);
  }

  if (read.root === undefined || actual.root === undefined) {
    mismatches.push(...keyMismatches('root', read.root, actual.root, admitted));
  } else mismatches.push(...fieldMapMismatches('root.fields', read.root.fields, actual.root.fields));

  const categories = actual.categories
    ? Object.fromEntries(
        Object.entries(actual.categories).map(([name, { title, components }]) => [name, { title, components }]),
      )
    : undefined;
  mismatches.push(...keyMismatches('categories', read.categories, categories, admitted));
  return mismatches;
}

/**
 * Holds a reading to the module it was read from. Every mismatch is collected
 * before failing, so one run names every key the reader gets wrong rather than
 * the first.
 */
function expectReadingMatchesRuntime(mismatches: string[]): void {
  expect(mismatches).toEqual([]);
}

describe('the wrapper reader agrees with the wrappers it reads', () => {
  const cases: Array<[string, string]> = [
    ['with-layout.ts', 'the withLayout shape both shipped configs use'],
    ['shadowed-parameter-name.ts', 'a module const sharing the parameter name'],
    ['shorthand-override.ts', 'an override written as a shorthand'],
    ['indirect-defaults.ts', 'defaults the argument declares by name'],
    ['cleared-fields.ts', 'a later spread that empties the field set'],
    ['every-modeled-key.ts', 'an argument writing every key the manifest models'],
    ['rule-less-slot.ts', 'a slot writing no nesting rules of its own'],
  ];

  for (const [file, what] of cases) {
    test(what, async () => {
      const actual = await executed<ComponentLike>(file, 'Component');
      expectReadingMatchesRuntime(componentMismatches('Component', componentReading(file), actual));
    });
  }

  test('a label the wrapper computes', async () => {
    const actual = await executed<ComponentLike>('computed-label.ts', 'Component');
    // The manifest models no admission for a component's label, so the one
    // thing a reading can do with a label it cannot compute is leave it out —
    // which the absence rule cannot tell from a component that has none. The
    // label is left out of this comparison; every other key is held.
    const mismatches = componentMismatches('Component', componentReading('computed-label.ts'), actual);
    expectReadingMatchesRuntime(mismatches.filter((mismatch) => !mismatch.startsWith('Component.label:')));
  });
});

describe('the field-builder reader agrees with the builders it reads', () => {
  const cases: Array<[string, string, string]> = [
    ['cta-button-array-field.ts', 'Field', "a real site's builder, called with nothing"],
    ['field-builder-overrides.ts', 'Overridden', 'an override spread after the builder writes its bounds'],
    ['field-builder-overrides.ts', 'Underridden', 'an override spread before the builder writes its bounds'],
  ];

  for (const [file, name, what] of cases) {
    test(what, async () => {
      const actual = await executed<RuntimeField>(file, name);
      expectReadingMatchesRuntime(fieldMismatches(name, fieldReading(file, name), actual));
    });
  }
});

describe('the config reader agrees with the config it reads', () => {
  test('entries renaming a shared definition on either side of the spread', async () => {
    const file = 'position-sensitive-config.ts';
    const actual = await executed<ConfigLike>(file, 'default');
    const read = readPuckConfig({ configPath: join(FIXTURES, file) });
    expectReadingMatchesRuntime(manifestMismatches(read, actual));
  });
});

describe('the comparison can fail', () => {
  // The comparisons above are only worth running if they can fail. These prove
  // the fixtures carry real values rather than empty objects that agree by
  // default, and that the rules catch each way a reading can be wrong.
  test('the fixtures actually declare something to disagree about', async () => {
    const layout = await executed<ComponentLike>('with-layout.ts', 'Component');
    expect(Object.keys(layout.fields).sort()).toEqual(['items', 'layout', 'title']);
    expect(layout.defaultProps).toEqual({ title: 'T', layout: { spanCol: 1 } });

    // Where the override spread sits decides the bound, one way and the other.
    expect((await executed<RuntimeField>('field-builder-overrides.ts', 'Overridden')).max).toBe(2);
    expect((await executed<RuntimeField>('field-builder-overrides.ts', 'Underridden')).max).toBe(10);

    const config = await executed<ConfigLike>('position-sensitive-config.ts', 'default');
    expect(config.components.OwnFirst?.label).toBe('Base');
    expect(config.components.OwnLast?.label).toBe('Own');
  });

  test('a wrong value, an unadmitted absence and a false marker are each caught', async () => {
    const actual = await executed<ComponentLike>('every-modeled-key.ts', 'Component');
    const read = componentReading('every-modeled-key.ts');
    const children = read.fields.children as ManifestField;
    const columns = read.fields.columns as ManifestField;

    const wrongValue = { ...read, fields: { ...read.fields, children: { ...children, disallow: ['Text'] } } };
    expect(componentMismatches('C', wrongValue, actual)).toEqual([
      'C.fields.children.disallow: read ["Text"], module has ["Hero"]',
    ]);

    const { max: _max, ...withoutMax } = columns;
    const silentAbsence = { ...read, fields: { ...read.fields, columns: withoutMax } };
    expect(componentMismatches('C', silentAbsence, actual)).toEqual([
      'C.fields.columns.max: module has 12, reading omits it unadmitted',
    ]);
    const admittedAbsence = {
      ...read,
      fields: { ...read.fields, columns: { ...withoutMax, unreadable: true as const } },
    };
    expect(componentMismatches('C', admittedAbsence, actual)).toEqual([]);

    const { derivedProps: _derived, ...withoutMarker } = read;
    expect(componentMismatches('C', withoutMarker, actual)).toEqual([
      'C.derivedProps: read nothing, module has resolveData',
    ]);
  });
});
