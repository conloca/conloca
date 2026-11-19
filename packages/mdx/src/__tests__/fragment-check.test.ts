import { describe, expect, test } from 'bun:test';
import type { RootContent } from 'mdast';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { jsonAttributeValue } from '../mdx/literal-attributes.js';
import {
  checkFragmentMdx,
  defineFragmentComponents,
  evaluateMDXToComponent,
  type FragmentPropSpec,
  fragmentPropSpec,
  mdxCarriesNoCode,
  parseFragmentMdx,
} from '../render.js';

const names = new Set(['Callout', 'Links']);
const specs = {
  Callout: { tone: { type: 'string', options: ['info', 'warn'], required: true }, count: { type: 'number' } },
  Links: {
    open: { type: 'boolean' },
    items: { type: 'list', of: { type: 'object', fields: { href: { type: 'string', required: true } } } },
    meta: { type: 'object', fields: {} },
  },
} satisfies Record<string, Record<string, FragmentPropSpec>>;
const check = (mdx: string) => checkFragmentMdx(mdx, names, specs);

describe('checkFragmentMdx without a vocabulary', () => {
  test('skips only the unknown-component check', () => {
    expect(checkFragmentMdx('<Nope />\n', undefined, {})).toBeUndefined();
    expect(checkFragmentMdx("import x from 'y'\n", undefined, {})).toEqual(
      checkFragmentMdx("import x from 'y'\n", names, {}),
    );
    expect(checkFragmentMdx("import x from 'y'\n", undefined, {})?.line).toBe(1);
    expect(checkFragmentMdx('<Callout tone="loud" />\n', undefined, specs)).toEqual({
      message: 'Callout prop "tone" must be one of info, warn (line 1).',
      line: 1,
    });
    expect(checkFragmentMdx('<Callout onClick="x" />\n', undefined, {})?.message).toContain(
      'would not be published: names starting with "on"',
    );
  });
});

describe('fragmentPropSpec', () => {
  test('maps descriptor fields to prop specs', () => {
    expect(
      fragmentPropSpec({
        type: 'list',
        required: true,
        of: {
          type: 'object',
          fields: { tone: { type: 'string', options: [{ value: 'a' }] }, n: { type: 'number' } },
        },
      }),
    ).toEqual({
      type: 'list',
      required: true,
      of: { type: 'object', fields: { tone: { type: 'string', options: ['a'] }, n: { type: 'number' } } },
    });
  });
});

describe('checkFragmentMdx', () => {
  test('a parse failure is refused with the parser message', () => {
    let parserMessage = '';
    try {
      parseFragmentMdx('<Callout>\n');
    } catch (error) {
      parserMessage = error instanceof Error ? error.message : String(error);
    }
    expect(parserMessage).not.toBe('');
    expect(check('<Callout>\n')).toEqual({ message: `The fragment could not be read: ${parserMessage}.` });
  });

  test('an import line is refused with its line', () => {
    expect(check('# Hi\n\nimport X from "./x"\n')).toEqual({
      message:
        "Fragments can't contain import or export lines (line 3). Remove them: the site's components need no import.",
      line: 3,
    });
  });

  test('{1+1} is refused', () => {
    expect(check('Hi\n\n{1+1}\n')).toEqual({ message: "Fragments can't contain {…} expressions (line 3).", line: 3 });
  });

  test('an inline expression is refused', () => {
    expect(check('Hi {x} there\n')).toEqual({ message: "Fragments can't contain {…} expressions (line 1).", line: 1 });
  });

  test('a {/* comment */} passes, as on publish', () => {
    expect(check('{/* x */}\n\nHi')).toBeUndefined();
  });

  test('unknown components are each listed once with the vocabulary', () => {
    expect(check('Hi\n\n<Nope />\n\n<Nope />\n\n<Other />\n')).toEqual({
      message:
        "Fragments can't use <Nope>, <Other> (line 3). Components this site offers in fragments: Callout, Links.",
      line: 3,
    });
  });

  test('with the empty vocabulary the site offers no components', () => {
    expect(checkFragmentMdx('<Callout tone="info" />\n', new Set(), {})).toEqual({
      message: "Fragments can't use <Callout> (line 1). This site offers no components in fragments.",
      line: 1,
    });
  });

  test('a string outside its options is refused', () => {
    expect(check('<Callout tone="loud" />\n')).toEqual({
      message: 'Callout prop "tone" must be one of info, warn (line 1).',
      line: 1,
    });
  });

  test('a number, boolean, list and object are checked', () => {
    expect(check('<Callout tone="info" count="3" />')?.message).toBe('Callout prop "count" must be a number (line 1).');
    expect(check('<Links open="yes" />')?.message).toBe('Links prop "open" must be true or false (line 1).');
    expect(check('<Links items={{"a":1}} />')?.message).toBe('Links prop "items" must be a list (line 1).');
    expect(check('<Links meta={[1]} />')?.message).toBe('Links prop "meta" must be an object (line 1).');
  });

  test('nested paths name the item', () => {
    expect(check('<Links items={[{"href":"/a"},{"href":3}]} />')?.message).toBe(
      'Links prop "items[1].href" must be text (line 1).',
    );
    expect(check('<Links items={[{"href":"/a"},{}]} />')?.message).toBe('Links needs prop "items[1].href" (line 1).');
  });

  test('a missing required prop is refused', () => {
    expect(check('Hi\n\n<Callout />\n')).toEqual({ message: 'Callout needs prop "tone" (line 3).', line: 3 });
  });

  test('a prop written as code is refused: publish would drop it', () => {
    expect(checkFragmentMdx('<T items={[{ label: A }]} />\n', new Set(['T']), {})).toEqual({
      message: 'T prop "items" is code, not data, and would not be published (line 1).',
      line: 1,
    });
  });

  test('a list prop in the object-literal form prettier writes passes and publishes', async () => {
    const mdx = `<Links
  open
  items={[
    {
      href: '/a', // first
    },
    { "href": "/b" },
  ]}
  meta={{}}
/>
`;
    expect(check(mdx)).toBeUndefined();
    const vocabulary = defineFragmentComponents({
      components: {
        Links: ({ items }: { items: { href: string }[] }) =>
          createElement('ul', null, ...items.map(({ href }) => createElement('li', { key: href }, href))),
      },
    });
    const { Component, error } = await evaluateMDXToComponent(mdx, vocabulary);
    expect(error).toBeUndefined();
    if (!Component) throw new Error('no Component');
    expect(renderToStaticMarkup(createElement(Component))).toBe('<ul><li>/a</li><li>/b</li></ul>');
  });

  test('reads props as publish does: a dropped __proto__ attribute does not satisfy a required prop', () => {
    const protoSpec: Record<string, FragmentPropSpec> = {};
    Object.defineProperty(protoSpec, '__proto__', {
      value: { type: 'object', fields: {}, required: true },
      enumerable: true,
    });
    expect(checkFragmentMdx('<P __proto__={{}} />\n', new Set(['P']), { P: protoSpec })).toEqual({
      message: 'P prop "__proto__" would not be published (line 1).',
      line: 1,
    });
  });

  test('accepts a fragment that uses only vocabulary components with valid props', () => {
    expect(
      check('# Hi\n\n<Callout tone="info" count={2}>x</Callout>\n\n<Links open items={[{"href":"/a"}]} meta={{}} />\n'),
    ).toBeUndefined();
  });

  test('does not refuse undeclared attributes or components without specs', () => {
    expect(
      checkFragmentMdx('<Callout tone="info" extra="1" />\n\n<Bare any="x" />\n', new Set(['Callout', 'Bare']), specs),
    ).toBeUndefined();
  });

  test('a missing required boolean passes: publish reads it as false', () => {
    const flags = { F: { open: { type: 'boolean', required: true } } } satisfies Record<
      string,
      Record<string, FragmentPropSpec>
    >;
    expect(checkFragmentMdx('<F />\n', new Set(['F']), flags)).toBeUndefined();
  });

  test('style is dropped by design and not refused', () => {
    expect(check('<Callout tone="info" style={{color: "red"}} />\n\n<div style={x}>y</div>\n')).toBeUndefined();
  });

  test('a spread on a component is refused', () => {
    expect(check('<Callout tone="info" {...rest} />\n')?.message).toBe(
      "Callout can't spread {…} props: they would not be published (line 1).",
    );
  });

  test('a code attribute on a lowercase element is refused', () => {
    expect(check('<div title={foo}>x</div>\n')?.message).toBe(
      'div attribute "title" is code and would not be published (line 1).',
    );
  });

  test('an attribute the gate drops is refused', () => {
    expect(check('<div onClick="x">y</div>\n')?.message).toBe(
      'div attribute "onClick" would not be published: names starting with "on" are never passed; rename it (line 1).',
    );
    expect(check('<Callout tone="info" count={null} />\n')?.message).toBe(
      'Callout prop "count" would not be published (line 1).',
    );
  });

  test('a non-scalar JSON value on raw HTML and an on-named component prop are refused', () => {
    expect(check('<div data-x={{"a":1}}>y</div>\n')?.message).toBe(
      'div attribute "data-x" would not be published (line 1).',
    );
    expect(checkFragmentMdx('<Bare online="yes" />\n', new Set(['Bare']), {})?.message).toBe(
      'Bare prop "online" would not be published: names starting with "on" are never passed; rename it (line 1).',
    );
  });

  test('a string under an on-named key inside a JSON prop is refused; other values under such keys are kept', () => {
    expect(checkFragmentMdx('<Bare data={{"a":[{"OnError":"x"}]}} />\n', new Set(['Bare']), {})?.message).toBe(
      'Bare prop "data.a[0].OnError" would not be published: string values under names starting with "on" are dropped (line 1).',
    );
    expect(checkFragmentMdx('<Bare data={{"online":true,"onSale":2}} />\n', new Set(['Bare']), {})).toBeUndefined();
  });
});

type FragmentElement = Extract<RootContent, { type: 'mdxJsxFlowElement' | 'mdxJsxTextElement' }>;

function firstElement(nodes: readonly RootContent[]): FragmentElement | undefined {
  for (const node of nodes) {
    if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') return node;
    const found = 'children' in node ? firstElement(node.children) : undefined;
    if (found) return found;
  }
  return undefined;
}

/** What publish does with the authored attributes: an error, or whether it dropped or changed a non-style attribute. */
async function publishOutcome(mdx: string): Promise<'error' | 'dropped' | 'kept'> {
  // Each prop the Probe received, as JSON, so a value publish changed below the top level shows.
  const received: Map<string, string>[] = [];
  const Probe = (props: { children?: unknown }) => {
    received.push(new Map(Object.entries(props).map(([key, value]) => [key, JSON.stringify(value)])));
    return null;
  };
  const { Component, error } = await evaluateMDXToComponent(mdx, defineFragmentComponents({ components: { Probe } }));
  if (error || !Component) return 'error';
  const markup = renderToStaticMarkup(createElement(Component));
  const element = firstElement(parseFragmentMdx(mdx).children);
  if (!element) return 'kept';
  for (const attr of element.attributes) {
    if (attr.type === 'mdxJsxExpressionAttribute') return 'dropped';
    if (attr.name.toLowerCase() === 'style') continue;
    const authored = attr.value && typeof attr.value === 'object' ? jsonAttributeValue(attr.value.value) : undefined;
    const kept =
      element.name === 'Probe'
        ? received.some(
            (props) =>
              props.has(attr.name) && (authored === undefined || props.get(attr.name) === JSON.stringify(authored)),
          )
        : markup.includes(` ${attr.name.toLowerCase()}=`);
    if (!kept) return 'dropped';
  }
  return 'kept';
}

describe('checkFragmentMdx matches publish', () => {
  const corpus = [
    '{/* note */}\n\nHi\n',
    'Hi {x}\n',
    '{1+1}\n',
    'import X from "./x"\n\nHi\n',
    'export const a = 1\n',
    '<Nope />\n',
    '<a.b />\n',
    '<_Foo />\n',
    '<Probe items={[{ label: "A" }]} />\n',
    "<Probe items={[{ label: 'A' }]} />\n",
    '<Probe {...rest} />\n',
    '<Probe style={{color: "red"}} />\n',
    '<Probe tone="info" count={2} on />\n',
    '<Probe gone={null} />\n',
    '<Probe onClick="x" />\n',
    '<div title={foo}>x</div>\n',
    '<div title="ok">x</div>\n',
    '<div onClick="x">y</div>\n',
    '<div style={x}>y</div>\n',
    '<div onclick="x">y</div>\n',
    '<Probe online="yes" />\n',
    '<Probe key="k" />\n',
    '<div data-x={{"a":1}}>y</div>\n',
    '<div data-x={[1]}>y</div>\n',
    '<div data-x={null}>y</div>\n',
    '<div data-x={2}>y</div>\n',
    '<Probe data={{"onclick":"x"}} />\n',
    '<Probe data={{"online":true,"list":[{"OnError":"x"}]}} />\n',
    '<Probe data={{"online":true,"count":2,"nested":{"onSale":false}}} />\n',
  ];
  for (const mdx of corpus) {
    test(JSON.stringify(mdx), async () => {
      const refused = checkFragmentMdx(mdx, new Set(['Probe']), {}) !== undefined;
      expect(refused).toBe((await publishOutcome(mdx)) !== 'kept');
    });
  }
});

describe('mdxCarriesNoCode, for MDX a site compiles itself', () => {
  test('takes prose, frontmatter and site components with literal props', () => {
    expect(mdxCarriesNoCode('---\ntitle: Post\n---\n# Hi\n\n<Callout tone="info">Text</Callout>\n')).toBe(true);
  });

  for (const mdx of [
    "import { Tabs } from '@astrojs/starlight/components';\n\n# Hi\n",
    'export const x = 1;\n',
    'Total: {1 + 1}\n',
    '<Callout tone={tone()} />\n',
    '<script>alert(1)</script>\n',
    '[x](javascript:alert(1))\n',
    '<div {...props}>x</div>\n',
    '<Callout>\n',
  ]) {
    test(`refuses ${JSON.stringify(mdx)}`, () => {
      expect(mdxCarriesNoCode(mdx)).toBe(false);
    });
  }
});
