import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_OUTPUT_BYTES } from '../src/puck-manifest/literal.js';
import { readPuckConfig } from '../src/puck-manifest/read-config.js';
import type { ManifestField, PuckManifest } from '../src/puck-manifest/types.js';

/**
 * Writes a throwaway config on disk — the reader follows imports, which needs
 * real files — and removes it however the assertions turn out, so a failing run
 * leaves nothing behind in the system temp directory.
 */
function withFiles(files: Record<string, string>, body: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'puck-config-'));
  try {
    for (const [relativePath, contents] of Object.entries(files)) {
      const absolute = join(root, relativePath);
      mkdirSync(join(absolute, '..'), { recursive: true });
      writeFileSync(absolute, contents);
    }
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** A config as the module holds it once it has run: only the parts a reading is held to. */
interface RuntimeConfig {
  components: Record<string, Record<string, unknown> & { fields?: Record<string, unknown> }>;
  root?: { fields?: Record<string, unknown> };
}

/**
 * Writes a config to disk, then both READS it and RUNS it, so a test holds the
 * reading to what the module really holds rather than to what the test
 * expects — a reader and a test cannot then agree on the same wrong answer.
 */
async function readAndRun(config: string): Promise<{ manifest: PuckManifest; runtime: RuntimeConfig }> {
  const root = mkdtempSync(join(tmpdir(), 'puck-config-run-'));
  try {
    const path = join(root, 'puck.config.ts');
    writeFileSync(path, config);
    const manifest = readPuckConfig({ configPath: path });
    const runtime = ((await import(path)) as { default: RuntimeConfig }).default;
    return { manifest, runtime };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Writes a config and the modules beside it, then READS the config and tries
 * to RUN it, keeping the error a config that does not load fails with — so a
 * refusal is held to what the runtime does with the same files.
 */
async function readAndTry(
  files: Record<string, string>,
): Promise<{ manifest: PuckManifest; loaded?: { default?: unknown }; failure?: unknown }> {
  const root = mkdtempSync(join(tmpdir(), 'puck-config-try-'));
  try {
    for (const [relativePath, contents] of Object.entries(files)) {
      const absolute = join(root, relativePath);
      mkdirSync(join(absolute, '..'), { recursive: true });
      writeFileSync(absolute, contents);
    }
    const path = join(root, 'puck.config.ts');
    const manifest = readPuckConfig({ configPath: path });
    try {
      return { manifest, loaded: (await import(path)) as { default?: unknown } };
    } catch (failure) {
      return { manifest, failure };
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** The config a module that loaded holds as its default. */
function loadedConfig(loaded: { default?: unknown } | undefined): RuntimeConfig {
  expect(loaded).toBeDefined();
  return loaded?.default as RuntimeConfig;
}

/** A manifest refused as a whole, with its reason. */
function refused(reason: string): PuckManifest {
  return { components: {}, unresolved: [], unreadable: true, unreadableReason: reason };
}

/** A runtime value as a JSON manifest would carry it. */
function wire(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

/** The names Puck sees in a field set: it walks one with `for…in`, which reaches inherited entries too. */
function enumerated(fields: Record<string, unknown> | undefined): string[] {
  const names: string[] = [];
  for (const name in fields) names.push(name);
  return names;
}

describe('readPuckConfig', () => {
  test('reads shorthand components through a barrel, with their fields', () => {
    withFiles(
      {
        'components/Hero.ts': "export const Hero = { label: 'Hero', fields: { title: { type: 'text' } } };",
        'components/index.ts': "export { Hero } from './Hero';",
        'puck.config.ts': "import { Hero } from './components';\nexport default { components: { Hero } };",
      },
      (root) => {
        const manifest = readPuckConfig({ configPath: join(root, 'puck.config.ts') });
        expect(Object.keys(manifest.components)).toEqual(['Hero']);
        expect(manifest.components.Hero?.fields.title?.type).toBe('text');
        expect(manifest.unresolved).toEqual([]);
      },
    );
  });

  test('applies a spread override, which is how real configs rename components', () => {
    withFiles(
      {
        'Flex.ts': "export const Flex = { label: 'Flex', fields: { gap: { type: 'number' } } };",
        'puck.config.ts':
          "import { Flex } from './Flex';\n" +
          "export default { components: { Flex: { ...Flex, label: 'Flex Container' } } };",
      },
      (root) => {
        const manifest = readPuckConfig({ configPath: join(root, 'puck.config.ts') });
        expect(manifest.components.Flex?.label).toBe('Flex Container');
        expect(manifest.components.Flex?.fields.gap?.type).toBe('number');
      },
    );
  });

  test('applies every spread in an entry, not just the first', () => {
    withFiles(
      {
        'base.ts':
          "export const Sizing = { fields: { gap: { type: 'number' } } };\n" +
          "export const Naming = { label: 'Base', fields: { title: { type: 'text' } } };",
        'puck.config.ts':
          "import { Naming, Sizing } from './base';\n" +
          'export default { components: { Box: { ...Sizing, ...Naming } } };',
      },
      (root) => {
        const manifest = readPuckConfig({ configPath: join(root, 'puck.config.ts') });
        expect(manifest.components.Box?.label).toBe('Base');
        expect(Object.keys(manifest.components.Box?.fields ?? {})).toEqual(['title']);
      },
    );
  });

  // Source order decides, exactly as it does at runtime: a spread written after
  // a key really does overwrite it. Read the other way round, the manifest
  // hands an agent a label the editor never shows.
  test('a spread written after a key overwrites it', () => {
    withFiles(
      {
        'Base.ts': "export const Base = { label: 'Base', fields: { gap: { type: 'number' } } };",
        'puck.config.ts':
          "import { Base } from './Base';\n" + "export default { components: { Box: { label: 'Own', ...Base } } };",
      },
      (root) => {
        const manifest = readPuckConfig({ configPath: join(root, 'puck.config.ts') });
        expect(manifest.components.Box?.label).toBe('Base');
      },
    );
  });

  // Two spreads meeting: a key the SECOND writes in a shape this reader cannot
  // read must not leave the first's value standing. The reading of a spread
  // source carries which keys it wrote, so an unreadable write travels with it.
  test('an unreadable key in a later spread takes the earlier spread value with it', () => {
    withFiles(
      {
        'base.ts':
          "export const A = { label: 'A', fields: { gap: { type: 'number' } } };\n" +
          'export const B = { label: makeLabel(), defaultProps: { size: 1 } };',
        'puck.config.ts': "import { A, B } from './base';\nexport default { components: { Box: { ...A, ...B } } };",
      },
      (root) => {
        const manifest = readPuckConfig({ configPath: join(root, 'puck.config.ts') });
        expect(manifest.components.Box?.label).toBeUndefined();
        // Everything B says nothing about still comes from A.
        expect(manifest.components.Box?.fields.gap?.type).toBe('number');
        expect(manifest.components.Box?.defaultProps).toEqual({ size: 1 });
      },
    );
  });

  // An override that empties the field set on purpose is honoured rather than
  // second-guessed: the two characters really do clear what the spread brought.
  test('an override that deliberately empties the field set really empties it', () => {
    withFiles(
      {
        'Base.ts': "export const Base = { label: 'Base', fields: { gap: { type: 'number' } } };",
        'puck.config.ts':
          "import { Base } from './Base';\nexport default { components: { Box: { ...Base, fields: {} } } };",
      },
      (root) => {
        const manifest = readPuckConfig({ configPath: join(root, 'puck.config.ts') });
        expect(manifest.components.Box?.fields).toEqual({});
        // Empty because the config says so, not because the reader gave up.
        expect(manifest.components.Box?.fieldsUnreadable).toBeUndefined();
        expect(manifest.components.Box?.label).toBe('Base');
      },
    );
  });

  test('keeps a behaviour marker the spread source declares and the override does not mention', () => {
    withFiles(
      {
        'Stats.ts': "export const Stats = { fields: { rows: { type: 'number' } }, resolveData: () => ({}) };",
        'puck.config.ts':
          "import { Stats } from './Stats';\n" +
          "export default { components: { Stats: { ...Stats, label: 'Statistics' } } };",
      },
      (root) => {
        const manifest = readPuckConfig({ configPath: join(root, 'puck.config.ts') });
        expect(manifest.components.Stats?.derivedProps).toBe(true);
        expect(manifest.components.Stats?.label).toBe('Statistics');
        expect(manifest.components.Stats?.fields.rows?.type).toBe('number');
      },
    );
  });

  test('merges a spread written inside the component module, not just one written in the config', () => {
    withFiles(
      {
        'base.ts': "export const base = { fields: { title: { type: 'text' } } };",
        'Hero.ts': "import { base } from './base';\nexport const Hero = { ...base, label: 'Hero' };",
        'puck.config.ts': "import { Hero } from './Hero';\nexport default { components: { Hero } };",
      },
      (root) => {
        const manifest = readPuckConfig({ configPath: join(root, 'puck.config.ts') });
        expect(manifest.components.Hero?.label).toBe('Hero');
        expect(manifest.components.Hero?.fields.title?.type).toBe('text');
      },
    );
  });

  // A component that spreads its own name is nonsense a config can still
  // contain, and the reader walks it by resolving the same literal twice.
  // A module holding `const Loop = { ...Loop }` throws on load, so Puck never
  // receives the component at all. Reading the parts that are written down and
  // reporting it as a working component would describe a site that cannot
  // start; the cap stops the walk and the reason says what it stopped on.
  test('a component that spreads itself is admitted with a reason, not followed forever', () => {
    withFiles(
      {
        'puck.config.ts':
          "const Loop = { ...Loop, label: 'Loop', fields: { a: { type: 'text' } } };\n" +
          'export default { components: { Loop } };',
      },
      (root) => {
        const manifest = readPuckConfig({ configPath: join(root, 'puck.config.ts') });
        expect(manifest.components.Loop).toBeUndefined();
        expect(manifest.unresolved).toContain('Loop');
        expect(manifest.unresolvedReasons?.Loop).toMatch(/deep/);
      },
    );
  });

  // The shape the spread-blind reader answered "accepts nothing" for, with no
  // marker to say a spread had been skipped: the base a component spreads
  // spreads something of its own.
  test('a spread source that itself spreads is followed the whole way down', () => {
    withFiles(
      {
        'puck.config.ts':
          "const Root = { fields: { a: { type: 'text' } } };\n" +
          "const Base = { ...Root, label: 'Base' };\n" +
          'export default { components: { X: { ...Base } } };',
      },
      (root) => {
        const manifest = readPuckConfig({ configPath: join(root, 'puck.config.ts') });
        expect(manifest.components.X?.fields.a?.type).toBe('text');
        expect(manifest.components.X?.label).toBe('Base');
        expect(manifest.components.X?.fieldsUnreadable).toBeUndefined();
      },
    );
  });

  // `{ ...Base, label: someName }` sets the label to something this reader
  // cannot follow. Reporting Base's label describes a component the runtime
  // disagrees with, in the one way an agent could not catch.
  test('an override key that cannot be read takes the spread source value with it', () => {
    withFiles(
      {
        'puck.config.ts':
          "const Base = { label: 'Base', fields: { a: { type: 'text' } }, defaultProps: { a: '1' } };\n" +
          'export default { components: { X: { ...Base, label: makeLabel(), defaultProps: buildProps() } } };',
      },
      (root) => {
        const manifest = readPuckConfig({ configPath: join(root, 'puck.config.ts') });
        expect(manifest.components.X?.label).toBeUndefined();
        expect(manifest.components.X?.defaultProps).toBeUndefined();
        // Everything the override says nothing about still comes from the base.
        expect(manifest.components.X?.fields.a?.type).toBe('text');
      },
    );
  });

  // `label: makeLabel()` is only one of the shapes an unreadable override can
  // take. `{ ...Base, fields }`, `fields() { … }` and `get fields() { … }` all
  // replace the base's value at runtime with something this reader cannot see,
  // and every one of them used to report the base's value as though the
  // override had never been written.
  describe('an override key written in a shape this reader cannot read', () => {
    const BASE =
      'const computed = null;\n' +
      "const Base = { label: 'Base', fields: { a: { type: 'text' } }, defaultProps: { a: '1' }, ai: { note: 'b' } };\n";

    const SHAPES: Record<string, (key: string) => string> = {
      shorthand: (key) => key,
      method: (key) => `${key}() { return computed; }`,
      getter: (key) => `get ${key}() { return computed; }`,
    };

    for (const key of ['fields', 'label', 'defaultProps', 'ai'] as const) {
      for (const [shape, write] of Object.entries(SHAPES)) {
        test(`clears the spread's ${key} when the override writes it as a ${shape}`, () => {
          withFiles(
            {
              'puck.config.ts': `${BASE}export default { components: { X: { ...Base, ${write(key)} } } };`,
            },
            (root) => {
              const manifest = readPuckConfig({ configPath: join(root, 'puck.config.ts') });
              const component = manifest.components.X;
              expect(component).toBeDefined();

              if (key === 'fields') {
                // Empty AND admitted: the component does not accept nothing, it
                // accepts something this reader could not see.
                expect(component?.fields).toEqual({});
                expect(component?.fieldsUnreadable).toBe(true);
              } else {
                expect(component?.[key]).toBeUndefined();
                // A key the override never mentions still comes from the base.
                expect(component?.fields.a?.type).toBe('text');
                expect(component?.fieldsUnreadable).toBeUndefined();
              }
              if (key !== 'label') expect(component?.label).toBe('Base');
              if (key !== 'defaultProps') expect(component?.defaultProps).toEqual({ a: '1' });
              if (key !== 'ai') expect(component?.ai).toEqual({ note: 'b' });
            },
          );
        });
      }
    }
  });

  test('follows a components map that is named rather than written in place', () => {
    withFiles(
      {
        'components.ts': "export const componentMap = { Hero: { fields: { title: { type: 'text' } } } };",
        'puck.config.ts': "import { componentMap } from './components';\nexport default { components: componentMap };",
      },
      (root) => {
        const manifest = readPuckConfig({ configPath: join(root, 'puck.config.ts') });
        expect(manifest.components.Hero?.fields.title?.type).toBe('text');
        expect(manifest.unreadable).toBeUndefined();
      },
    );
  });

  test('follows a components map written as a shorthand', () => {
    withFiles(
      {
        'components.ts': "export const components = { Hero: { fields: { title: { type: 'text' } } } };",
        'puck.config.ts': "import { components } from './components';\nexport default { components };",
      },
      (root) => {
        const manifest = readPuckConfig({ configPath: join(root, 'puck.config.ts') });
        expect(manifest.components.Hero?.fields.title?.type).toBe('text');
      },
    );
  });

  test('reads the entries a spread brings into the components map', () => {
    withFiles(
      {
        'shared.ts': "export const shared = { Hero: { fields: { title: { type: 'text' } } } };",
        'puck.config.ts':
          "import { shared } from './shared';\n" +
          'export default { components: { ...shared, Badge: { fields: {} } } };',
      },
      (root) => {
        const manifest = readPuckConfig({ configPath: join(root, 'puck.config.ts') });
        expect(Object.keys(manifest.components).sort()).toEqual(['Badge', 'Hero']);
        expect(manifest.components.Hero?.fields.title?.type).toBe('text');
        expect(manifest.unreadable).toBeUndefined();
      },
    );
  });

  test('admits a components-map spread it cannot follow, and keeps reading the rest', () => {
    withFiles(
      { 'puck.config.ts': 'export default { components: { ...buildComponents(), Badge: { fields: {} } } };' },
      (root) => {
        const manifest = readPuckConfig({ configPath: join(root, 'puck.config.ts') });
        // The names behind the spread are unknown, so there is nothing to add
        // to `unresolved` — the manifest as a whole is incomplete instead.
        expect(manifest.unreadable).toBe(true);
        expect(manifest.components.Badge).toBeDefined();
        expect(manifest.unresolved).toEqual([]);
      },
    );
  });

  test('lets an unreadable duplicate take the earlier reading of the same name with it', () => {
    withFiles(
      {
        'puck.config.ts':
          'export default { components: {\n' +
          "  Hero: { fields: { title: { type: 'text' } } },\n" +
          '  Hero: buildHero(),\n' +
          '} };',
      },
      (root) => {
        const manifest = readPuckConfig({ configPath: join(root, 'puck.config.ts') });
        expect(manifest.components.Hero).toBeUndefined();
        expect(manifest.unresolved).toEqual(['Hero']);
      },
    );
  });

  test('cannot be made to replace the manifest prototype through a component name', () => {
    withFiles(
      {
        'puck.config.ts': 'export default { components: { __proto__: { fields: {} }, Hero: { fields: {} } } };',
      },
      (root) => {
        const manifest = readPuckConfig({ configPath: join(root, 'puck.config.ts') });
        expect(Object.keys(manifest.components)).toEqual(['Hero']);
        expect(Object.getPrototypeOf(manifest.components)).toBe(Object.prototype);
      },
    );
  });

  test('reads categories and root fields', () => {
    withFiles(
      {
        'puck.config.ts':
          'export default {\n' +
          '  components: { Grid: { fields: {} } },\n' +
          "  categories: { layout: { title: 'Layout', components: ['Grid'] } },\n" +
          "  root: { fields: { pageTitle: { type: 'text' } } },\n" +
          '};',
      },
      (root) => {
        const manifest = readPuckConfig({ configPath: join(root, 'puck.config.ts') });
        expect(manifest.categories?.layout).toEqual({ title: 'Layout', components: ['Grid'] });
        expect(manifest.root?.fields.pageTitle?.type).toBe('text');
      },
    );
  });

  // Page fields are a field set like any other: a spread is merged where it
  // sits, and one that cannot be followed is admitted rather than skipped.
  test('reads root fields spread from a written-down set, in source order', () => {
    withFiles(
      {
        'puck.config.ts':
          "const shared = { title: { type: 'text' }, slug: { type: 'text' } };\n" +
          "export default { components: {}, root: { fields: { title: { type: 'textarea' }, ...shared } } };",
      },
      (root) => {
        const manifest = readPuckConfig({ configPath: join(root, 'puck.config.ts') });
        expect(manifest.root).toEqual({ fields: { title: { type: 'text' }, slug: { type: 'text' } } });
      },
    );
  });

  test('admits root fields behind a spread it cannot follow, keeping the ones written after it', () => {
    withFiles(
      {
        'puck.config.ts':
          "export default { components: {}, root: { fields: { lost: { type: 'text' }, ...mk(), title: { type: 'text' } } } };",
      },
      (root) => {
        const manifest = readPuckConfig({ configPath: join(root, 'puck.config.ts') });
        expect(manifest.root).toEqual({ fields: { title: { type: 'text' } }, fieldsUnreadable: true });
      },
    );
  });

  test('admits a root field set it cannot follow at all rather than reporting a page with no fields', () => {
    withFiles({ 'puck.config.ts': 'export default { components: {}, root: { fields: buildFields() } };' }, (root) => {
      const manifest = readPuckConfig({ configPath: join(root, 'puck.config.ts') });
      expect(manifest.root).toEqual({ fields: {}, fieldsUnreadable: true });
    });
  });

  test('a root that writes no fields has no page fields to report', () => {
    withFiles({ 'puck.config.ts': 'export default { components: {}, root: { render: () => null } };' }, (root) => {
      const manifest = readPuckConfig({ configPath: join(root, 'puck.config.ts') });
      expect(manifest.root).toBeUndefined();
    });
  });

  // A call to something that is no function at all is not a wrapper, and
  // blaming a "callee" for it points the reader of the reason at the wrong line.
  test('a spread of a call that is not to a declared function says the spread could not be followed', () => {
    withFiles({ 'puck.config.ts': "export default { components: { X: { ...mk(), label: 'X' } } };" }, (root) => {
      const manifest = readPuckConfig({ configPath: join(root, 'puck.config.ts') });
      expect(manifest.unresolved).toEqual(['X']);
      expect(manifest.unresolvedReasons?.X).toBe(
        'the component spreads ...mk(), which this reader cannot follow to an object written in the source',
      );
    });
  });

  // A wrapper held by a let is written in the config, so a spread of what it
  // builds says why the wrapper was refused rather than that the spread led
  // nowhere — the same reason the component gets when it is not spread.
  test('a spread of a component a let-declared wrapper builds gives the let reason', () => {
    withFiles(
      {
        'puck.config.ts': [
          "const Inner = { label: 'I', fields: {} };",
          "let withLabel = (config) => ({ ...config, label: 'W' });",
          'const Grid = withLabel(Inner);',
          "export default { components: { Direct: Grid, Grid: { ...Grid, label: 'G' } } };",
        ].join('\n'),
      },
      (root) => {
        const manifest = readPuckConfig({ configPath: join(root, 'puck.config.ts') });
        expect(manifest.unresolved).toEqual(['Direct', 'Grid']);
        expect(manifest.unresolvedReasons?.Direct).toMatch(/declared with let or var/);
        expect(manifest.unresolvedReasons?.Grid).toBe(manifest.unresolvedReasons?.Direct);
      },
    );
  });

  test('names a component it could not resolve instead of reporting it as empty', () => {
    withFiles(
      { 'puck.config.ts': "import { Mystery } from 'nowhere';\nexport default { components: { Mystery } };" },
      (root) => {
        const manifest = readPuckConfig({ configPath: join(root, 'puck.config.ts') });
        expect(manifest.unresolved).toEqual(['Mystery']);
        expect(manifest.components.Mystery).toBeUndefined();
      },
    );
  });

  // A spread over a component a wrapper builds is the shape our own production
  // config writes seven times over. The override literal alone is a label and no
  // fields, so reporting it would describe a component that accepts nothing.
  test('a spread whose source cannot be resolved marks the component unresolved', () => {
    withFiles(
      {
        'Flex.ts':
          "const FlexInner = { fields: { gap: { type: 'number' } } };\nexport const Flex = withLayout(FlexInner);",
        'puck.config.ts':
          "import { Flex } from './Flex';\n" +
          "export default { components: { Flex: { ...Flex, label: 'Flex Container' } } };",
      },
      (root) => {
        const manifest = readPuckConfig({ configPath: join(root, 'puck.config.ts') });
        expect(manifest.unresolved).toEqual(['Flex']);
        expect(manifest.components.Flex).toBeUndefined();
      },
    );
  });

  // Both of our own sites build their layout primitives as
  // `export const X = withLayout(XInternal)`, and those are the components
  // carrying the slot nesting rules. A reader that stops at the call reports
  // the most structural components on the site as unknown.
  test('reads a component built by a simple wrapper, with the wrapper-added field', () => {
    withFiles(
      {
        'Inner.ts':
          "export const GridInternal = { label: 'Grid', fields: { items: { type: 'slot', disallow: ['Hero'] } } };",
        'withLayout.ts':
          "const layoutField = { type: 'object', objectFields: { spanCol: { type: 'number' } } };\n" +
          'export function withLayout(config) {\n' +
          '  return { ...config, fields: { ...config.fields, layout: layoutField }, resolveFields: () => ({}) };\n' +
          '}',
        'Grid.ts':
          "import { GridInternal } from './Inner';\n" +
          "import { withLayout } from './withLayout';\n" +
          'export const Grid = withLayout(GridInternal);',
        'puck.config.ts': "import { Grid } from './Grid';\nexport default { components: { Grid } };",
      },
      (root) => {
        const manifest = readPuckConfig({ configPath: join(root, 'puck.config.ts') });
        expect(manifest.unresolved).toEqual([]);
        expect(manifest.components.Grid?.fields.items?.disallow).toEqual(['Hero']);
        expect(manifest.components.Grid?.fields.layout?.type).toBe('object');
        expect(manifest.components.Grid?.dynamicFields).toBe(true);
      },
    );
  });

  // `Grid: { ...Grid, label: 'Grid Container' }` is the shape our production
  // config writes seven times over: the override renames a wrapper-built
  // component, so the spread source is a call rather than a literal.
  test('a spread override whose source is wrapper-built merges instead of failing', () => {
    withFiles(
      {
        'Inner.ts':
          "export const GridInternal = { label: 'Grid', fields: { items: { type: 'slot', disallow: ['Hero'] } } };",
        'withLayout.ts':
          "const layoutField = { type: 'object', objectFields: { spanCol: { type: 'number' } } };\n" +
          'export function withLayout(config) {\n' +
          '  return { ...config, fields: { ...config.fields, layout: layoutField }, resolveFields: () => ({}) };\n' +
          '}',
        'Grid.ts':
          "import { GridInternal } from './Inner';\n" +
          "import { withLayout } from './withLayout';\n" +
          'export const Grid = withLayout(GridInternal);',
        'puck.config.ts':
          "import { Grid } from './Grid';\n" +
          "export default { components: { Grid: { ...Grid, label: 'Grid Container' } } };",
      },
      (root) => {
        const manifest = readPuckConfig({ configPath: join(root, 'puck.config.ts') });
        expect(manifest.unresolved).toEqual([]);
        expect(manifest.components.Grid?.label).toBe('Grid Container');
        expect(manifest.components.Grid?.fields.items?.disallow).toEqual(['Hero']);
        expect(manifest.components.Grid?.fields.layout?.type).toBe('object');
        expect(manifest.components.Grid?.dynamicFields).toBe(true);
      },
    );
  });

  test('a refused wrapper stays unresolved and the manifest says why', () => {
    withFiles(
      {
        'Odd.ts':
          'export function weird(config) { const x = 1; return { ...config }; }\n' +
          'const Inner = { fields: {} };\n' +
          'export const Odd = weird(Inner);',
        'puck.config.ts': "import { Odd } from './Odd';\nexport default { components: { Odd } };",
      },
      (root) => {
        const manifest = readPuckConfig({ configPath: join(root, 'puck.config.ts') });
        expect(manifest.unresolved).toEqual(['Odd']);
        // The reason is prose for a human reading a doctor report, so it is
        // matched rather than pinned word for word.
        expect(manifest.unresolvedReasons?.Odd).toMatch(/statements/);
      },
    );
  });

  test('reads a config declared as a const and exported as default', () => {
    withFiles(
      {
        'puck.config.ts':
          "const config = { components: { Hero: { fields: { title: { type: 'text' } } } } };\n" +
          'export default config;',
      },
      (root) => {
        const manifest = readPuckConfig({ configPath: join(root, 'puck.config.ts') });
        expect(manifest.components.Hero?.fields.title?.type).toBe('text');
      },
    );
  });

  test('a missing config file yields an empty manifest rather than throwing', async () => {
    const path = join(tmpdir(), 'puck-config-never-written', 'puck.config.ts');
    const manifest = readPuckConfig({ configPath: path });
    // The runtime has nothing to load either.
    await expect(import(path)).rejects.toThrow();
    // Empty and unreadable, not empty and true: a caller must be able to tell
    // "no config here" from "a site that declares no components".
    expect(manifest).toEqual(
      refused('the config file could not be opened: it is missing, or its path is not a file this reader can read'),
    );
  });

  test('a config wrapped in a call is admitted rather than reported as a site with no components', async () => {
    const { manifest, loaded } = await readAndTry({
      'puck.config.ts':
        'const defineConfig = (config) => config;\n' +
        'export default defineConfig({ components: { Hero: { fields: {} } } });',
    });
    // The call hands back a config with Hero in it, which only running it shows.
    expect(Object.keys(loadedConfig(loaded).components)).toEqual(['Hero']);
    expect(manifest).toEqual(
      refused(
        "the config's default export, defineConfig({ components: { Hero: { fields: {} } } }), is a call's result, which this reader would have to run to know, so its components are unknown",
      ),
    );
  });

  test('a config file with no default export is admitted as unread', async () => {
    const { manifest, loaded } = await readAndTry({ 'puck.config.ts': 'export const config = { components: {} };' });
    expect(loaded).toBeDefined();
    expect(loaded?.default).toBeUndefined();
    expect(manifest).toEqual(refused('the config file has no default export, so there is no config to read'));
  });

  // Real configs are .tsx, and a project with no jsx support resolves an import
  // of a .tsx file to nothing at all — every component would read as unresolved
  // with no error to explain it. The reader finds the host tsconfig itself.
  test('reads a .tsx config by finding the host tsconfig on its own', () => {
    withFiles(
      {
        'tsconfig.json': '{ "compilerOptions": { "jsx": "preserve" } }',
        'components/Hero.tsx': "export const Hero = { label: 'Hero', fields: { title: { type: 'text' } } };",
        'components/index.ts': "export { Hero } from './Hero';",
        'puck.config.tsx': "import { Hero } from './components';\nexport default { components: { Hero } };",
      },
      (root) => {
        const manifest = readPuckConfig({ configPath: join(root, 'puck.config.tsx') });
        expect(manifest.unresolved).toEqual([]);
        expect(manifest.components.Hero?.fields.title?.type).toBe('text');
      },
    );
  });

  // The same silent-nothing failure, reached from the two directions a host
  // project can arrive at it: a tsconfig that says nothing about jsx, and one
  // that cannot be parsed at all. Neither may cost the reader its components.
  test('reads a .tsx component through a tsconfig that declares no jsx support', () => {
    withFiles(
      {
        'tsconfig.json': '{ "compilerOptions": { "target": "ES2022" } }',
        'components/Hero.tsx': "export const Hero = { fields: { title: { type: 'text' } } };",
        'puck.config.tsx': "import { Hero } from './components/Hero';\nexport default { components: { Hero } };",
      },
      (root) => {
        const manifest = readPuckConfig({ configPath: join(root, 'puck.config.tsx') });
        expect(manifest.unresolved).toEqual([]);
        expect(manifest.components.Hero?.fields.title?.type).toBe('text');
      },
    );
  });

  test('reads a .tsx component past a tsconfig that is not valid JSON', () => {
    withFiles(
      {
        'tsconfig.json': '{ "compilerOptions": { this is not json',
        'components/Hero.tsx': "export const Hero = { fields: { title: { type: 'text' } } };",
        'puck.config.tsx': "import { Hero } from './components/Hero';\nexport default { components: { Hero } };",
      },
      (root) => {
        const manifest = readPuckConfig({ configPath: join(root, 'puck.config.tsx') });
        expect(manifest.unresolved).toEqual([]);
        expect(manifest.components.Hero?.fields.title?.type).toBe('text');
      },
    );
  });
});

describe('readPuckConfig, held to the config it read', () => {
  /** Whether a behaviour key holds code Puck will run. */
  const runs = (value: unknown) => typeof value === 'function';

  // `undefined` or `null` written after a spread leaves Puck nothing to run,
  // whatever the spread supplied — the marker would claim behaviour that is gone.
  test('a behaviour key cleared after a spread marks nothing', async () => {
    const { manifest, runtime } = await readAndRun(`
      const Base = { label: 'B', fields: {}, resolveData: async (data) => data };
      const Clear = { resolveData: undefined };
      export default { components: {
        Cleared: { ...Base, resolveData: undefined },
        ClearedNull: { ...Base, resolveData: null },
        ClearedBySpread: { ...Base, ...Clear },
        Before: { resolveData: undefined, ...Base },
      } };
    `);
    for (const name of ['Cleared', 'ClearedNull', 'ClearedBySpread', 'Before']) {
      expect({ name, marked: manifest.components[name]?.derivedProps === true }).toEqual({
        name,
        marked: runs(runtime.components[name]?.resolveData),
      });
    }
  });

  // The markers only ever say code MAY decide something: a later write this
  // reader cannot see through may be a function, so it keeps the marker.
  test('a behaviour key a later write sets unreadably stays marked', async () => {
    const { manifest, runtime } = await readAndRun(`
      const pick = () => async (data) => data;
      const Base = { fields: {}, resolveData: undefined };
      export default { components: { Picked: { ...Base, resolveData: pick() } } };
    `);
    expect(runs(runtime.components.Picked?.resolveData)).toBe(true);
    expect(manifest.components.Picked?.derivedProps).toBe(true);
  });

  test('a root built by a call is admitted rather than left out', async () => {
    const { manifest, runtime } = await readAndRun(`
      const buildRoot = () => ({ fields: { title: { type: 'text' } } });
      export default { components: {}, root: buildRoot() };
    `);
    expect(enumerated(runtime.root?.fields)).toEqual(['title']);
    expect(manifest.root).toEqual({ fields: {}, fieldsUnreadable: true });
  });

  test('a field set that inherits entries through __proto__ admits them, at every level', async () => {
    const { manifest, runtime } = await readAndRun(`
      const SHARED = { inherited: { type: 'text' } };
      export default {
        components: {
          Inherits: { fields: { __proto__: SHARED, own: { type: 'text' } } },
          Nested: { fields: { o: { type: 'object', objectFields: { __proto__: SHARED, own: { type: 'text' } } } } },
          NullProto: { fields: { __proto__: null, own: { type: 'text' } } },
        },
        root: { fields: { __proto__: SHARED, own: { type: 'text' } } },
      };
    `);
    const { Inherits, Nested, NullProto } = runtime.components;
    expect(enumerated(Inherits?.fields)).toEqual(['own', 'inherited']);
    expect(manifest.components.Inherits).toEqual({ fields: { own: { type: 'text' } }, fieldsUnreadable: true });
    expect(
      enumerated((Nested as { fields: { o: { objectFields: Record<string, unknown> } } }).fields.o.objectFields),
    ).toEqual(['own', 'inherited']);
    expect(manifest.components.Nested?.fields.o).toEqual({
      type: 'object',
      objectFields: { own: { type: 'text' } },
      unreadable: true,
    });
    expect(enumerated(runtime.root?.fields)).toEqual(['own', 'inherited']);
    expect(manifest.root).toEqual({ fields: { own: { type: 'text' } }, fieldsUnreadable: true });
    // A null prototype hands the set nothing to inherit, so nothing is admitted.
    expect(enumerated(NullProto?.fields)).toEqual(['own']);
    expect(manifest.components.NullProto).toEqual({ fields: { own: { type: 'text' } } });
  });

  // `['__proto__']` is an ordinary own entry at runtime, and one no record of
  // this reader can hold — writing it would replace the record's prototype.
  test('a field named __proto__ through a computed key is admitted, not silently left out', async () => {
    const { manifest, runtime } = await readAndRun(`
      export default { components: { OwnProtoKey: { fields: { ['__proto__']: { type: 'text' }, own: { type: 'text' } } } } };
    `);
    expect(Object.keys(runtime.components.OwnProtoKey?.fields ?? {})).toEqual(['__proto__', 'own']);
    expect(manifest.components.OwnProtoKey).toEqual({ fields: { own: { type: 'text' } }, fieldsUnreadable: true });
    expect(Object.getPrototypeOf(manifest.components.OwnProtoKey?.fields)).toBe(Object.prototype);
  });

  // A value a call binds is read whole; there is nothing left unread to admit.
  test('a builder field read through a bound argument claims no gap it does not have', async () => {
    const { manifest, runtime } = await readAndRun(`
      const CLEAN = { max: 7 };
      const arrField = (o) => ({ type: 'array', arrayFields: { t: { type: 'text' } }, max: o.max });
      const lblField = (label) => ({ type: 'text', label });
      const labelled = (label) => ({ type: 'text', label: label });
      export default { components: { Bound: { fields: {
        l: arrField({ max: CLEAN.max }), t: lblField('Fine'), u: labelled('Also'),
      } } } };
    `);
    expect(manifest.components.Bound).toEqual(wire(runtime.components.Bound) as PuckManifest['components'][string]);
  });

  // An accessor with only a setter reads back undefined, so the label the
  // spread supplied is gone at runtime, and must be gone from the reading.
  test('a setter written over a spread takes the spread label with it', async () => {
    const { manifest, runtime } = await readAndRun(`
      const withSetter = (config) => ({ ...config, set label(value) {} });
      const Inner = { label: 'Inner', fields: {} };
      export const Wrapped = withSetter(Inner);
      export default { components: { Wrapped, Written: { ...Inner, set label(value) {} } } };
    `);
    for (const name of ['Wrapped', 'Written']) {
      expect(runtime.components[name]?.label).toBeUndefined();
      expect(manifest.components[name]).toEqual({ fields: {}, unreadableKeys: ['label'] });
    }
  });
});

describe('the components map, categories and plain values, held to the config they were read from', () => {
  /** A key the module computes at runtime, which this reader cannot name. */
  const RUNTIME_KEY = "const rk = (key) => key.split('').join('');";

  test('a computed component name takes the components written before it, and admits what it may add', async () => {
    const { manifest, runtime } = await readAndRun(`
      ${RUNTIME_KEY}
      export default { components: {
        Hero: { label: 'A', fields: {} },
        [rk('Hero')]: { label: 'B', fields: {} },
        [rk('Extra')]: { label: 'E', fields: {} },
        After: { label: 'After', fields: {} },
      } };
    `);
    expect(runtime.components.Hero?.label).toBe('B');
    expect(Object.keys(runtime.components)).toContain('Extra');
    expect(manifest.components).toEqual({ After: wire(runtime.components.After) } as PuckManifest['components']);
    expect(manifest.unresolved).toEqual(['Hero']);
    expect(manifest.unresolvedReasons?.Hero).toMatch(/a later entry of the components map/);
    expect(manifest.unreadable).toBe(true);
  });

  test('a components-map spread it cannot follow takes the components written before it', async () => {
    const { manifest, runtime } = await readAndRun(`
      const buildComponents = () => ({ Hero: { label: 'FromSpread', fields: {} } });
      export default { components: {
        Hero: { label: 'A', fields: {} },
        ...buildComponents(),
        Badge: { label: 'Badge', fields: {} },
      } };
    `);
    expect(runtime.components.Hero?.label).toBe('FromSpread');
    expect(manifest.components).toEqual({ Badge: wire(runtime.components.Badge) } as PuckManifest['components']);
    expect(manifest.unresolved).toEqual(['Hero']);
    expect(manifest.unreadable).toBe(true);
  });

  test('a component declared with a getter is admitted, not skipped', async () => {
    const { manifest, runtime } = await readAndRun(`
      export default { components: {
        Hero: { label: 'A', fields: {} },
        get Hero() { return { label: 'G', fields: {} }; },
      } };
    `);
    expect(runtime.components.Hero?.label).toBe('G');
    expect(manifest.components).toEqual({});
    expect(manifest.unresolved).toEqual(['Hero']);
    expect(manifest.unresolvedReasons?.Hero).toMatch(/getter or a method/);
  });

  // Puck looks a component up by name, and a lookup reaches the prototype.
  test('a components map that inherits through __proto__ admits the components it may inherit', async () => {
    const { manifest, runtime } = await readAndRun(`
      export default { components: { __proto__: { Inherited: { fields: {} } }, Hero: { fields: {} } } };
    `);
    expect(runtime.components.Inherited).toBeDefined();
    expect(manifest.components).toEqual({ Hero: { fields: {} } });
    expect(manifest.unreadable).toBe(true);
    expect(Object.getPrototypeOf(manifest.components)).toBe(Object.prototype);
  });

  test('a category a later computed key may rewrite is admitted, never read as it was first written', async () => {
    const { manifest, runtime } = await readAndRun(`
      ${RUNTIME_KEY}
      export default { components: {}, categories: {
        [rk('named')]: { title: 'Named', components: ['Flex'] },
        main: { title: 'Main', components: ['Hero'], [rk('title')]: 'Other' },
        titled: { components: ['Card'], title: makeTitle() },
        plain: { title: 'Plain', components: ['Grid'] },
      } };
      function makeTitle() { return 'Made'; }
    `);
    const categories = (runtime as unknown as { categories: Record<string, { title?: string }> }).categories;
    expect(categories.main?.title).toBe('Other');
    expect(categories.titled?.title).toBe('Made');
    expect(Object.keys(categories)).toContain('named');
    expect(manifest.categories).toEqual({
      titled: { components: ['Card'] },
      plain: { title: 'Plain', components: ['Grid'] },
    });
    expect(manifest.categoriesUnreadable).toBe(true);
  });

  test('categories read whole admit nothing, whatever keys the manifest does not carry', async () => {
    const { manifest, runtime } = await readAndRun(`
      ${RUNTIME_KEY}
      const LAYOUT = ['Grid', 'Flex'];
      export default { components: {}, categories: {
        layout: { [rk('visible')]: true, title: 'Layout', components: LAYOUT, defaultExpanded: isOpen() },
      } };
      function isOpen() { return true; }
    `);
    const { layout } = (runtime as unknown as { categories: Record<string, { title: string; components: string[] }> })
      .categories;
    expect(manifest.categories).toEqual({
      layout: { title: layout?.title ?? '', components: layout?.components ?? [] },
    });
    expect(manifest.categoriesUnreadable).toBeUndefined();
  });

  test('categories built by a call are admitted rather than reported as none', async () => {
    const { manifest } = await readAndRun(`
      export default { components: {}, categories: buildCategories() };
      function buildCategories() { return { all: { components: [] } }; }
    `);
    expect(manifest.categories).toBeUndefined();
    expect(manifest.categoriesUnreadable).toBe(true);
  });

  test('an option whose value a later computed key replaces is not read as the earlier value', async () => {
    const { manifest, runtime } = await readAndRun(`
      ${RUNTIME_KEY}
      export default { components: { S: { fields: {
        s: { type: 'select', options: [{ label: 'A', value: 'a', [rk('value')]: 'b' }] },
      } } } };
    `);
    const options = (runtime.components.S as { fields: { s: { options: { value: string }[] } } }).fields.s.options;
    expect(options[0]?.value).toBe('b');
    expect(manifest.components.S?.fields.s).toEqual({ type: 'select', unreadable: true });
  });

  test('a field annotation whose schema a later computed key replaces reports no schema, and claims no opacity', async () => {
    const { manifest, runtime } = await readAndRun(`
      ${RUNTIME_KEY}
      export default { components: { C: { fields: {
        c: { type: 'custom', ai: { schema: { type: 'number' }, [rk('schema')]: { type: 'string' } } },
      } } } };
    `);
    const ai = (runtime.components.C as { fields: { c: { ai: { schema: { type: string } } } } }).fields.c.ai;
    expect(ai.schema.type).toBe('string');
    expect(manifest.components.C?.fields.c).toEqual({ type: 'custom', unreadable: true });
  });

  test('an option label or value read only in part is admitted, never handed on as the whole', async () => {
    const { manifest, runtime } = await readAndRun(`
      ${RUNTIME_KEY}
      export default { components: { S: { fields: {
        value: { type: 'select', options: [{ label: 'A', value: { x: rk('x'), y: 1 } }] },
        label: { type: 'radio', options: [{ label: { t: rk('t') }, value: 'a' }] },
        beside: { type: 'select', options: [{ label: 'A', value: 'a', icon: rk('i') }] },
      } } } };
    `);
    const fields = (runtime.components.S as { fields: Record<string, { options: Record<string, unknown>[] }> }).fields;
    expect(fields.value?.options[0]?.value).toEqual({ x: 'x', y: 1 });
    expect(fields.label?.options[0]?.label).toEqual({ t: 't' });
    expect(manifest.components.S?.fields.value).toEqual({ type: 'select', unreadable: true });
    expect(manifest.components.S?.fields.label).toEqual({ type: 'radio', unreadable: true });
    // A gap beside a pair that is plain text leaves the pair whole.
    expect(manifest.components.S?.fields.beside).toEqual({ type: 'select', options: [{ label: 'A', value: 'a' }] });
  });

  test('a behaviour key a computed key may have written is admitted, and a later write settles it', async () => {
    const { manifest, runtime } = await readAndRun(`
      ${RUNTIME_KEY}
      const Hidden = { fields: {}, [rk('resolveData')]: async (data) => data };
      export default { components: {
        Direct: { fields: {}, [rk('resolveData')]: async (data) => data },
        Spread: { ...Hidden },
        Settled: { ...Hidden, resolveData: undefined, resolveFields: async () => ({}) },
      } };
    `);
    expect(typeof runtime.components.Direct?.resolveData).toBe('function');
    expect(typeof runtime.components.Spread?.resolveData).toBe('function');
    for (const name of ['Direct', 'Spread']) {
      expect(manifest.components[name]?.derivedProps).toBeUndefined();
      expect(manifest.components[name]?.unreadableKeys).toContain('resolveData');
    }
    expect(runtime.components.Settled?.resolveData).toBeUndefined();
    expect(manifest.components.Settled?.derivedProps).toBeUndefined();
    expect(manifest.components.Settled?.dynamicFields).toBe(true);
    expect(manifest.components.Settled?.unreadableKeys).not.toContain('resolveData');
    expect(manifest.components.Settled?.unreadableKeys).not.toContain('resolveFields');
    expect(manifest.components.Settled?.unreadableKeys).toContain('resolvePermissions');
  });

  test('a behaviour key cleared with void 0 or a const holding undefined marks nothing', async () => {
    const { manifest, runtime } = await readAndRun(`
      const Base = { fields: {}, resolveData: async (data) => data };
      const NONE = undefined;
      const resolveData = null;
      export default { components: {
        Void: { ...Base, resolveData: void 0 },
        Named: { ...Base, resolveData: NONE },
        Shorthand: { ...Base, resolveData },
      } };
    `);
    for (const name of ['Void', 'Named', 'Shorthand']) {
      expect(typeof runtime.components[name]?.resolveData).not.toBe('function');
      expect(manifest.components[name]).toEqual({ fields: {} });
    }
  });

  test('a field annotation follows the names it spreads, as a component annotation does', async () => {
    const { manifest, runtime } = await readAndRun(`
      const SCHEMA = { type: 'string' };
      const AIB = { schema: SCHEMA };
      export default { components: { C: { fields: { c: { type: 'custom', ai: { ...AIB, instructions: 'x' } } } } } };
    `);
    const field = (runtime.components.C as { fields: { c: unknown } }).fields.c;
    expect(manifest.components.C?.fields.c).toEqual(
      wire(field) as PuckManifest['components'][string]['fields'][string],
    );
  });

  test('a component named by a const that sums strings is read under that name', async () => {
    const { manifest, runtime } = await readAndRun(`
      const M = 'He' + 'ro';
      export default { components: { [M]: { label: 'H', fields: {} } } };
    `);
    expect(manifest.components).toEqual(wire(runtime.components) as PuckManifest['components']);
    expect(manifest.unreadable).toBeUndefined();
  });

  test('a component written with a setter gives its own reason, not the one a getter gives', async () => {
    const { manifest, runtime } = await readAndRun(`
      export default { components: { set Hero(value) {}, get Card() { return { fields: {} }; } } };
    `);
    expect(runtime.components.Hero).toBeUndefined();
    expect(manifest.unresolved).toEqual(['Hero', 'Card']);
    expect(manifest.unresolvedReasons?.Hero).toMatch(/setter/);
    expect(manifest.unresolvedReasons?.Card).toMatch(/getter or a method/);
  });

  test('a components-map spread of null or undefined takes nothing with it', async () => {
    const { manifest, runtime } = await readAndRun(`
      const NONE = undefined;
      export default { components: { Hero: { label: 'H', fields: {} }, ...null, ...undefined, ...void 0, ...NONE } };
    `);
    expect(manifest.components).toEqual(wire(runtime.components) as PuckManifest['components']);
    expect(manifest.unresolved).toEqual([]);
    expect(manifest.unreadable).toBeUndefined();
  });

  test('categories given by a name are followed', async () => {
    const { manifest, runtime } = await readAndRun(`
      const LIST = ['Hero'];
      const CATS = { main: { title: 'Main', components: LIST } };
      export default { components: { Hero: { fields: {} } }, categories: CATS };
    `);
    expect(manifest.categories).toEqual(
      wire((runtime as unknown as { categories: unknown }).categories) as PuckManifest['categories'],
    );
    expect(manifest.categoriesUnreadable).toBeUndefined();
  });

  test('a named item list in the defaults admits the part it could not read, as the one written in place does', async () => {
    const { manifest, runtime } = await readAndRun(`
      const defaultId = () => 'id-' + Math.random().toString(36).slice(2);
      const ITEMS = [{ id: defaultId(), label: 'x' }];
      export default { components: {
        Named: { fields: {}, defaultProps: { items: ITEMS } },
        Inline: { fields: {}, defaultProps: { items: [{ id: defaultId(), label: 'x' }] } },
      } };
    `);
    for (const name of ['Named', 'Inline']) {
      const items = (runtime.components[name] as { defaultProps: { items: { id: string; label: string }[] } })
        .defaultProps.items;
      expect(typeof items[0]?.id).toBe('string');
      expect(manifest.components[name]).toEqual({
        fields: {},
        defaultProps: { items: [{ label: items[0]?.label ?? '' }] },
        unreadableKeys: ['defaultProps'],
      });
    }
  });
});

describe('the config object itself, held to the module it was read from', () => {
  /** A config as the module holds it, with the keys this suite compares. */
  type WholeConfig = RuntimeConfig & { categories?: unknown };

  test('a named config spread into the export is read where it sits', async () => {
    const { manifest, runtime } = await readAndRun(`
      const Base = {
        components: { Hero: { label: 'H', fields: {} } },
        categories: { main: { title: 'Main', components: ['Hero'] } },
        root: { fields: { title: { type: 'text' } } },
      };
      export default { ...Base };
    `);
    const config = runtime as WholeConfig;
    expect(manifest.components).toEqual(wire(config.components) as PuckManifest['components']);
    expect(manifest.categories).toEqual(wire(config.categories) as PuckManifest['categories']);
    expect(manifest.root).toEqual(wire(config.root) as PuckManifest['root']);
    expect(manifest.unreadable).toBeUndefined();
  });

  test('a later spread replaces the components written before it', async () => {
    const { manifest, runtime } = await readAndRun(`
      const Other = { components: { Card: { label: 'C', fields: {} } } };
      export default { components: { Hero: { label: 'H', fields: {} } }, ...Other };
    `);
    expect(Object.keys(runtime.components)).toEqual(['Card']);
    expect(manifest.components).toEqual(wire(runtime.components) as PuckManifest['components']);
  });

  // Twenty thousand parts is one line of source, and a fold that recursed
  // into it would run out of call stack long before the parts ran out.
  test('a computed name summed from twenty thousand parts is read, never a crash', async () => {
    const { manifest, runtime } = await readAndRun(
      `export default { components: { [${"'a' + ".repeat(19_999)}'b']: { fields: {} } } };`,
    );
    expect(Object.keys(runtime.components)[0]).toHaveLength(20_000);
    expect(manifest).toEqual({ components: wire(runtime.components) as PuckManifest['components'], unresolved: [] });
  });

  test('a computed key it cannot name makes every key before it unknown', async () => {
    const { manifest, runtime } = await readAndRun(`
      const rk = (key) => key.split('').join('');
      export default {
        components: { Hero: { fields: {} } },
        categories: { main: { components: ['Hero'] } },
        root: { fields: { title: { type: 'text' } } },
        [rk('components')]: { Card: { fields: {} } },
      };
    `);
    expect(Object.keys(runtime.components)).toEqual(['Card']);
    expect(manifest).toEqual({
      components: {},
      unresolved: [],
      unreadable: true,
      unreadableReason:
        "the config writes a key under a computed name, [rk('components')], that this reader cannot work out, and it may set the components map, so its components are unknown",
      categoriesUnreadable: true,
      root: { fields: {}, fieldsUnreadable: true },
    });
  });

  test('a config spread it cannot follow admits what it may carry, and reads what is written after it', async () => {
    const { manifest, runtime } = await readAndRun(`
      const make = () => ({ categories: { all: { components: ['Hero'] } }, root: { fields: {} } });
      export default { ...make(), components: { Hero: { fields: {} } } };
    `);
    expect(manifest.components).toEqual(wire(runtime.components) as PuckManifest['components']);
    expect(manifest.unreadable).toBeUndefined();
    expect(manifest.categories).toBeUndefined();
    expect(manifest.categoriesUnreadable).toBe(true);
    expect(manifest.root).toEqual({ fields: {}, fieldsUnreadable: true });
  });

  test('components, categories and root written as code are admitted, never read as missing', async () => {
    const { manifest, runtime } = await readAndRun(`
      export default {
        get components() { return { Hero: { fields: {} } }; },
        categories() { return {}; },
        get root() { return { fields: { title: { type: 'text' } } }; },
      };
    `);
    expect(Object.keys(runtime.components)).toEqual(['Hero']);
    expect(manifest).toEqual({
      components: {},
      unresolved: [],
      unreadable: true,
      unreadableReason:
        'the config declares components with a getter or a method, whose code this reader does not run, so its components are unknown',
      categoriesUnreadable: true,
      root: { fields: {}, fieldsUnreadable: true },
    });
  });

  test('a key that holds nothing is no key, and a spread of nothing writes none', async () => {
    const { manifest, runtime } = await readAndRun(`
      export default { components: { Hero: { fields: {} } }, ...null, ...undefined, categories: undefined, root: undefined };
    `);
    const config = runtime as WholeConfig;
    expect(config.root).toBeUndefined();
    expect(config.categories).toBeUndefined();
    expect(manifest).toEqual({ components: wire(runtime.components) as PuckManifest['components'], unresolved: [] });
  });
});

describe('a config whose objects are spread into one another over and over', () => {
  /**
   * Loads in an instant — each level spreads the one below it `width` times —
   * but read naively it asks for `width` to the power of `depth` walks.
   */
  function fanOut(width: number, depth: number, where: 'components' | 'fields'): string {
    const levels = [
      where === 'components'
        ? "const M0 = { Hero: { label: 'H', fields: {} } };"
        : "const M0 = { t: { type: 'text' } };",
    ];
    for (let level = 1; level <= depth; level++) {
      levels.push(`const M${level} = { ${Array.from({ length: width }, () => `...M${level - 1}`).join(', ')} };`);
    }
    const map = `M${depth}`;
    return `${levels.join('\n')}\nexport default { components: ${where === 'components' ? map : `{ Hero: { fields: ${map} } }`} };`;
  }

  // 10^8 walks read naively, minutes of work; each literal walked once, a blink.
  test('a components map is read in its length, not its width to the power of its depth', async () => {
    const { manifest, runtime } = await readAndRun(fanOut(10, 8, 'components'));
    expect(manifest.components).toEqual(wire(runtime.components) as PuckManifest['components']);
    expect(manifest.unreadable).toBeUndefined();
  });

  // Spends the whole budget before it is refused — a few seconds, more on a
  // busy machine.
  test('one that would cost more than the reader allows is refused with a reason, never read in part', async () => {
    const { manifest } = await readAndRun(fanOut(10, 6, 'fields'));
    expect(manifest).toEqual({
      components: {},
      unresolved: [],
      unreadable: true,
      unreadableReason: expect.stringMatching(/visited more than 2,000,000 object properties/),
    });
  }, 60_000);

  /**
   * A field's `ai` built from names that each name the one below ten times.
   * Seven levels are under a hundred properties to read, and ten million
   * values once serialized, because every place a name appears carries a whole
   * copy of what it names.
   */
  function repeated(depth: number): string {
    const levels = ['const A0 = { leaf: 1 };'];
    for (let level = 1; level <= depth; level++) {
      levels.push(`const A${level} = { ${Array.from({ length: 10 }, (_, k) => `k${k}: A${level - 1}`).join(', ')} };`);
    }
    return `${levels.join('\n')}\nexport default { components: { C: { fields: { f: { type: 'custom', ai: A${depth} } } } } };`;
  }

  test('one whose manifest would hold more than the reader allows is refused, never sent', async () => {
    const { manifest, runtime } = await readAndRun(repeated(7));
    // The module really holds all of it: the leaf is there seven levels down.
    let value: unknown = runtime.components.C?.fields?.f;
    for (const key of ['ai', 'k9', 'k9', 'k9', 'k9', 'k9', 'k9', 'k9']) value = (value as Record<string, unknown>)[key];
    expect(value).toEqual({ leaf: 1 });

    expect(manifest.unreadable).toBe(true);
    expect(manifest).toEqual({
      components: {},
      unresolved: [],
      unreadable: true,
      unreadableReason: expect.stringMatching(/would hold more than 2,000,000 values/),
    });
    expect(JSON.stringify(manifest).length).toBeLessThan(1_000);
  });

  test('one under that limit is read whole, each shared object written out where it appears', async () => {
    const { manifest, runtime } = await readAndRun(repeated(3));
    const field = runtime.components.C?.fields?.f as { ai: unknown };
    expect(manifest.unreadable).toBeUndefined();
    expect(manifest.components.C?.fields.f?.ai).toEqual(wire(field.ai) as ManifestField['ai']);
  });

  /**
   * Two field annotations reaching one chain of spreads: `Level300`, past
   * the nesting limit, and `Level100`, well inside it. Read first, the deep
   * one is cut short on the way down; what it walked on the way must not be
   * remembered, or the shallow one reads the cut.
   */
  function chains(deepFirst: boolean): string {
    const levels = ["const Level0 = { hint: 'x' };"];
    for (let level = 1; level <= 300; level++) levels.push(`const Level${level} = { ...Level${level - 1} };`);
    const deep = "deep: { type: 'text', ai: Level300 }";
    const shallow = "shallow: { type: 'text', ai: Level100 }";
    const fields = deepFirst ? `${deep}, ${shallow}` : `${shallow}, ${deep}`;
    return `${levels.join('\n')}\nexport default { components: { C: { fields: { ${fields} } } } };`;
  }

  test('a walk cut short is never remembered, so reading order changes nothing', async () => {
    for (const deepFirst of [true, false]) {
      const { manifest, runtime } = await readAndRun(chains(deepFirst));
      const ran = runtime.components.C?.fields ?? {};
      const read = manifest.components.C?.fields;
      expect(read?.shallow).toEqual(wire(ran.shallow) as ManifestField);
      // Past the limit the deep one may be cut short: admitted, never read wrong.
      const cut: ManifestField = { type: 'text', unreadable: true };
      expect(read?.deep).toEqual(read?.deep?.unreadable ? cut : (wire(ran.deep) as ManifestField));
    }
  });
});

describe('a config the reader cannot read to the end is refused, never thrown', () => {
  /** A config whose one field's `ai` holds an array nested `depth` deep. */
  function nestedArrays(depth: number): string {
    return `export default { components: { C: { fields: { f: { type: 'custom', ai: ${'['.repeat(depth)}1${']'.repeat(depth)} } } } } };`;
  }

  test('a file nested deeper than the parser goes is refused for that, never called missing', async () => {
    const { manifest } = await readAndTry({ 'puck.config.ts': nestedArrays(20_000) });
    expect(manifest).toEqual({
      ...refused(''),
      unreadableReason: expect.stringMatching(
        /^reading the config ran out of call stack \(RangeError: Maximum call stack size exceeded\.?\) — usually source nested thousands of levels deep — so its components are unknown$/,
      ),
    });
  });

  // Each name sums the one below it fifteen times: 759,375 parts to fold,
  // and a key that long is a blink to build at runtime.
  test('a computed name that costs more to fold than the reader allows is refused, never read in part', async () => {
    const levels = ["const K0 = 'a';"];
    for (let level = 1; level <= 5; level++) {
      levels.push(`const K${level} = ${Array.from({ length: 15 }, () => `K${level - 1}`).join(' + ')};`);
    }
    const { manifest, runtime } = await readAndRun(
      `${levels.join('\n')}\nexport default { components: { [K5]: { fields: {} } } };`,
    );
    expect(Object.keys(runtime.components)[0]).toHaveLength(15 ** 5);
    expect(manifest).toEqual({
      ...refused(''),
      unreadableReason: expect.stringMatching(
        /^reading the config visited more than 2,000,000 object properties, array items and parts of computed names/,
      ),
    });
  }, 60_000);

  // Eight kilobytes of source fold to a name 800 million characters long.
  // Refused once it outgrows what a manifest may run to, it never gets there.
  test('a computed name longer than a manifest may run to is refused before it is built', async () => {
    const parts = (name: string, count: number) => Array.from({ length: count }, () => name).join(' + ');
    const source = [
      `const A = '${'x'.repeat(2_000)}';`,
      `const B = ${parts('A', 400)};`,
      `const C = ${parts('B', 1_000)};`,
      'export default { components: { [C]: { fields: {} } } };',
    ].join('\n');
    expect(source.length).toBeLessThan(8_000);
    // Read and never run: the module would build the whole name.
    withFiles({ 'puck.config.ts': source }, (root) => {
      expect(readPuckConfig({ configPath: join(root, 'puck.config.ts') })).toEqual({
        ...refused(''),
        unreadableReason: expect.stringMatching(/^a computed name would run to more than 32,000,000 characters/),
      });
    });
  });
});

describe('a config that names one large value in many places is refused before it is copied out', () => {
  /** A field's `ai` naming `SHARED` four thousand times. */
  function namedEverywhere(shared: string): string {
    const entries = Array.from({ length: 4_000 }, (_, k) => `k${k}: SHARED`).join(', ');
    return `const SHARED = ${shared};\nconst P = { ${entries} };\nexport default { components: { C: { fields: { f: { type: 'custom', ai: P } } } } };`;
  }

  /** The `ai` a module that ran holds on its one field. */
  function ranAi(runtime: RuntimeConfig): Record<string, unknown> {
    const field = runtime.components.C?.fields?.f;
    if (typeof field !== 'object' || field === null || !('ai' in field)) {
      throw new Error('Runtime fixture is missing C.fields.f.ai');
    }
    const ai = field.ai;
    if (typeof ai !== 'object' || ai === null || Array.isArray(ai)) {
      throw new Error('Runtime fixture C.fields.f.ai must be an object');
    }
    return ai as Record<string, unknown>;
  }

  test('runtime AI fixture rejects missing and non-object values', () => {
    expect(() => ranAi({ components: {} })).toThrow('missing C.fields.f.ai');
    for (const ai of [undefined, null, [], 'invalid']) {
      expect(() => ranAi({ components: { C: { fields: { f: { ai } } } } })).toThrow('must be an object');
    }
    const ai = { shared: [1, 2] };
    expect(ranAi({ components: { C: { fields: { f: { ai } } } } })).toBe(ai);
  });

  const WORK_REFUSAL = /^reading the config visited more than 2,000,000 object properties, array items/;

  // Each name reads to its own copy: eight million items from 70 KB of source.
  test('an array of two thousand items named four thousand times', async () => {
    const source = namedEverywhere(`[${Array.from({ length: 2_000 }, (_, i) => i).join(', ')}]`);
    expect(source.length).toBeLessThan(72_000);
    const { manifest, runtime } = await readAndRun(source);
    expect(ranAi(runtime).k3999).toHaveLength(2_000);
    expect(manifest).toEqual({ ...refused(''), unreadableReason: expect.stringMatching(WORK_REFUSAL) });
  }, 60_000);

  // Sixteen million entries from 110 KB of source.
  test('an object of four thousand keys named four thousand times', async () => {
    const source = namedEverywhere(`{ ${Array.from({ length: 4_000 }, (_, i) => `x${i}: ${i}`).join(', ')} }`);
    expect(source.length).toBeLessThan(112_000);
    const { manifest, runtime } = await readAndRun(source);
    expect(Object.keys(ranAi(runtime).k3999 as object)).toHaveLength(4_000);
    expect(manifest).toEqual({ ...refused(''), unreadableReason: expect.stringMatching(WORK_REFUSAL) });
  }, 60_000);
});

describe('a manifest held to the size of what it sends', () => {
  const writtenRoots: string[] = [];
  afterAll(() => {
    for (const root of writtenRoots) rmSync(root, { recursive: true, force: true });
  });

  /** A field's `ai` naming `A{depth}`, where each level names the one below ten times and `A0` is `leaf`. */
  function namedOver(depth: number, leaf: string, label = ''): string {
    const levels = [`const A0 = ${leaf};`];
    for (let level = 1; level <= depth; level++) {
      levels.push(`const A${level} = { ${Array.from({ length: 10 }, (_, k) => `k${k}: A${level - 1}`).join(', ')} };`);
    }
    return `${levels.join('\n')}\nexport default { components: { C: { label: '${label}', fields: { f: { type: 'custom', ai: A${depth} } } } } };`;
  }

  /** The value `path` leads to inside a runtime value. */
  function at(value: unknown, path: string[]): unknown {
    return path.reduce((inner, key) => (inner as Record<string, unknown>)[key], value);
  }

  test('one whose manifest would run to more bytes than the reader sends is refused, never sent', async () => {
    // Under 3 KB of source, a hundred thousand values — and two hundred
    // million bytes of JSON.
    const source = namedOver(5, `'${'x'.repeat(2_000)}'`);
    expect(source.length).toBeLessThan(3_000);
    const { manifest, runtime } = await readAndRun(source);
    const leaf = at(runtime.components.C?.fields?.f, ['ai', 'k9', 'k9', 'k9', 'k9', 'k9']);
    expect(leaf).toBe('x'.repeat(2_000));
    expect(manifest).toEqual({
      ...refused(''),
      unreadableReason: expect.stringMatching(/^the manifest would run to more than 32,000,000 bytes of JSON/),
    });
    expect(JSON.stringify(manifest).length).toBeLessThan(1_000);
  });

  test('a long key costs what a long string costs', async () => {
    const key = 'k'.repeat(10_000);
    const leaf = `{ ${Array.from({ length: 10 }, (_, k) => `'${key}${k}': 1`).join(', ')} }`;
    const { manifest, runtime } = await readAndRun(namedOver(3, leaf));
    expect(Object.keys(at(runtime.components.C?.fields?.f, ['ai', 'k0', 'k0', 'k0']) as object)).toHaveLength(10);
    expect(manifest.unreadableReason).toMatch(/^the manifest would run to more than 32,000,000 bytes of JSON/);
  });

  // Counted without building the JSON, and counted exactly: the manifest the
  // limit lets through is exactly as long as the limit says.
  test('the limit is exact: a manifest of that many bytes is read whole, one byte more is refused', async () => {
    const source = (pad: number) => namedOver(4, `'${'x'.repeat(3_190)}'`, 'p'.repeat(pad));
    const base = JSON.stringify(readPuckConfig(await written(source(0)))).length;
    const pad = MAX_OUTPUT_BYTES - base;
    expect(pad).toBeGreaterThan(0);

    const { manifest, runtime } = await readAndRun(source(pad));
    expect(manifest.unreadable).toBeUndefined();
    expect(JSON.stringify(manifest).length).toBe(MAX_OUTPUT_BYTES);
    expect(manifest.components.C?.fields.f?.ai).toEqual(
      wire((runtime.components.C?.fields?.f as { ai?: unknown } | undefined)?.ai) as ManifestField['ai'],
    );

    const over = await readAndRun(source(pad + 1));
    expect(over.manifest.unreadableReason).toMatch(/^the manifest would run to more than 32,000,000 bytes of JSON/);
  }, 60_000);

  /** A throwaway config on disk, as reader options, removed once the block is done. */
  async function written(config: string): Promise<{ configPath: string }> {
    const root = mkdtempSync(join(tmpdir(), 'puck-config-size-'));
    writtenRoots.push(root);
    const configPath = join(root, 'puck.config.ts');
    writeFileSync(configPath, config);
    return { configPath };
  }
});

describe('a config ten times the size of a large real one', () => {
  // A hundred components of fifty five-option selects is a large real site;
  // the reader's limits are set so ten times that still reads whole.
  test('is read whole, every component as the module holds it', async () => {
    const options = Array.from({ length: 5 }, (_, o) => `{ label: 'Opt ${o}', value: 'v${o}' }`).join(', ');
    const fields = Array.from(
      { length: 50 },
      (_, i) => `f${i}: { type: 'select', label: 'Field ${i}', options: [${options}] }`,
    );
    const defaults = Array.from({ length: 50 }, (_, i) => `f${i}: 'v0'`);
    const components = Array.from(
      { length: 1_000 },
      (_, c) => `C${c}: { label: 'C${c}', fields: { ${fields.join(', ')} }, defaultProps: { ${defaults.join(', ')} } }`,
    );
    const { manifest, runtime } = await readAndRun(`export default { components: { ${components.join(',\n')} } };`);
    expect(manifest).toEqual({ components: wire(runtime.components) as PuckManifest['components'], unresolved: [] });
  }, 120_000);
});

describe('the default export, found where the runtime finds it', () => {
  const HERO = "{ components: { Hero: { fields: { title: { type: 'text' } } } } }";

  /** The manifest a module holding `config` as its default reads whole into. */
  function readWhole(loaded: { default?: unknown } | undefined): PuckManifest {
    return {
      components: wire(loadedConfig(loaded).components) as PuckManifest['components'],
      unresolved: [],
    };
  }

  test('a const exported under the name default is read', async () => {
    const { manifest, loaded } = await readAndTry({
      'puck.config.ts': `const config = ${HERO};\nexport { config as default };`,
    });
    expect(manifest).toEqual(readWhole(loaded));
  });

  test('a default re-exported from another module is read', async () => {
    const { manifest, loaded } = await readAndTry({
      'real.ts': `export default ${HERO};`,
      'puck.config.ts': "export { default } from './real';",
    });
    expect(manifest).toEqual(readWhole(loaded));
  });

  test('a named export re-exported as the default is read', async () => {
    const { manifest, loaded } = await readAndTry({
      'real.ts': `export const config = ${HERO};`,
      'puck.config.ts': "export { config as default } from './real';",
    });
    expect(manifest).toEqual(readWhole(loaded));
  });

  test('a class is admitted as a default export that is not an object written out', async () => {
    const { manifest, loaded } = await readAndTry({
      'puck.config.ts': `export default class { static components = ${HERO}.components; }`,
    });
    // A class with a static `components` does carry one at runtime.
    expect(typeof loaded?.default).toBe('function');
    expect(manifest).toEqual(
      refused(
        "the config's default export is a class, not an object written out in the source, so its components are unknown",
      ),
    );
  });

  test('a function is admitted as a default export that is not an object written out', async () => {
    const { manifest, loaded } = await readAndTry({
      'puck.config.ts': `export default function config() { return ${HERO}; }`,
    });
    expect(typeof loaded?.default).toBe('function');
    expect(manifest).toEqual(
      refused(
        "the config's default export is a function, not an object written out in the source, so its components are unknown",
      ),
    );
  });

  // Bun loads `export =` as the module's default; the reason says only what
  // this reader does with it.
  test('`export =` is admitted as a shape this reader does not read', async () => {
    const { manifest, loaded } = await readAndTry({ 'puck.config.ts': `export = ${HERO};` });
    expect(Object.keys(loadedConfig(loaded).components)).toEqual(['Hero']);
    expect(manifest).toEqual(
      refused(
        'the config file exports with `export =`, which this reader does not read as a default export, so its components are unknown',
      ),
    );
  });

  test('a config with two default exports does not load, and is refused rather than read as the first', async () => {
    const { manifest, failure } = await readAndTry({
      'puck.config.ts': `const config = ${HERO};\nexport { config as default };\nexport default { components: { Card: { fields: {} } } };`,
    });
    expect(failure).toBeDefined();
    expect(manifest).toEqual(
      refused(
        'the config file has 2 default exports, on lines 2 and 3, and a module with more than one fails to load, so its components are unknown',
      ),
    );
  });

  test('a module namespace exported as the default is refused for what it is, never called missing', async () => {
    const { manifest, loaded } = await readAndTry({
      'real.ts': "export const components = { Hero: { fields: { t: { type: 'text' } } } };",
      'puck.config.ts': "export * as default from './real';",
    });
    expect(Object.keys(loadedConfig(loaded).components)).toEqual(['Hero']);
    expect(manifest).toEqual(
      refused(
        "the config's default export is a module namespace, which this reader does not read, so its components are unknown",
      ),
    );
  });
});

describe('a file that does not parse', () => {
  test('a config with a syntax error is refused, naming the file and the line', async () => {
    const { manifest, failure } = await readAndTry({ 'puck.config.ts': 'export default {{{' });
    expect(failure).toBeDefined();
    expect(manifest).toEqual(
      refused(
        'the config file, puck.config.ts, has a syntax error at line 1 (Property assignment expected.), so it fails to load and its components are unknown',
      ),
    );
  });

  // The parser recovers a missing comma into both components; the runtime
  // loads neither.
  test('a config missing a comma is refused, never read as what the parser recovered', async () => {
    const { manifest, failure } = await readAndTry({
      'puck.config.ts':
        'export default {\n  components: {\n    Hero: { fields: {} }\n    Card: { fields: {} },\n  },\n};',
    });
    expect(failure).toBeDefined();
    expect(manifest).toEqual(
      refused(
        "the config file, puck.config.ts, has a syntax error at line 4 (',' expected.), so it fails to load and its components are unknown",
      ),
    );
  });

  // Importing the module fails, and takes the config down with it.
  test('a config whose component module does not parse is refused, naming the module and the line', async () => {
    const { manifest, failure } = await readAndTry({
      'components/Hero.ts': "export const Hero = {\n  fields: {}\n  label: 'Hero',\n};",
      'puck.config.ts':
        "import { Hero } from './components/Hero';\nexport default { components: { Hero, Card: { fields: {} } } };",
    });
    expect(failure).toBeDefined();
    expect(manifest).toEqual(
      refused(
        "a module the config loads, components/Hero.ts, has a syntax error at line 3 (',' expected.), so the config fails to load and its components are unknown",
      ),
    );
  });

  test('a barrel between the config and a component that does not parse refuses the config', async () => {
    const { manifest, failure } = await readAndTry({
      'Hero.ts': "export const Hero = { fields: { t: { type: 'text' } } };",
      'barrel.ts': "export { Hero } from './Hero';\nexport const broken = ;",
      'puck.config.ts': "import { Hero } from './barrel';\nexport default { components: { Hero } };",
    });
    expect(failure).toBeDefined();
    expect(manifest).toEqual(
      refused(
        'a module the config loads, barrel.ts, has a syntax error at line 2 (Expression expected.), so the config fails to load and its components are unknown',
      ),
    );
  });

  test('a module a wrapper-built component imports that does not parse refuses the config', async () => {
    const { manifest, failure } = await readAndTry({
      'wrap.ts': "export function withLayout(c) { return { ...c, label: 'L' }; }\nexport const oops = ;",
      'Grid.ts':
        "import { withLayout } from './wrap';\nconst Inner = { fields: { t: { type: 'text' } } };\nexport const Grid = withLayout(Inner);",
      'puck.config.ts': "import { Grid } from './Grid';\nexport default { components: { Grid } };",
    });
    expect(failure).toBeDefined();
    expect(manifest).toEqual(
      refused(
        'a module the config loads, wrap.ts, has a syntax error at line 2 (Expression expected.), so the config fails to load and its components are unknown',
      ),
    );
  });

  // A type error is the type checker's business: the module still loads.
  test('a module with a type error but no syntax error still reads', async () => {
    const { manifest, loaded } = await readAndTry({
      'Hero.ts': "const count: string = 1;\nexport const Hero = { fields: { t: { type: 'text' } } };",
      'puck.config.ts': "import { Hero } from './Hero';\nexport default { components: { Hero } };",
    });
    expect(Object.keys(loadedConfig(loaded).components)).toEqual(['Hero']);
    expect(manifest).toEqual({ components: { Hero: { fields: { t: { type: 'text' } } } }, unresolved: [] });
  });
});

describe('a components map this reader cannot read says why', () => {
  const BUILD = 'const build = () => ({ Card: { fields: {} } });';

  /** The component names a module that loaded holds. */
  function names(loaded: { default?: unknown } | undefined): string[] {
    return Object.keys(loadedConfig(loaded).components);
  }

  test('a map a call returns', async () => {
    const { manifest, loaded } = await readAndTry({
      'puck.config.ts': `${BUILD}\nexport default { components: build() };`,
    });
    expect(names(loaded)).toEqual(['Card']);
    expect(manifest).toEqual(
      refused(
        "the config's components map, build(), is a call's result, which this reader would have to run to know, so its components are unknown",
      ),
    );
  });

  test('a map spread from a call', async () => {
    const { manifest, loaded } = await readAndTry({
      'puck.config.ts': `${BUILD}\nexport default { components: { ...build() } };`,
    });
    expect(names(loaded)).toEqual(['Card']);
    expect(manifest).toEqual(
      refused(
        'the components map spreads build(), which this reader cannot follow to the keys it writes, so it may declare components not listed here',
      ),
    );
  });

  test('a config spread from a call, which may set the map', async () => {
    const { manifest, loaded } = await readAndTry({
      'puck.config.ts': 'const make = () => ({ components: { Card: { fields: {} } } });\nexport default { ...make() };',
    });
    expect(names(loaded)).toEqual(['Card']);
    // What the spread may write, it may write to categories and root as well.
    expect(manifest).toEqual({
      ...refused(
        'the config spreads make(), which this reader cannot follow to the keys it writes, and it may set the components map, so its components are unknown',
      ),
      categoriesUnreadable: true,
      root: { fields: {}, fieldsUnreadable: true },
    });
  });

  test('a map declared with let', async () => {
    const { manifest, loaded } = await readAndTry({
      'puck.config.ts': 'let components = { Card: { fields: {} } };\nexport default { components };',
    });
    expect(names(loaded)).toEqual(['Card']);
    expect(manifest).toEqual(
      refused(
        "the config's components map, components, is declared with let or var, and what it holds when Puck reads it may not be what is written there, so its components are unknown",
      ),
    );
  });

  test('a map imported from a module that is not there', async () => {
    const { manifest, failure } = await readAndTry({
      'puck.config.ts': "import { components } from './nope';\nexport default { components };",
    });
    expect(failure).toBeDefined();
    expect(manifest).toEqual(
      refused(
        "the config's components map, components, names nothing this reader can find — an import it cannot resolve, or a global, so its components are unknown",
      ),
    );
  });

  test('a map read in part names the write that may add more', async () => {
    const { manifest, loaded } = await readAndTry({
      'puck.config.ts': `${BUILD}\nexport default { components: { Hero: { fields: {} }, ...build() } };`,
    });
    expect(names(loaded)).toEqual(['Hero', 'Card']);
    expect(manifest).toEqual({
      components: {},
      unresolved: ['Hero'],
      unresolvedReasons: {
        Hero: 'a later entry of the components map — a spread or a computed name this reader cannot follow — may replace this component',
      },
      unreadable: true,
      unreadableReason:
        'the components map spreads build(), which this reader cannot follow to the keys it writes, so it may declare components not listed here',
    });
  });
});

describe('a reason quotes source on one line, cut on a whole character', () => {
  test('line breaks in the quoted source become single spaces', async () => {
    const { manifest, loaded } = await readAndTry({
      'puck.config.ts':
        'const defineConfig = (config) => config;\nexport default defineConfig(\n\n\n  { components: {} },\n);',
    });
    expect(loadedConfig(loaded).components).toEqual({});
    expect(manifest).toEqual(
      refused(
        "the config's default export, defineConfig( { components: {} }, ), is a call's result, which this reader would have to run to know, so its components are unknown",
      ),
    );
  });

  test('a long quote is cut between characters, never inside one, and marked', async () => {
    const { manifest, loaded } = await readAndTry({ 'puck.config.ts': `export default '${'😀'.repeat(70)}';` });
    expect(loaded?.default).toBe('😀'.repeat(70));
    expect(manifest).toEqual(
      refused(
        `the config's default export, '${'😀'.repeat(59)}…, is not an object written out in the source or a name this reader can follow to one, so its components are unknown`,
      ),
    );
  });
});
