import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverMdxComponents, toPortableImports } from '../src/discovery/discover.js';
import type { DiscoveredComponent } from '../src/discovery/merge-registry.js';
import { createRegistryEndpoint } from '../src/discovery/registry-endpoint.js';

/**
 * Dependency-free component fixture: no imports at all, so ts-morph parses it
 * without resolving anything from a temp dir that has no node_modules.
 */
const ASIDE_TSX = [
  'interface Props {',
  '  title: string;',
  "  type?: 'note' | 'tip';",
  '}',
  '',
  'export default function Aside(props: Props) {',
  '  return props.title;',
  '}',
  '',
].join('\n');

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), 'conloca-discover-'));
  await mkdir(join(projectRoot, 'src/components/mdx'), { recursive: true });
  await mkdir(join(projectRoot, 'content'), { recursive: true });
  await writeFile(join(projectRoot, 'src/components/mdx/Aside.tsx'), ASIDE_TSX);
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe('discoverMdxComponents', () => {
  it('scans the configured component folders with no dev server in sight', async () => {
    const components = await discoverMdxComponents({
      contentRoot: 'content',
      componentFolders: ['src/components/mdx'],
      projectRoot,
    });

    const aside = components.find((component) => component.name === 'Aside');
    expect(aside).toBeDefined();
    expect(aside?.props?.find((prop) => prop.name === 'title')?.required).toBe(true);
    // `options` only exists on the string variant of `MdxComponentProp`,
    // so narrow on `type === 'string'` before reading it.
    const typeProp = aside?.props?.find((prop) => prop.name === 'type');
    expect(typeProp?.type === 'string' ? typeProp.options : undefined).toEqual([
      { value: 'note', label: 'note' },
      { value: 'tip', label: 'tip' },
    ]);
  });
});

describe('createRegistryEndpoint', () => {
  it('serves the same scan the build-time caller runs', async () => {
    const registry = createRegistryEndpoint({
      contentRoot: 'content',
      componentFolders: ['src/components/mdx'],
      projectRoot,
    });

    const sources = [...(await registry.getAllowedSources())];
    expect(sources.some((source) => source.endsWith('/src/components/mdx/Aside.tsx'))).toBe(true);
  });
});

describe('toPortableImports', () => {
  const local: DiscoveredComponent[] = [
    { name: 'Aside', kind: 'flow', import: { from: '/build/acme/src/components/mdx/Aside.tsx' } },
  ];

  it('rewrites an absolute local-component path to a project-relative specifier', () => {
    // The scanning machine's absolute path would be SAVED with the site's MDX
    // and break the next build elsewhere.
    const [component] = toPortableImports(local, '/build/acme');

    expect(component.import?.from).toBe('/src/components/mdx/Aside.tsx');
  });

  it('preserves the default-export flag while rewriting', () => {
    const withDefault: DiscoveredComponent[] = [
      { name: 'Aside', kind: 'flow', import: { from: '/build/acme/src/mdx/Aside.tsx', default: true } },
    ];

    const [component] = toPortableImports(withDefault, '/build/acme');

    expect(component.import).toEqual({ from: '/src/mdx/Aside.tsx', default: true });
  });

  it('leaves npm specifiers untouched', () => {
    const external: DiscoveredComponent[] = [
      { name: 'Aside', kind: 'flow', import: { from: '@astrojs/starlight/components' } },
    ];

    expect(toPortableImports(external, '/build/acme')[0].import?.from).toBe('@astrojs/starlight/components');
  });

  it('leaves a path outside the project alone rather than emitting ../ escapes', () => {
    const outside: DiscoveredComponent[] = [{ name: 'Aside', kind: 'flow', import: { from: '/elsewhere/Aside.tsx' } }];

    expect(toPortableImports(outside, '/build/acme')[0].import?.from).toBe('/elsewhere/Aside.tsx');
  });

  it('rewrites a directory literally named ..foo — it is inside the project, not an escape', () => {
    const dotDotDir: DiscoveredComponent[] = [
      { name: 'Aside', kind: 'flow', import: { from: '/build/acme/..foo/Aside.tsx' } },
    ];

    expect(toPortableImports(dotDotDir, '/build/acme')[0].import?.from).toBe('/..foo/Aside.tsx');
  });

  it('passes a component with no import field through unchanged', () => {
    const noImport: DiscoveredComponent[] = [{ name: 'Aside', kind: 'flow' }];

    const [component] = toPortableImports(noImport, '/build/acme');

    expect(component).toEqual({ name: 'Aside', kind: 'flow' });
    expect(component.import).toBeUndefined();
  });

  it('rewrites alias keys — absolute MDX paths of the scanning machine — like import paths', () => {
    // Aliases are keyed by the MDX file USING the component, so even an npm
    // component (bare import specifier) carries machine-absolute keys.
    const aliased: DiscoveredComponent[] = [
      {
        name: 'Aside',
        kind: 'flow',
        import: { from: '@astrojs/starlight/components' },
        aliases: { '/build/acme/content/docs/intro.mdx': 'Callout' },
      },
    ];

    const [component] = toPortableImports(aliased, '/build/acme');

    expect(component.aliases).toEqual({ '/content/docs/intro.mdx': 'Callout' });
    expect(component.import?.from).toBe('@astrojs/starlight/components');
  });

  it('leaves non-absolute and outside-project alias keys alone', () => {
    const aliased: DiscoveredComponent[] = [
      {
        name: 'Aside',
        kind: 'flow',
        aliases: { 'content/docs/intro.mdx': 'Callout', '/elsewhere/intro.mdx': 'Note' },
      },
    ];

    const [component] = toPortableImports(aliased, '/build/acme');

    expect(component.aliases).toEqual({ 'content/docs/intro.mdx': 'Callout', '/elsewhere/intro.mdx': 'Note' });
  });

  it('does not mutate the input descriptors', () => {
    toPortableImports(local, '/build/acme');

    // The dev endpoint keeps handing these same objects to ssrLoadModule,
    // so the rewrite must copy, never patch in place.
    expect(local[0].import?.from).toBe('/build/acme/src/components/mdx/Aside.tsx');
  });
});
