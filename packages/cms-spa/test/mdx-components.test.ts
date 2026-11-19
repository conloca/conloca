import { beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { defineFragmentComponents, EMPTY_FRAGMENT_VOCABULARY } from '@conloca/mdx/render';
import type { MdxJsxFlowElement } from 'mdast-util-mdx-jsx';
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
  withOutlineId,
  writeAttribute,
} from '../src/mdx-components.js';
import { setSiteRender } from '../src/site-render.js';
import { readAttrs } from '../src/utils/mdast-tree.js';

const TextTable = () => null;

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

  test('a block type is a flow component with children', () => {
    expect(() => defineMdxComponents([minimal({ name: 'Eyebrow', hasChildren: true, blockType: true })])).not.toThrow();
    expect(() => defineMdxComponents([minimal({ name: 'Rule', hasChildren: false, blockType: true })])).toThrow(
      /blockType/,
    );
    expect(() => defineMdxComponents([minimal({ name: 'Icon', kind: 'text', blockType: true })])).toThrow(/blockType/);
  });
});

const attributesOf = (values: Record<string, string>) =>
  Object.entries(values).map(([name, value]) => ({ type: 'mdxJsxAttribute' as const, name, value }));

describe('withOutlineId', () => {
  const outline = { id: 'id', text: 'label' };

  test('makes the anchor from the text when there is none', () => {
    expect(withOutlineId(attributesOf({ label: 'Git history' }), outline, [])).toEqual(
      attributesOf({ label: 'Git history', id: 'git-history' }),
    );
  });

  test('never changes an existing anchor', () => {
    const kept = attributesOf({ id: 'real-page', label: 'Something else' });
    expect(withOutlineId(kept, outline, [])).toEqual(kept);
  });

  test('leaves an element without text alone, and never takes an anchor already in the document', () => {
    expect(withOutlineId([], outline, [])).toEqual([]);
    expect(withOutlineId(attributesOf({ label: 'Overview' }), outline, ['overview'])).toEqual(
      attributesOf({ label: 'Overview', id: 'overview-1' }),
    );
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
    const hostAuthored = [minimal({ name: 'Aside', hasChildren: false }), minimal({ name: 'Steps' })];
    const discovered = [minimal({ name: 'Aside', hasChildren: true })];

    const merged = mergeDiscoveredMdxComponents(hostAuthored, discovered);

    // Shadowed host entry is dropped, order puts the survivors first.
    expect(merged.map((descriptor) => descriptor.name)).toEqual(['Steps', 'Aside']);
    expect(merged.find((descriptor) => descriptor.name === 'Aside')).toMatchObject({ hasChildren: true });
  });

  test("the host's editor settings survive discovery of the same component", () => {
    const section = minimal({
      name: 'Section',
      hasChildren: true,
      insert: { label: 'Section', description: 'A titled part of the page' },
      props: [{ name: 'id', type: 'string', label: 'Anchor', hidden: true }],
    });
    const eyebrow = minimal({ name: 'Eyebrow', hasChildren: true, blockType: true, insert: { label: 'Eyebrow' } });
    const discovered = [
      minimal({
        name: 'Section',
        hasChildren: true,
        insert: { label: 'section' },
        props: [{ name: 'id', type: 'string' }],
      }),
      minimal({ name: 'Eyebrow', hasChildren: true }),
    ];

    const merged = mergeDiscoveredMdxComponents([section, eyebrow], discovered);

    expect(merged).toEqual([section, eyebrow]);
  });

  test('returns the host list untouched when nothing was discovered', () => {
    const hostAuthored = [minimal({ name: 'Steps' })];

    expect(mergeDiscoveredMdxComponents(hostAuthored, [])).toBe(hostAuthored);
  });

  test('keeps every discovered descriptor when the host authored none', () => {
    const discovered = [minimal({ name: 'Card' }), minimal({ name: 'Tabs' })];

    expect(mergeDiscoveredMdxComponents([], discovered).map((d) => d.name)).toEqual(['Card', 'Tabs']);
  });

  // A fragment vocabulary component's declared list must not be replaced by discovery's usage-inferred string.
  const hostTable = minimal({
    name: 'TextTable',
    props: [{ name: 'items', type: 'list', of: { type: 'object', fields: { title: { type: 'string' } } } }],
  });
  const discoveredTable = minimal({ name: 'TextTable', props: [{ name: 'items', type: 'string' }] });

  test('keeps the host descriptor for a name in hostWins', () => {
    expect(mergeDiscoveredMdxComponents([hostTable], [discoveredTable], new Set(['TextTable']))).toEqual([hostTable]);
  });

  // Without hostWins discovery wins, keeping the host's editor settings (props among them).
  test('lets discovery win without hostWins', () => {
    expect(mergeDiscoveredMdxComponents([hostTable], [discoveredTable])).toEqual([
      { ...discoveredTable, props: hostTable.props },
    ]);
  });

  describe('through the installers and the site render', () => {
    beforeEach(() => {
      setSiteRender({});
      installHostAuthoredMdxComponents([]);
      installDiscoveredMdxComponents([]);
    });

    test('re-merges when the vocabulary names the component, host installed first', () => {
      installHostAuthoredMdxComponents([hostTable]);
      installDiscoveredMdxComponents([discoveredTable]);
      setSiteRender({ vocabulary: defineFragmentComponents({ components: { TextTable } }) });
      expect(getMdxComponents()).toEqual([hostTable]);
    });

    test('re-merges when the vocabulary names the component, discovered installed first', () => {
      installDiscoveredMdxComponents([discoveredTable]);
      installHostAuthoredMdxComponents([hostTable]);
      setSiteRender({ vocabulary: defineFragmentComponents({ components: { TextTable } }) });
      expect(getMdxComponents()).toEqual([hostTable]);
    });

    test('discovery wins again once the vocabulary drops the component', () => {
      installHostAuthoredMdxComponents([hostTable]);
      installDiscoveredMdxComponents([discoveredTable]);
      setSiteRender({ vocabulary: defineFragmentComponents({ components: { TextTable } }) });
      setSiteRender({ vocabulary: EMPTY_FRAGMENT_VOCABULARY });
      expect(getMdxComponents()).toEqual([{ ...discoveredTable, props: hostTable.props }]);
    });
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
    installDiscoveredMdxComponents([minimal({ name: 'Aside', hasChildren: true })]);
    installHostAuthoredMdxComponents([minimal({ name: 'Aside', hasChildren: false })]);

    const [aside] = getMdxComponents();
    expect(getMdxComponents()).toHaveLength(1);
    expect(aside).toMatchObject({ hasChildren: true });
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

describe('list and object props', () => {
  test('writeAttribute writes lists and objects as JSON expressions that readAttrs reads back', () => {
    const values = [[], [{ label: 'A "quoted" one', n: 2 }], { href: '/x', nested: { on: true } }];
    for (const v of values) {
      const attrs = writeAttribute<MdxJsxFlowElement>([], 'p', v);
      expect(attrs).toEqual([
        {
          type: 'mdxJsxAttribute',
          name: 'p',
          value: { type: 'mdxJsxAttributeValueExpression', value: JSON.stringify(v) },
        },
      ]);
      const node: MdxJsxFlowElement = { type: 'mdxJsxFlowElement', name: 'X', attributes: attrs, children: [] };
      expect(readAttrs(node)).toEqual({ p: v });
    }
  });

  test('defineMdxComponents rejects a list prop without of', () => {
    const bad = minimal({ name: 'Card', props: [{ name: 'items', type: 'list', of: { type: 'string' } }] });
    // Untyped host config can omit `of`.
    Reflect.deleteProperty(bad.props?.[0] ?? {}, 'of');
    expect(() => defineMdxComponents([bad])).toThrow(/Card\.items/);
  });

  test('defineMdxComponents rejects an object prop without fields', () => {
    const missing = minimal({ name: 'Card', props: [{ name: 'cta', type: 'object', fields: {} }] });
    // Untyped host config can omit `fields`.
    Reflect.deleteProperty(missing.props?.[0] ?? {}, 'fields');
    expect(() => defineMdxComponents([missing])).toThrow(/Card\.cta/);
    const empty = minimal({ name: 'Card', props: [{ name: 'cta', type: 'object', fields: {} }] });
    expect(() => defineMdxComponents([empty])).toThrow(/Card\.cta/);
    const href = { type: 'string' } as const;
    // Untyped host config can name a field type that does not exist.
    Reflect.set(href, 'type', 'date');
    const unknownField = minimal({ name: 'Card', props: [{ name: 'cta', type: 'object', fields: { href } }] });
    expect(() => defineMdxComponents([unknownField])).toThrow(/Card\.cta\.href/);
  });

  test('defineMdxComponents warns on a prop name starting with "on" in any case', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      defineMdxComponents([
        minimal({
          name: 'Card',
          props: [
            { name: 'onSale', type: 'boolean' },
            { name: 'online', type: 'boolean' },
          ],
        }),
      ]);
      expect(warn).toHaveBeenCalledTimes(2);
      expect(String(warn.mock.calls[0]?.[0])).toContain('Card.onSale starts with "on" and is never passed');
      expect(String(warn.mock.calls[1]?.[0])).toContain('Card.online starts with "on" and is never passed');
    } finally {
      warn.mockRestore();
    }
  });

  test('defineMdxComponents rejects a default that contradicts its declared prop', () => {
    const bad = minimal({
      name: 'Card',
      props: [{ name: 'cta', type: 'object', fields: { href: { type: 'string' } } }],
      defaults: { attributes: { cta: { href: 3 } } },
    });
    expect(() => defineMdxComponents([bad])).toThrow(/Card\.cta\.href/);
    const notList = minimal({
      name: 'Card',
      props: [{ name: 'items', type: 'list', of: { type: 'string' } }],
      defaults: { attributes: { items: 'x' } },
    });
    expect(() => defineMdxComponents([notList])).toThrow(/Card\.items/);
  });

  test('defineMdxComponents warns, without throwing, on a scalar default of the wrong type', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    const input = [
      minimal({ name: 'Card', props: [{ name: 'title', type: 'string' }], defaults: { attributes: { title: 3 } } }),
    ];
    try {
      expect(defineMdxComponents(input)).toBe(input);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('Card.title default should be a string, got 3');
    } finally {
      warn.mockRestore();
    }
  });

  test('toJsxComponentDescriptor maps list and object props to expression', () => {
    const d = minimal({
      props: [
        { name: 'items', type: 'list', of: { type: 'object', fields: { label: { type: 'string' } } } },
        { name: 'cta', type: 'object', fields: { href: { type: 'string' } } },
      ],
    });
    expect(toJsxComponentDescriptor(d, () => null).props).toEqual([
      { name: 'items', type: 'expression', required: undefined },
      { name: 'cta', type: 'expression', required: undefined },
    ]);
  });
});
