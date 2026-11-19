import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FragmentManifestProp } from '@conloca/content-api/component-vocabulary';
import { defineFragmentComponents } from '@conloca/mdx/render';
import { checkFragmentComponents } from '../src/build/check-fragment-components.js';
import { fragmentManifestOf, readFragmentManifest } from '../src/build/fragment-manifest.js';
import { withHydration } from '../src/lib/withHydration.js';

const Callout = () => null;
const TextTable = () => null;
const Eyebrow = () => null;
const Disclosure = withHydration(() => null, 'visible');
const vocabulary = defineFragmentComponents({
  components: { Callout, Disclosure, TextTable },
  elements: { h2: Eyebrow },
  outline: { Callout: { id: 'id', text: 'label' } },
});

const calloutDescriptor = {
  name: 'Callout',
  kind: 'flow',
  hasChildren: true,
  insert: { label: 'Callout', description: 'A note' },
  Editor: () => null,
  props: [
    {
      name: 'tone',
      type: 'string',
      label: 'Tone',
      required: true,
      defaultValue: 'info',
      options: [
        { value: 'info', label: 'Info' },
        { value: 'warn', label: 'Warn' },
      ],
    },
    { name: 'items', type: 'list', required: false, of: { type: 'object', fields: { n: { type: 'number' } } } },
  ],
};

describe('fragmentManifestOf', () => {
  test('lists every vocabulary component with its hydration and outline, and the element overrides', () => {
    expect(fragmentManifestOf({ vocabulary, mdxComponents: undefined, discovered: [] })).toEqual({
      manifest: {
        components: {
          Callout: { outline: { id: 'id', text: 'label' } },
          Disclosure: { hydrate: 'visible' },
          TextTable: {},
        },
        elements: ['h2'],
      },
      warnings: [],
    });
  });

  test('copies a vocabulary component descriptor and lists no other descriptor', () => {
    const snippet = { name: 'Snip', kind: 'snippet', insert: { label: 'Snip' }, content: 'x' };
    const other = { name: 'Other', kind: 'flow' };
    expect(
      fragmentManifestOf({ vocabulary, mdxComponents: [snippet, calloutDescriptor, other], discovered: [] }),
    ).toEqual({
      manifest: {
        components: {
          Callout: {
            outline: { id: 'id', text: 'label' },
            kind: 'flow',
            label: 'Callout',
            description: 'A note',
            children: true,
            props: {
              tone: {
                type: 'string',
                label: 'Tone',
                required: true,
                default: 'info',
                options: [
                  { value: 'info', label: 'Info' },
                  { value: 'warn', label: 'Warn' },
                ],
              },
              items: { type: 'list', of: { type: 'object', fields: { n: { type: 'number' } } } },
            },
          },
          Disclosure: { hydrate: 'visible' },
          TextTable: {},
        },
        elements: ['h2'],
      },
      warnings: [],
    });
  });

  test("keeps the host's declared list over discovery's inferred string", () => {
    const items: FragmentManifestProp = { type: 'list', of: { type: 'object', fields: { title: { type: 'string' } } } };
    const host = { name: 'TextTable', kind: 'flow', props: [{ name: 'items', ...items }] };
    const discovered = { name: 'TextTable', kind: 'flow', props: [{ name: 'items', type: 'string' }] };
    const { manifest } = fragmentManifestOf({ vocabulary, mdxComponents: [host], discovered: [discovered] });
    expect(manifest.components.TextTable).toEqual({ kind: 'flow', props: { items } });
  });

  test('takes props from discovery alone', () => {
    const discovered = { name: 'Callout', kind: 'flow', props: [{ name: 'tone', type: 'string' }] };
    const { manifest } = fragmentManifestOf({ vocabulary, mdxComponents: [], discovered: [discovered] });
    expect(manifest.components.Callout).toEqual({
      outline: { id: 'id', text: 'label' },
      kind: 'flow',
      props: { tone: { type: 'string' } },
    });
  });

  test('lets a host snippet of a vocabulary name win over a discovered JSX component, as the editor does', () => {
    const snippet = { name: 'TextTable', kind: 'snippet', insert: { label: 'Table' }, content: 'x' };
    const discovered = { name: 'TextTable', kind: 'flow', props: [{ name: 'items', type: 'string' }] };
    const { manifest } = fragmentManifestOf({ vocabulary, mdxComponents: [snippet], discovered: [discovered] });
    expect(manifest.components.TextTable).toEqual({});
  });

  test('leaves out a prop it cannot describe, with a warning', () => {
    const host = { name: 'TextTable', kind: 'text', props: [{ name: 'when', type: 'date' }] };
    expect(fragmentManifestOf({ vocabulary, mdxComponents: [host], discovered: [] })).toEqual({
      manifest: {
        components: {
          Callout: { outline: { id: 'id', text: 'label' } },
          Disclosure: { hydrate: 'visible' },
          TextTable: { kind: 'text', props: {} },
        },
        elements: ['h2'],
      },
      warnings: [
        'fragment component TextTable: prop when has a type the component manifest cannot describe, so agent writes do not check it',
      ],
    });
  });
});

declare global {
  // The render fixture counts its loads here.
  var fragmentManifestLoads: number | undefined;
}

describe('readFragmentManifest', () => {
  let root: string;
  // Each test gets its own root, so the per-process load memo never hands one test another's module.
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'conloca-fragment-manifest-'));
    // A plain vocabulary object: a module under tmpdir cannot resolve workspace packages.
    await writeFile(
      join(root, 'render.mjs'),
      [
        'globalThis.fragmentManifestLoads = (globalThis.fragmentManifestLoads ?? 0) + 1;',
        'const Callout = () => null;',
        'export const fragmentComponents = { components: { Callout }, elements: {} };',
      ].join('\n'),
    );
    await writeFile(join(root, 'broken.mjs'), "throw new Error('cannot load here');\n");
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  const read = (
    fragmentComponentsPath: string | undefined,
    schemas: Parameters<typeof readFragmentManifest>[0]['schemas'],
  ) => readFragmentManifest({ root, vite: {}, fragmentComponentsPath, schemas, discovered: [] });

  test('lists nothing for a site without fragment components', async () => {
    expect(await read(undefined, undefined)).toEqual({ manifest: { components: {}, elements: [] }, warnings: [] });
  });

  test('builds the manifest from the render module and the schemas descriptors', async () => {
    expect(await read('render.mjs', { mdxComponents: [{ name: 'Callout', kind: 'text' }] })).toEqual({
      manifest: { components: { Callout: { kind: 'text', props: {} } }, elements: [] },
      warnings: [],
    });
  });

  test('marks the manifest unreadable when the render module fails to load', async () => {
    const { manifest } = await read('broken.mjs', undefined);
    expect(manifest).toEqual({
      components: {},
      elements: [],
      unreadable: true,
      unreadableReason: expect.stringContaining('cannot load here'),
    });
    expect(manifest.unreadableReason).toContain('broken.mjs');
  });

  test('marks the manifest unreadable when the schemas module failed to load', async () => {
    expect(await read('render.mjs', { error: 'boom' })).toEqual({
      manifest: {
        components: {},
        elements: [],
        unreadable: true,
        unreadableReason: 'the schemas module failed to load: boom',
      },
      warnings: [],
    });
  });

  test('loads the render module once per root and path', async () => {
    const before = globalThis.fragmentManifestLoads ?? 0;
    await read('render.mjs', undefined);
    await read('render.mjs', undefined);
    expect((globalThis.fragmentManifestLoads ?? 0) - before).toBe(1);
  });

  test('shares one load with the build check whatever the root spelling', async () => {
    const contentRoot = join(root, 'content');
    await mkdir(contentRoot);
    await writeFile(
      join(contentRoot, 'sites.json'),
      JSON.stringify({ sites: { main: { locales: ['en'], defaultLocale: 'en' } }, globalLocales: ['en'] }),
    );
    const before = globalThis.fragmentManifestLoads ?? 0;
    await checkFragmentComponents({
      contentRoot,
      root,
      vite: {},
      fragmentComponentsPath: 'render.mjs',
      logger: { warn: () => {} },
    });
    await readFragmentManifest({
      root: `${root}/`,
      vite: {},
      fragmentComponentsPath: 'render.mjs',
      schemas: undefined,
      discovered: [],
    });
    expect((globalThis.fragmentManifestLoads ?? 0) - before).toBe(1);
  });
});
