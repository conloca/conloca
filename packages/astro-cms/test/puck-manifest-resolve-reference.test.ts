import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Project, SyntaxKind } from 'ts-morph';
import { createScanProject } from '../src/discovery/extract-props-ts.js';
import { MAX_WORK, spendWork, WorkBudgetExceeded, withReadingSession } from '../src/puck-manifest/literal.js';
import {
  lookUpKey,
  resolveCallExpression,
  resolveLiteralValue,
  resolveObjectLiteral,
} from '../src/puck-manifest/resolve-reference.js';

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

/** The `Hero` of `components: { Hero }` — the reference every real config writes. */
function shorthandName(project: Project, path: string) {
  return project
    .getSourceFileOrThrow(path)
    .getDescendantsOfKind(SyntaxKind.ShorthandPropertyAssignment)[0]
    .getNameNode();
}

/** The expression `export const use = …` is written as — what a caller hands the resolvers below. */
function useInitializer(project: Project, path: string) {
  return project.getSourceFileOrThrow(path).getVariableDeclarationOrThrow('use').getInitializerOrThrow();
}

describe('resolveObjectLiteral', () => {
  test('resolves an identifier declared in the same file', () => {
    withProject(
      { 'config.ts': "const Hero = { label: 'Hero' };\nexport default { components: { Hero } };" },
      (project, root) => {
        expect(resolveObjectLiteral(shorthandName(project, join(root, 'config.ts')))?.getText()).toContain(
          "label: 'Hero'",
        );
      },
    );
  });

  test('follows an import to the declaring file', () => {
    withProject(
      {
        'Hero.ts': "export const Hero = { label: 'Hero', fields: {} };",
        'config.ts': "import { Hero } from './Hero';\nexport default { components: { Hero } };",
      },
      (project, root) => {
        expect(resolveObjectLiteral(shorthandName(project, join(root, 'config.ts')))?.getText()).toContain(
          "label: 'Hero'",
        );
      },
    );
  });

  test('follows a barrel re-export — the shape every real config uses', () => {
    withProject(
      {
        'sections/Hero.ts': "export const Hero = { label: 'Hero Section', fields: {} };",
        'sections/index.ts': "export { Hero } from './Hero';",
        'config.ts': "import { Hero } from './sections';\nexport default { components: { Hero } };",
      },
      (project, root) => {
        expect(resolveObjectLiteral(shorthandName(project, join(root, 'config.ts')))?.getText()).toContain(
          "label: 'Hero Section'",
        );
      },
    );
  });

  test('returns undefined for a reference it cannot follow', () => {
    withProject(
      {
        'config.ts': "import { Hero } from 'some-unresolvable-package';\nexport default { components: { Hero } };",
      },
      (project, root) => {
        expect(resolveObjectLiteral(shorthandName(project, join(root, 'config.ts')))).toBeUndefined();
      },
    );
  });

  test('takes an object literal it is handed directly, not only a name for one', () => {
    withProject({ 'config.ts': "const Hero = { label: 'In place' };" }, (project, root) => {
      const literal = project
        .getSourceFileOrThrow(join(root, 'config.ts'))
        .getVariableDeclarationOrThrow('Hero')
        .getInitializerOrThrow();
      expect(resolveObjectLiteral(literal)?.getText()).toContain("label: 'In place'");
    });
  });

  // The remaining cases copy shapes that real site configs write, the example
  // site's among them (example/website-with-cms/src/puck.config.tsx). If any of
  // them regress, the reader returns component names with no fields for every
  // config written that way.
  test('reads a typed const in a .tsx file behind a directory barrel', () => {
    withProject(
      {
        'components/puck/primitives/Badge.tsx':
          "import type { ComponentConfig } from '@puckeditor/core';\n" +
          'export type BadgeProps = { label: string };\n' +
          "export const Badge: ComponentConfig<BadgeProps> = { fields: { label: { type: 'text' } } };\n",
        'components/puck/primitives/index.ts':
          "export type { BadgeProps } from './Badge';\nexport { Badge } from './Badge';\n",
        'puck.config.tsx':
          "import { Badge } from './components/puck/primitives';\nexport default { components: { Badge } };\n",
      },
      (project, root) => {
        expect(resolveObjectLiteral(shorthandName(project, join(root, 'puck.config.tsx')))?.getText()).toContain(
          "type: 'text'",
        );
      },
    );
  });

  test('reads a config whose own type annotation contextually types the component list', () => {
    withProject(
      {
        'Hero.ts': "export const Hero = { label: 'Annotated', fields: {} };",
        'config.ts':
          "import { Hero } from './Hero';\n" +
          'type Config<C extends Record<string, object>> = { components: { [K in keyof C]: C[K] } };\n' +
          'export const config: Config<{ Hero: typeof Hero }> = { components: { Hero } };\n',
      },
      (project, root) => {
        expect(resolveObjectLiteral(shorthandName(project, join(root, 'config.ts')))?.getText()).toContain(
          "label: 'Annotated'",
        );
      },
    );
  });

  test('follows a star re-export', () => {
    withProject(
      {
        'shared/Hero.ts': "export const Hero = { label: 'Starred' };",
        'shared/index.ts': "export * from './Hero';",
        'config.ts': "import { Hero } from './shared';\nexport default { components: { Hero } };",
      },
      (project, root) => {
        expect(resolveObjectLiteral(shorthandName(project, join(root, 'config.ts')))?.getText()).toContain(
          "label: 'Starred'",
        );
      },
    );
  });

  test('follows a barrel that re-exports another barrel', () => {
    withProject(
      {
        'components/sections/Hero.ts': "export const Hero = { label: 'Two hops' };",
        'components/sections/index.ts': "export { Hero } from './Hero';",
        'components/index.ts': "export { Hero } from './sections';",
        'config.ts': "import { Hero } from './components';\nexport default { components: { Hero } };",
      },
      (project, root) => {
        expect(resolveObjectLiteral(shorthandName(project, join(root, 'config.ts')))?.getText()).toContain(
          "label: 'Two hops'",
        );
      },
    );
  });

  test('follows a name renamed on the way out of a barrel', () => {
    withProject(
      {
        'Hero.ts': "export const Hero = { label: 'Renamed' };",
        'index.ts': "export { Hero as Card } from './Hero';",
        'config.ts': "import { Card } from './index';\nexport default { components: { Card } };",
      },
      (project, root) => {
        expect(resolveObjectLiteral(shorthandName(project, join(root, 'config.ts')))?.getText()).toContain(
          "label: 'Renamed'",
        );
      },
    );
  });

  test('follows a name renamed on the way in', () => {
    withProject(
      {
        'Hero.ts': "export const Hero = { label: 'Aliased' };",
        'config.ts': "import { Hero as HeroSection } from './Hero';\nexport default { components: { HeroSection } };",
      },
      (project, root) => {
        expect(resolveObjectLiteral(shorthandName(project, join(root, 'config.ts')))?.getText()).toContain(
          "label: 'Aliased'",
        );
      },
    );
  });

  test('follows a component reached through a namespace import', () => {
    withProject(
      {
        'sections/Hero.ts': "export const Hero = { label: 'Namespaced' };",
        'sections/index.ts': "export { Hero } from './Hero';",
        'config.ts': "import * as sections from './sections';\nexport default { components: { Hero: sections.Hero } };",
      },
      (project, root) => {
        const access = project
          .getSourceFileOrThrow(join(root, 'config.ts'))
          .getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)[0];
        expect(resolveObjectLiteral(access)?.getText()).toContain("label: 'Namespaced'");
      },
    );
  });

  test('follows a component exported as a module default', () => {
    withProject(
      {
        'Hero.ts': "export default { label: 'Defaulted', fields: {} };",
        'config.ts': "import Hero from './Hero';\nexport default { components: { Hero } };",
      },
      (project, root) => {
        expect(resolveObjectLiteral(shorthandName(project, join(root, 'config.ts')))?.getText()).toContain(
          "label: 'Defaulted'",
        );
      },
    );
  });

  test('follows a const that merely renames another one', () => {
    withProject(
      {
        'Hero.ts': "const HeroBase = { label: 'Base', fields: {} };\nexport const Hero = HeroBase;",
        'config.ts': "import { Hero } from './Hero';\nexport default { components: { Hero } };",
      },
      (project, root) => {
        expect(resolveObjectLiteral(shorthandName(project, join(root, 'config.ts')))?.getText()).toContain(
          "label: 'Base'",
        );
      },
    );
  });

  // A `let` holds whatever was last assigned to it, and the assignment is code
  // this reader never sees. Reading its initializer would describe the config
  // as it was written rather than as Puck receives it.
  test('refuses a binding that can be reassigned after it is written', () => {
    withProject(
      {
        'Hero.ts': "export let Hero = { label: 'Reassignable' };\nif (flag) Hero = { label: 'Other' };",
        'config.ts': "import { Hero } from './Hero';\nexport default { components: { Hero } };",
      },
      (project, root) => {
        expect(resolveObjectLiteral(shorthandName(project, join(root, 'config.ts')))).toBeUndefined();
      },
    );
  });

  test('resolves the source of a spread that overrides a component', () => {
    withProject(
      {
        'Flex.ts': "export const Flex = { label: 'Flex', fields: { gap: { type: 'number' } } };",
        'config.ts':
          "import { Flex } from './Flex';\n" +
          "export default { components: { Flex: { ...Flex, label: 'Flex Container' } } };",
      },
      (project, root) => {
        const spread = project
          .getSourceFileOrThrow(join(root, 'config.ts'))
          .getDescendantsOfKind(SyntaxKind.SpreadAssignment)[0];
        expect(resolveObjectLiteral(spread.getExpression())?.getText()).toContain("type: 'number'");
      },
    );
  });

  test('sees through a satisfies wrapper on the declaration', () => {
    withProject(
      {
        'Hero.ts': "export const Hero = { label: 'Wrapped' } satisfies Record<string, string>;",
        'config.ts': "import { Hero } from './Hero';\nexport default { components: { Hero } };",
      },
      (project, root) => {
        expect(resolveObjectLiteral(shorthandName(project, join(root, 'config.ts')))?.getText()).toContain(
          "label: 'Wrapped'",
        );
      },
    );
  });

  // Both real configs wrap some components in a `withLayout(Inner)` HOC that
  // adds a field of its own. What that name stands for is the call's result,
  // not the literal handed to it, so it resolves to nothing and the caller
  // reports the component as unresolved — an honest gap rather than a field
  // list missing whatever the wrapper contributes.
  test('returns undefined for a component a wrapper builds rather than one written down', () => {
    withProject(
      {
        'Hero.ts':
          "const HeroInner = { fields: { title: { type: 'text' } } };\nexport const Hero = withLayout(HeroInner);",
        'config.ts': "import { Hero } from './Hero';\nexport default { components: { Hero } };",
      },
      (project, root) => {
        expect(resolveObjectLiteral(shorthandName(project, join(root, 'config.ts')))).toBeUndefined();
      },
    );
  });

  // `literal.ts` treats `satisfies` / `as` / parentheses as noise around a
  // value everywhere else, and a name wearing one is still that name. Taking
  // the symbol off the raw node instead sees a wrapper expression, which has
  // none, and the component reads as unresolved for punctuation.
  test('sees through a type wrapper around the reference itself, not only around the declaration', () => {
    withProject(
      {
        'config.ts': "const Base = { label: 'Behind satisfies' };\nexport const use = (Base satisfies unknown);\n",
      },
      (project, root) => {
        expect(resolveObjectLiteral(useInitializer(project, join(root, 'config.ts')))?.getText()).toContain(
          "label: 'Behind satisfies'",
        );
      },
    );
  });

  test('gives up on a re-export that circles back on itself', () => {
    withProject(
      {
        'a.ts': "export { Hero } from './b';",
        'b.ts': "export { Hero } from './a';",
        'config.ts': "import { Hero } from './a';\nexport default { components: { Hero } };",
      },
      (project, root) => {
        expect(resolveObjectLiteral(shorthandName(project, join(root, 'config.ts')))).toBeUndefined();
      },
    );
  });
});

describe('resolveLiteralValue', () => {
  test('follows a const identifier to its array value — the options: sizeOptions shape', () => {
    withProject(
      {
        'config.ts':
          "const sizeOptions = [{ label: 'Small', value: 's' }, { label: 'Large', value: 'l' }];\n" +
          'export const use = sizeOptions;\n',
      },
      (project, root) => {
        expect(resolveLiteralValue(useInitializer(project, join(root, 'config.ts')))).toEqual([
          { label: 'Small', value: 's' },
          { label: 'Large', value: 'l' },
        ]);
      },
    );
  });

  test('follows an import to the declaring file', () => {
    withProject(
      {
        'values.ts': 'export const spacing = [0, 4, 8];\n',
        'config.ts': "import { spacing } from './values';\nexport const use = spacing;\n",
      },
      (project, root) => {
        expect(resolveLiteralValue(useInitializer(project, join(root, 'config.ts')))).toEqual([0, 4, 8]);
      },
    );
  });

  test('a let-declared value is refused — it can be reassigned after the declaration', () => {
    withProject({ 'config.ts': "let options = ['a'];\nexport const use = options;\n" }, (project, root) => {
      expect(resolveLiteralValue(useInitializer(project, join(root, 'config.ts')))).toBeUndefined();
    });
  });

  test('a computed value reads as absent, never as a guess', () => {
    withProject({ 'config.ts': 'const options = buildOptions();\nexport const use = options;\n' }, (project, root) => {
      expect(resolveLiteralValue(useInitializer(project, join(root, 'config.ts')))).toBeUndefined();
    });
  });

  test('a direct literal still reads without any following', () => {
    withProject({ 'config.ts': 'export const use = [1, 2];\n' }, (project, root) => {
      expect(resolveLiteralValue(useInitializer(project, join(root, 'config.ts')))).toEqual([1, 2]);
    });
  });

  // How the page-schemas config writes its option lists: the `as const` is what
  // gives the values their literal types, and a reader blind to it loses the
  // whole list.
  test('reads a list declared as const', () => {
    withProject(
      {
        'config.ts':
          "const TEMPLATE_OPTIONS = [{ label: 'Blank', value: 'blank' }] as const;\n" +
          'export const use = TEMPLATE_OPTIONS;\n',
      },
      (project, root) => {
        expect(resolveLiteralValue(useInitializer(project, join(root, 'config.ts')))).toEqual([
          { label: 'Blank', value: 'blank' },
        ]);
      },
    );
  });

  test('follows a module default to the value it exports', () => {
    withProject(
      {
        'values.ts': "export default ['a', 'b'];\n",
        'config.ts': "import values from './values';\nexport const use = values;\n",
      },
      (project, root) => {
        expect(resolveLiteralValue(useInitializer(project, join(root, 'config.ts')))).toEqual(['a', 'b']);
      },
    );
  });

  test('follows a shorthand entry to the const it names', () => {
    withProject({ 'config.ts': 'const gap = [0, 4];\nexport default { fields: { gap } };\n' }, (project, root) => {
      expect(resolveLiteralValue(shorthandName(project, join(root, 'config.ts')))).toEqual([0, 4]);
    });
  });
});

// A member access `x.y` is read by finding the object `x` stands for and looking
// `y` up in it — never by asking the checker what `y` is. The checker answers
// with the declaration of the TYPE, which is another object's source whenever
// the type was borrowed: `typeof Base`, `Partial<typeof DEFAULTS>`.
describe('member access', () => {
  /** The expression `export const <name> = …` is written as. */
  function initializer(project: Project, path: string, name: string) {
    return project.getSourceFileOrThrow(path).getVariableDeclarationOrThrow(name).getInitializerOrThrow();
  }

  /** The expression a function's single `return` hands back. */
  function returned(project: Project, path: string, name: string) {
    return project
      .getSourceFileOrThrow(path)
      .getFunctionOrThrow(name)
      .getFirstDescendantByKindOrThrow(SyntaxKind.ReturnStatement)
      .getExpressionOrThrow();
  }

  test('reads the object the name holds, not the one its type was borrowed from', () => {
    withProject(
      {
        'config.ts': [
          "const label = 'Base';",
          'const max = 10;',
          'const Base = { label, max };',
          "const Other: typeof Base = { label: 'Other', max: 2 };",
          'export const useLabel = Other.label;',
          'export const useMax = Other.max;',
        ].join('\n'),
      },
      (project, root) => {
        const path = join(root, 'config.ts');
        expect(resolveLiteralValue(initializer(project, path, 'useLabel'))).toBe('Other');
        expect(resolveLiteralValue(initializer(project, path, 'useMax'))).toBe(2);
      },
    );
  });

  test('a parameter typed after a const is never read as that const', () => {
    withProject(
      {
        'config.ts': [
          "const label = 'Default';",
          'const items = { a: { type: "text" } };',
          'const DEFAULTS = { label, items };',
          'export function direct(o: typeof DEFAULTS) { return o.label; }',
          'export function optional(o?: typeof DEFAULTS) { return o?.label; }',
          'export function partial(o: Partial<typeof DEFAULTS>) { return o.label; }',
          'export function nested(o: typeof DEFAULTS) { return o.items; }',
        ].join('\n'),
      },
      (project, root) => {
        const path = join(root, 'config.ts');
        expect(resolveLiteralValue(returned(project, path, 'direct'))).toBeUndefined();
        expect(resolveLiteralValue(returned(project, path, 'optional'))).toBeUndefined();
        expect(resolveLiteralValue(returned(project, path, 'partial'))).toBeUndefined();
        expect(resolveObjectLiteral(returned(project, path, 'nested'))).toBeUndefined();
      },
    );
  });

  test('reads a key the object writes out in place', () => {
    withProject(
      {
        'config.ts': [
          "const LABELS = { hero: 'Hero', sizes: ['s', 'l'] };",
          "const NESTED = { fields: { title: { type: 'text' } } };",
          'export const useLabel = LABELS.hero;',
          "export const useQuoted = LABELS['sizes'];",
          'export const useFields = NESTED.fields;',
        ].join('\n'),
      },
      (project, root) => {
        const path = join(root, 'config.ts');
        expect(resolveLiteralValue(initializer(project, path, 'useLabel'))).toBe('Hero');
        expect(resolveLiteralValue(initializer(project, path, 'useQuoted'))).toEqual(['s', 'l']);
        expect(resolveObjectLiteral(initializer(project, path, 'useFields'))?.getText()).toContain('title');
      },
    );
  });

  test('the last write of the key wins, spreads included', () => {
    withProject(
      {
        'config.ts': [
          "const A = { label: 'A' };",
          "const After = { ...A, label: 'After' };",
          "const Before = { label: 'Before', ...A };",
          "const Untouched = { label: 'Untouched', ...{ other: 1 } };",
          'export const useAfter = After.label;',
          'export const useBefore = Before.label;',
          'export const useUntouched = Untouched.label;',
        ].join('\n'),
      },
      (project, root) => {
        const path = join(root, 'config.ts');
        expect(resolveLiteralValue(initializer(project, path, 'useAfter'))).toBe('After');
        expect(resolveLiteralValue(initializer(project, path, 'useBefore'))).toBe('A');
        expect(resolveLiteralValue(initializer(project, path, 'useUntouched'))).toBe('Untouched');
      },
    );
  });

  test('a later write this reader cannot see through makes the key unknown', () => {
    withProject(
      {
        'config.ts': [
          "const Spread = { label: 'Spread', ...make() };",
          "const Computed = { label: 'Computed', [pick()]: 'x' };",
          "const Getter = { label: 'Getter', get label() { return 'x'; } };",
          "const Inherited = { __proto__: { label: 'Proto' } };",
          'export const useSpread = Spread.label;',
          'export const useComputed = Computed.label;',
          'export const useGetter = Getter.label;',
          'export const useInherited = Inherited.label;',
        ].join('\n'),
      },
      (project, root) => {
        const path = join(root, 'config.ts');
        for (const name of ['useSpread', 'useComputed', 'useGetter', 'useInherited']) {
          expect(resolveLiteralValue(initializer(project, path, name))).toBeUndefined();
        }
      },
    );
  });

  test('a key reached through a const computed name reads like a written one', () => {
    withProject(
      {
        'config.ts': [
          "const K = 'label';",
          "const Keyed = { [K]: 'Keyed' };",
          'export const use = Keyed.label;',
          'export const useIndexed = Keyed[K];',
        ].join('\n'),
      },
      (project, root) => {
        const path = join(root, 'config.ts');
        expect(resolveLiteralValue(initializer(project, path, 'use'))).toBe('Keyed');
        expect(resolveLiteralValue(initializer(project, path, 'useIndexed'))).toBe('Keyed');
      },
    );
  });
});

describe('resolveCallExpression', () => {
  test('takes a call written in place', () => {
    withProject({ 'config.ts': 'export const use = withLayout(Inner);\n' }, (project, root) => {
      expect(resolveCallExpression(useInitializer(project, join(root, 'config.ts')))?.getText()).toBe(
        'withLayout(Inner)',
      );
    });
  });

  test('follows a name to the call it stands for, across files', () => {
    withProject(
      {
        'Grid.ts': 'const GridInternal = { fields: {} };\nexport const Grid = withLayout(GridInternal);\n',
        'config.ts': "import { Grid } from './Grid';\nexport const use = Grid;\n",
      },
      (project, root) => {
        expect(resolveCallExpression(useInitializer(project, join(root, 'config.ts')))?.getText()).toBe(
          'withLayout(GridInternal)',
        );
      },
    );
  });

  test('a const that names something other than a call reads as absent', () => {
    withProject({ 'config.ts': "const label = 'plain';\nexport const use = label;\n" }, (project, root) => {
      expect(resolveCallExpression(useInitializer(project, join(root, 'config.ts')))).toBeUndefined();
    });
  });

  // The same rule the object and value paths keep: a reassignable binding
  // describes the call at the line it was written, not the one the name carries
  // when Puck reads it.
  test('a call held in a let is refused', () => {
    withProject({ 'config.ts': 'let Grid = withLayout(Inner);\nexport const use = Grid;\n' }, (project, root) => {
      expect(resolveCallExpression(useInitializer(project, join(root, 'config.ts')))).toBeUndefined();
    });
  });
});

describe('member lookup work budget', () => {
  test('charges each visited member even when the requested key is absent', () => {
    withProject({ 'config.ts': 'export const use = { a: 1, b: 2, c: 3 };' }, (project, root) => {
      const literal = useInitializer(project, join(root, 'config.ts')).asKindOrThrow(
        SyntaxKind.ObjectLiteralExpression,
      );
      expect(() =>
        withReadingSession(() => {
          for (let i = 0; i < MAX_WORK - 1; i++) spendWork();
          lookUpKey(literal, 'missing');
        }),
      ).toThrow(WorkBudgetExceeded);
    });
  });
});
