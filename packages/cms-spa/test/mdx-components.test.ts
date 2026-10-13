import { beforeEach, describe, expect, test } from 'bun:test';
import {
  containsMarkdownMarkers,
  defineMdxComponents,
  getMdxComponents,
  installDiscoveredMdxComponents,
  installHostAuthoredMdxComponents,
  type MdxJsxComponentDescriptor,
  type MdxSnippetDescriptor,
  mergeDiscoveredMdxComponents,
  toJsxComponentDescriptor,
} from '../src/mdx-components.js';

// Smallest JSX descriptor that satisfies the type — `kind: 'flow'` is the
// default insert path, `name` is required, everything else stays optional.
const minimal = (over: Partial<MdxJsxComponentDescriptor> = {}): MdxJsxComponentDescriptor => ({
  name: 'Steps',
  kind: 'flow',
  ...over,
});

// Smallest snippet descriptor. `insert` and `content` are required because
// a snippet with no label or no content is nonsensical.
const snippetMinimal = (over: Partial<MdxSnippetDescriptor> = {}): MdxSnippetDescriptor => ({
  name: 'CalloutSnippet',
  kind: 'snippet',
  insert: { label: 'Callout' },
  content: '> A short, sharp takeaway.\n',
  ...over,
});

describe('defineMdxComponents', () => {
  test('returns the same array on valid input', () => {
    const input = [minimal({ name: 'Steps' }), minimal({ name: 'Tabs' })];
    const out = defineMdxComponents(input);
    expect(out).toBe(input);
  });

  test('throws on duplicate name', () => {
    expect(() => defineMdxComponents([minimal({ name: 'Steps' }), minimal({ name: 'Steps' })])).toThrow(
      /duplicate descriptor for 'Steps'/,
    );
  });

  test('throws on duplicate name with conflicting import.from', () => {
    expect(() =>
      defineMdxComponents([
        minimal({ name: 'Steps', import: { from: '@astrojs/starlight/components' } }),
        minimal({ name: 'Steps', import: { from: '@somewhere/else' } }),
      ]),
    ).toThrow(/conflicting import.from/);
  });

  test("throws on kind: 'text' with hasChildren: true", () => {
    expect(() => defineMdxComponents([minimal({ name: 'Icon', kind: 'text', hasChildren: true })])).toThrow(
      /kind: 'text' with hasChildren: true/,
    );
  });

  test("permits kind: 'text' without hasChildren", () => {
    expect(() => defineMdxComponents([minimal({ name: 'Icon', kind: 'text', hasChildren: false })])).not.toThrow();
    expect(() => defineMdxComponents([minimal({ name: 'Icon', kind: 'text' })])).not.toThrow();
  });

  test('accepts snippet descriptors alongside JSX descriptors', () => {
    const input = [minimal({ name: 'Steps' }), snippetMinimal({ name: 'ProofPoints' })];
    expect(() => defineMdxComponents(input)).not.toThrow();
  });

  test('throws when a snippet collides with a JSX component name', () => {
    // Cross-kind collision is intentional: both surface in the insert menu
    // under the same label, so allowing them would produce silent shadowing.
    expect(() => defineMdxComponents([minimal({ name: 'Aside' }), snippetMinimal({ name: 'Aside' })])).toThrow(
      /duplicate descriptor for 'Aside'/,
    );
  });

  test('throws on snippet with empty content', () => {
    expect(() => defineMdxComponents([snippetMinimal({ content: '' })])).toThrow(/empty content/);
  });
});

/**
 * Guards the conservative marker detection used by both the inline-prop
 * wiring (GenericBlock) and the side-panel hint (JsxPropsPanel). The
 * goal is "true on values whose formatting plaintext editing would
 * silently strip"; false-positive cost is just "edit via panel" (fine),
 * false-negative cost is silent formatting loss (not fine).
 */
describe('containsMarkdownMarkers', () => {
  test('detects bold markers', () => {
    expect(containsMarkdownMarkers('see **note** here')).toBe(true);
  });
  test('detects inline code backticks', () => {
    expect(containsMarkdownMarkers('use the `cli` command')).toBe(true);
  });
  test('detects link syntax', () => {
    expect(containsMarkdownMarkers('check the [docs](/docs)')).toBe(true);
  });
  test('false on plain text', () => {
    expect(containsMarkdownMarkers('Setting up your project')).toBe(false);
  });
  test('false on filenames with underscores (no false positive on __)', () => {
    // __init__.py would false-positive if we matched bare `__`.
    expect(containsMarkdownMarkers('edit __init__.py')).toBe(false);
  });
  test('false on prose with single asterisk', () => {
    // Single `*` appears in math, footnote markers, plain prose.
    expect(containsMarkdownMarkers('see footnote *')).toBe(false);
  });
  test('false on empty string', () => {
    expect(containsMarkdownMarkers('')).toBe(false);
  });
});

/**
 * Guards the single merge rule every caller shares: the dev SPA merges
 * the `/api/registry` response over the schemas-module exports, and a
 * host app merges the same two lists from what it supplies. Discovered
 * entries must win a name collision in both.
 */
describe('mergeDiscoveredMdxComponents', () => {
  test('auto-discovered descriptors win on a name collision', () => {
    const hostAuthored = [minimal({ name: 'Aside', insert: { label: 'Host Aside' } }), minimal({ name: 'Steps' })];
    const discovered = [minimal({ name: 'Aside', insert: { label: 'Discovered Aside' } })];

    const merged = mergeDiscoveredMdxComponents(hostAuthored, discovered);

    // Shadowed host entry is dropped, order puts the survivors first.
    expect(merged.map((descriptor) => descriptor.name)).toEqual(['Steps', 'Aside']);
    expect(merged.find((descriptor) => descriptor.name === 'Aside')?.insert?.label).toBe('Discovered Aside');
  });

  test('returns the host list untouched when nothing was discovered', () => {
    const hostAuthored = [minimal({ name: 'Steps' })];

    expect(mergeDiscoveredMdxComponents(hostAuthored, [])).toBe(hostAuthored);
  });

  test('keeps every discovered descriptor when the host authored none', () => {
    const discovered = [minimal({ name: 'Card' }), minimal({ name: 'Tabs' })];

    expect(mergeDiscoveredMdxComponents([], discovered).map((d) => d.name)).toEqual(['Card', 'Tabs']);
  });
});

/**
 * Guards the dev boot race: the schemas virtual module and the
 * `/api/registry` fetch are unordered, and a plain `setMdxComponents`
 * from whichever settles LAST used to overwrite the other's entries.
 * The slotted installers must converge on the same merged registry
 * regardless of settle order.
 */
describe('slotted mdx component installs', () => {
  beforeEach(() => {
    installHostAuthoredMdxComponents([]);
    installDiscoveredMdxComponents([]);
  });

  test('a late host-authored install keeps earlier discovered components', () => {
    installDiscoveredMdxComponents([minimal({ name: 'Card' })]);
    installHostAuthoredMdxComponents([minimal({ name: 'Steps' })]);

    expect(getMdxComponents().map((d) => d.name)).toEqual(['Steps', 'Card']);
  });

  test('a host re-install replaces only the host slot', () => {
    installHostAuthoredMdxComponents([minimal({ name: 'Old' })]);
    installDiscoveredMdxComponents([minimal({ name: 'Card' })]);
    installHostAuthoredMdxComponents([minimal({ name: 'New' })]);

    expect(getMdxComponents().map((d) => d.name)).toEqual(['New', 'Card']);
  });

  test('discovered still wins a name collision through the slots', () => {
    installDiscoveredMdxComponents([minimal({ name: 'Aside', insert: { label: 'Discovered' } })]);
    installHostAuthoredMdxComponents([minimal({ name: 'Aside', insert: { label: 'Host' } })]);

    const [aside] = getMdxComponents();
    expect(getMdxComponents()).toHaveLength(1);
    expect(aside.insert?.label).toBe('Discovered');
  });
});

/**
 * The fallback editor arrives as an argument: importing the editor's
 * fallback block here would close an import cycle back into this module.
 * A descriptor's own editor still takes precedence.
 */
describe('toJsxComponentDescriptor', () => {
  const FallbackEditor = () => null;

  test('uses the injected fallback editor when the descriptor brings none', () => {
    expect(toJsxComponentDescriptor(minimal(), FallbackEditor).Editor).toBe(FallbackEditor);
  });

  test("keeps the descriptor's own editor over the fallback", () => {
    const OwnEditor = () => null;

    expect(toJsxComponentDescriptor(minimal({ Editor: OwnEditor }), FallbackEditor).Editor).toBe(OwnEditor);
  });
});
