import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readPuckConfig } from '../src/puck-manifest/read-config.js';

/**
 * The fixture suites prove the shapes the reader was designed around. This one
 * reads the Puck config of the example site that ships beside this package, so
 * a change to the reader is measured against code that was written without it
 * in mind.
 *
 * Every number and name below was measured, not predicted. Nothing here may be
 * relaxed to make a run pass: if the reader stops resolving a component, the
 * regression is the reader's, and if it starts resolving one of the names
 * listed as unresolved, that is a deliberate capability change and the list is
 * updated in the same commit that adds it.
 *
 * What the example does not write has no real witness here and stays covered
 * by fixtures alone: a `root` field set, an `ai` annotation, a field built by
 * calling a helper, a slot rule written on the field, `resolvePermissions`, a
 * default computed in part, a custom field with no schema. A site elsewhere in
 * a workspace can hold the reader to its own config through the same public
 * `readPuckConfig`.
 */

// packages/astro-cms/test -> packages/astro-cms -> packages -> repo root. Holds
// in any checkout, including the nested worktrees under .claude/worktrees.
const REPO_ROOT = join(import.meta.dir, '..', '..', '..');

/**
 * `readPuckConfig` answers a missing config with an empty manifest rather than
 * throwing, so a config that moved would read as "every component vanished" —
 * a page of confusing failures in place of one clear sentence. This is that
 * sentence, and it is said before any assertion runs.
 */
function requireConfig(...segments: string[]): string {
  const path = join(REPO_ROOT, ...segments);
  if (!existsSync(path))
    throw new Error(`Puck config not found at ${path}; this suite must be pointed at its new home`);
  return path;
}

/**
 * Read once for the file. Each test below asks a different question of the same
 * manifest, and re-reading the config per test would prove only that the reader
 * is deterministic.
 */
const EXAMPLE = readPuckConfig({
  configPath: requireConfig('example', 'website-with-cms', 'src', 'puck.config.tsx'),
});

/**
 * The example's primitives are built by `withLayout(Inner)` — a function call.
 * The reader reads that call on paper, merging the argument's written-down
 * literal with the wrapper's own additions, so every component in the config
 * reads whole and the list has no entry.
 *
 * A name reappearing here is a wrapper-shape regression rather than a list to
 * edit: something in the config now breaks one of the rules in
 * `read-wrapper.ts` — one statement, one return of an object literal, every
 * parameter bound by an argument. Read those, and the reason the manifest
 * records beside the name, before touching this.
 */
const EXAMPLE_UNRESOLVED: string[] = [];

/**
 * The 17 vertical-padding choices the example's `layoutField` declares, every
 * 8px from 0 to 128, written out as the wrapper's own field would be.
 */
const PADDING_OPTIONS = Array.from({ length: 17 }, (_entry, index) => ({
  label: `${index * 8}px`,
  value: `${index * 8}px`,
}));

describe('readPuckConfig on the website-with-cms example config', () => {
  test('reads the components whose definitions can be followed', () => {
    // All 9, five of them wrapper-built. A floor, not a ceiling.
    expect(Object.keys(EXAMPLE.components).length).toBeGreaterThanOrEqual(9);
    expect(EXAMPLE.unreadable).toBeUndefined();
  });

  test('names exactly the components it cannot follow', () => {
    // None. Card, Flex, Grid, Heading and Text are shorthand entries pointing
    // at `export const X = withLayout(XInner)`, which the wrapper reader
    // follows. A reason appearing beside a name is the alarm.
    expect([...EXAMPLE.unresolved].sort()).toEqual(EXAMPLE_UNRESOLVED);
    expect(EXAMPLE.unresolvedReasons ?? {}).toEqual({});
  });

  test('gives every resolved component a field set', () => {
    for (const [name, component] of Object.entries(EXAMPLE.components)) {
      expect(`${name}: ${typeof component.fields}`).toBe(`${name}: object`);
      expect(Array.isArray(component.fields)).toBe(false);
    }
  });

  test('reads a resolved component down to its field types', () => {
    const button = EXAMPLE.components.Button;
    expect(button?.label).toBe('Button');
    // The whole field set, with the type of each: a component read down to
    // what an agent would have to write to use it.
    expect(button?.fields).toEqual({
      label: { type: 'text' },
      href: { type: 'text' },
      variant: {
        type: 'radio',
        options: [
          { label: 'primary', value: 'primary' },
          { label: 'secondary', value: 'secondary' },
        ],
      },
    });
  });

  test('reads a wrapper-built component down to the whole object', () => {
    // Card.tsx writes `export const Card = withLayout(CardInner)`, so this is
    // the merge of CardInner's own literal with what this site's `withLayout`
    // adds: the layout field, the layout defaults under the component's own,
    // and the `resolveFields` marker. Whole-object equality, because the point
    // of reading the wrapper is that nothing is left half-described.
    expect(EXAMPLE.components.Card).toEqual({
      fields: {
        title: { type: 'text' },
        description: { type: 'textarea' },
        icon: {
          type: 'select',
          options: [
            { label: 'None', value: '' },
            { label: 'Feather', value: 'Feather' },
            { label: 'Pen Tool', value: 'pen-tool' },
            { label: 'Git Merge', value: 'git-merge' },
            { label: 'GitHub', value: 'github' },
            { label: 'Align Left', value: 'align-left' },
            { label: 'Plug', value: 'plug' },
          ],
        },
        mode: {
          type: 'radio',
          options: [
            { label: 'card', value: 'card' },
            { label: 'flat', value: 'flat' },
          ],
        },
        layout: {
          type: 'object',
          objectFields: {
            spanCol: { type: 'number', label: 'Grid Columns', min: 1, max: 12 },
            spanRow: { type: 'number', label: 'Grid Rows', min: 1, max: 12 },
            grow: {
              type: 'radio',
              label: 'Flex Grow',
              // The example writes real booleans here, and they stay
              // booleans rather than the strings 'true' and 'false'.
              options: [
                { label: 'true', value: true },
                { label: 'false', value: false },
              ],
            },
            padding: { type: 'select', label: 'Vertical Padding', options: PADDING_OPTIONS },
          },
        },
      },
      defaultProps: {
        title: 'Title',
        description: 'Description',
        icon: 'Feather',
        mode: 'card',
        layout: { spanCol: 1, spanRow: 1, padding: '0px', grow: false },
      },
      dynamicFields: true,
    });
  });

  test('carries choices handed over by name', () => {
    // Space writes `options: spacingOptions`, a const declared above it in the
    // same module. The list is real source, not a computed one, so a reader that
    // stopped at the name would report Space as taking any string at all. Whole
    // field equality: every 8px from 8 to 160, as Space.tsx declares them.
    expect(EXAMPLE.components.Space?.fields.size).toEqual({
      type: 'select',
      options: Array.from({ length: 20 }, (_entry, index) => ({
        label: `${(index + 1) * 8}px`,
        value: `${(index + 1) * 8}px`,
      })),
    });
    // Heading names `sizeOptions` and `levelOptions` the same way, and it is
    // withLayout-built — so these arrive through both readers at once: the
    // wrapper call is read on paper, and the field lists it carries are named
    // rather than written down. Heading.tsx declares exactly these.
    expect(EXAMPLE.components.Heading?.fields.size).toEqual({
      type: 'select',
      options: [
        { label: 'XXXL', value: 'xxxl' },
        { label: 'XXL', value: 'xxl' },
        { label: 'XL', value: 'xl' },
        { label: 'L', value: 'l' },
        { label: 'M', value: 'm' },
        { label: 'S', value: 's' },
        { label: 'XS', value: 'xs' },
      ],
    });
    expect(EXAMPLE.components.Heading?.fields.level).toEqual({
      type: 'select',
      options: [
        { label: '1', value: '1' },
        { label: '2', value: '2' },
        { label: '3', value: '3' },
        { label: '4', value: '4' },
        { label: '5', value: '5' },
        { label: '6', value: '6' },
      ],
    });
  });

  test('admits the nesting rules its slots keep in the render', () => {
    // Grid and Flex write `<Items disallow={['Hero', 'Stats']} />` inside
    // `render` rather than on the field, which is the form Puck's own demo
    // uses and the one that binds the canvas. Read from source there is no
    // list to recover, so the slot says its rules are unknown rather than
    // reading as a slot anything may go into.
    expect(EXAMPLE.components.Grid?.fields.items).toEqual({ type: 'slot', unreadable: true });
    expect(EXAMPLE.components.Flex?.fields.items).toEqual({ type: 'slot', unreadable: true });
  });

  test('admits nothing: every label, default and annotation reads whole', () => {
    // Card's whole-object equality above already carries no admission; this
    // holds the other eight to the same, and pins the absent page field set.
    const admitted = Object.entries(EXAMPLE.components)
      .filter(([, component]) => component.unreadableKeys || component.fieldsUnreadable)
      .map(([name]) => name);
    expect(admitted).toEqual([]);
    expect(EXAMPLE.root).toBeUndefined();
    expect(EXAMPLE.categoriesUnreadable).toBeUndefined();
    expect(Object.keys(EXAMPLE.categories ?? {})).toEqual(['layout', 'typography', 'interactive', 'other']);
  });
});
