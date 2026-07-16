import { describe, expect, test } from 'bun:test';
import { extractAstroFrontmatter } from '../src/discovery/astro-frontmatter.js';
import { createScanProject, extractPropsViaTs } from '../src/discovery/extract-props-ts.js';

/**
 * Phase 3 probe tests for the ts-morph-based prop extractor.
 *
 * The motivating case is Starlight's Aside:
 *   const asideVariants = ['note', 'tip', 'caution', 'danger'] as const;
 *   interface Props {
 *     type?: (typeof asideVariants)[number];
 *     title?: string;
 *   }
 *
 * The regex scanner sees `(typeof asideVariants)[number]` as an
 * opaque expression and emits `type: 'expression'` with no options.
 * The ts-morph scanner resolves the indexed-access type via the
 * compiler's type checker and yields the four literal values.
 */
describe('extractPropsViaTs', () => {
  test('resolves (typeof X)[number] to literal-union options — the Aside case', () => {
    const source = `
      const asideVariants = ['note', 'tip', 'caution', 'danger'] as const;
      interface Props {
        type?: (typeof asideVariants)[number];
        title?: string;
      }
    `;
    const project = createScanProject();
    const props = extractPropsViaTs(project, '/virtual/Aside.ts', source, 'Aside');

    const type = props.find((p) => p.name === 'type');
    expect(type).toBeDefined();
    expect(type?.type).toBe('string');
    expect(type?.required).toBe(false);
    expect(type?.options).toEqual(['note', 'tip', 'caution', 'danger']);

    const title = props.find((p) => p.name === 'title');
    expect(title).toBeDefined();
    expect(title?.type).toBe('string');
    expect(title?.options).toBeUndefined();
  });

  test('plain literal union still resolves to options', () => {
    const source = `
      interface Props {
        size: 'sm' | 'md' | 'lg';
      }
    `;
    const project = createScanProject();
    const props = extractPropsViaTs(project, '/virtual/A.ts', source, 'A');
    expect(props[0]?.options).toEqual(['sm', 'md', 'lg']);
    expect(props[0]?.required).toBe(true);
  });

  test('mixed literal + string union — TS collapses it to plain string', () => {
    // The compiler treats `'a' | 'b' | string` as equivalent to `string`
    // because `string` is a supertype of every string literal. The literal
    // members don't survive into the resolved type — this is canonical TS
    // behavior, not a scanner limitation. Editors' "literal completion"
    // suggestions come from a different code path (the language service's
    // literal completion provider), not the type checker.
    // So we assert what the checker actually gives us: a plain string
    // type with no options. Authors who want literal suggestions for a
    // free-form string prop should opt in via sidecar cmsConfig.options.
    const source = `
      interface Props {
        variant: 'primary' | 'secondary' | string;
      }
    `;
    const project = createScanProject();
    const props = extractPropsViaTs(project, '/virtual/B.ts', source, 'B');
    expect(props[0]?.type).toBe('string');
    expect(props[0]?.options).toBeUndefined();
  });

  test('primitive props map to the right ParsedProp types', () => {
    const source = `
      interface Props {
        name: string;
        count?: number;
        disabled?: boolean;
      }
    `;
    const project = createScanProject();
    const props = extractPropsViaTs(project, '/virtual/C.ts', source, 'C');
    expect(props.find((p) => p.name === 'name')).toMatchObject({ type: 'string', required: true });
    expect(props.find((p) => p.name === 'count')).toMatchObject({ type: 'number', required: false });
    expect(props.find((p) => p.name === 'disabled')).toMatchObject({ type: 'boolean', required: false });
  });

  test('returns [] when no Props declaration exists', () => {
    const project = createScanProject();
    const props = extractPropsViaTs(project, '/virtual/Empty.ts', 'export const x = 1;', 'Empty');
    expect(props).toEqual([]);
  });

  test('prefers `${ComponentName}Props` over bare `Props`', () => {
    const source = `
      interface Props { wrong: string; }
      interface CardProps { right: string; }
    `;
    const project = createScanProject();
    const props = extractPropsViaTs(project, '/virtual/Card.ts', source, 'Card');
    expect(props.map((p) => p.name)).toEqual(['right']);
  });

  test('reads type-alias Props (not just interface)', () => {
    const source = `
      type Props = {
        label: string;
        kind: 'a' | 'b';
      };
    `;
    const project = createScanProject();
    const props = extractPropsViaTs(project, '/virtual/D.ts', source, 'D');
    expect(props.find((p) => p.name === 'label')?.type).toBe('string');
    expect(props.find((p) => p.name === 'kind')?.options).toEqual(['a', 'b']);
  });

  test('boolean prop under strict-mode tsconfig (true | false | undefined expansion)', () => {
    // The website's tsconfig extends astro/tsconfigs/strict. Under
    // strictNullChecks, the checker canonicalises `boolean?` into
    // `true | false | undefined` — `Type.isBoolean()` returns false
    // for the expanded form. This test guards the union-of-boolean-
    // literals detection that lets us still classify it correctly.
    const source = `
      interface Props {
        stagger?: boolean;
      }
    `;
    const project = createScanProject('/Users/niko/Developer/Glider/conloca-public/targets/website/tsconfig.json');
    const props = extractPropsViaTs(project, '/virtual/CardGrid.ts', source, 'CardGrid');
    expect(props[0]?.type).toBe('boolean');
    expect(props[0]?.required).toBe(false);
  });

  test('non-primitive types fall back to expression', () => {
    const source = `
      interface Props {
        onClick: () => void;
        items: string[];
        config: { x: number };
      }
    `;
    const project = createScanProject();
    const props = extractPropsViaTs(project, '/virtual/E.ts', source, 'E');
    for (const p of props) expect(p.type).toBe('expression');
  });
});

describe('extractAstroFrontmatter', () => {
  test('returns the inner text of the leading --- fence', () => {
    const content = '---\nconst x = 1;\nexport interface Props { y: string; }\n---\n<div>{x}</div>';
    expect(extractAstroFrontmatter(content)).toBe('const x = 1;\nexport interface Props { y: string; }');
  });

  test('returns null when no frontmatter is present', () => {
    expect(extractAstroFrontmatter('<div>hello</div>')).toBeNull();
  });

  test('does not match a fence in the middle of the file', () => {
    expect(extractAstroFrontmatter('<div>---\nfake\n---</div>')).toBeNull();
  });

  test('handles CRLF line endings', () => {
    const content = '---\r\nconst x = 1;\r\n---\r\n<div />';
    expect(extractAstroFrontmatter(content)).toBe('const x = 1;');
  });
});

describe('extractPropsViaTs end-to-end with .astro frontmatter', () => {
  test('Aside-shaped .astro frontmatter resolves the indexed-access union', () => {
    const astroSource = `---
const asideVariants = ['note', 'tip', 'caution', 'danger'] as const;
interface Props {
  type?: (typeof asideVariants)[number];
  title?: string;
  icon?: string;
}
---
<aside>
  <slot />
</aside>`;
    const frontmatter = extractAstroFrontmatter(astroSource);
    expect(frontmatter).not.toBeNull();
    const project = createScanProject();
    const props = extractPropsViaTs(project, '/virtual/Aside.virtual.ts', frontmatter!, 'Aside');
    expect(props.find((p) => p.name === 'type')?.options).toEqual(['note', 'tip', 'caution', 'danger']);
  });
});
