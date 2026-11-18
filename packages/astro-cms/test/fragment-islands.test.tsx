import { describe, expect, test } from 'bun:test';
import {
  defineFragmentComponents,
  evaluateMDXToComponent,
  type FragmentVocabulary,
  type JsonValue,
} from '@conloca/mdx/render';
import { type ReactNode, useId, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { isFragmentIsland, islandVocabulary } from '../src/components/FragmentIsland.js';
import { withHydration } from '../src/lib/withHydration.js';

// Fresh function objects: withHydration mutates the function it is given.
const Counter = withHydration(({ start, children }: { start: number; children?: ReactNode }) => {
  const [n, setN] = useState(start);
  return (
    <div>
      <button type="button" onClick={() => setN(n + 1)}>
        {n}
      </button>
      {children}
    </div>
  );
}, 'load');
const Tip = withHydration(({ children }: { children?: ReactNode }) => <span>{children}</span>, 'idle');
const Hidden = withHydration(({ children }: { children?: ReactNode }) => {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        open
      </button>
      {open && children}
    </div>
  );
}, 'load');
const Labelled = withHydration(() => <span id={useId()}>x</span>, 'load');
const Callout = ({ children }: { children?: ReactNode }) => <aside>{children}</aside>;

type ProbeProps = { children?: ReactNode; [prop: string]: JsonValue | ReactNode };
const recorded: ProbeProps[] = [];
const Probe = withHydration((props: ProbeProps) => {
  recorded.push(props);
  return <i>probe</i>;
}, 'load');

const keys = new Map<unknown, string>([
  [Counter, 'Counter'],
  [Tip, 'Tip'],
  [Hidden, 'Hidden'],
  [Labelled, 'Labelled'],
  [Probe, 'Probe'],
]);

const raw = defineFragmentComponents({ components: { Counter, Tip, Hidden, Labelled, Callout, Probe } });

async function render(mdx: string, vocabulary: FragmentVocabulary = islandVocabulary(raw, keys)): Promise<string> {
  const { Component, error } = await evaluateMDXToComponent(mdx, vocabulary);
  if (error || !Component) throw error ?? new Error('no component');
  return renderToStaticMarkup(<Component />);
}

const islandIds = (html: string) => [...html.matchAll(/data-conloca-island="([^"]+)"/g)].map((m) => m[1]);

describe('islandVocabulary', () => {
  test('wraps only hydrated components', () => {
    const v = islandVocabulary(raw, keys);
    expect(v.components.Callout).toBe(Callout);
    expect(v.components.Counter).not.toBe(Counter);
    expect(isFragmentIsland(v.components.Counter)).toBe(true);
    expect(isFragmentIsland(Callout)).toBe(false);
  });

  test('rejects a hydrated element override', () => {
    const H2 = withHydration(() => <h2>x</h2>, 'load');
    const v = defineFragmentComponents({ elements: { h2: H2 } });
    expect(() => islandVocabulary(v, keys)).toThrow(
      new TypeError('Element override <h2> is wrapped in withHydration(); only fragment components can hydrate.'),
    );
  });

  test('rejects a hydrated component the build found no module for', () => {
    const Lost = withHydration(() => null, 'load');
    const v = defineFragmentComponents({ components: { Lost } });
    expect(() => islandVocabulary(v, keys)).toThrow(
      new TypeError(
        'Fragment component <Lost> is wrapped in withHydration(), but the build found no module for it. Import it into the render module by name from the file that calls withHydration().',
      ),
    );
  });

  test('writes the registry key, not the vocabulary name', async () => {
    const v = islandVocabulary(defineFragmentComponents({ components: { Tally: Counter } }), keys);
    expect(await render('<Tally start={1} />', v)).toContain('data-conloca-component="Counter"');
  });

  test('memoizes per input vocabulary', () => {
    expect(islandVocabulary(raw, keys)).toBe(islandVocabulary(raw, keys));
  });

  test('carries the outline over', async () => {
    const v = defineFragmentComponents({ components: { Counter }, outline: { Counter: { id: 'id', text: 'label' } } });
    const islands = islandVocabulary(v, keys);
    expect(islands.outline).toEqual(v.outline);
    const mdx = '<Counter id="a" label="A" start={1} />';
    expect((await evaluateMDXToComponent(mdx, islands)).componentOutline).toEqual(
      (await evaluateMDXToComponent(mdx, v)).componentOutline,
    );
  });
});

describe('island markup', () => {
  test('wraps the component with its strategy, props and a children slot', async () => {
    const html = await render('<Counter start={2}>\n\nCount **this**\n\n</Counter>');
    expect(html).toContain('<conloca-island');
    expect(html).toContain('data-conloca-component="Counter"');
    expect(html).toContain('data-hydrate-strategy="load"');
    expect(html).toContain('data-props="{&quot;start&quot;:2}"');
    expect(html).toContain('style="display:contents"');
    const [id] = islandIds(html);
    expect(html).toContain(
      `<conloca-island-slot data-conloca-island-slot="${id}" style="display:contents"><p>Count <strong>this</strong></p></conloca-island-slot>`,
    );
    expect(html).not.toContain('<template');
  });

  test('per-instance ids', async () => {
    const ids = islandIds(await render('<Counter start={1} />\n\n<Counter start={1} />'));
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);

    const { Component } = await evaluateMDXToComponent('<Counter start={1} />', islandVocabulary(raw, keys));
    if (!Component) throw new Error('no component');
    const twice = islandIds(
      renderToStaticMarkup(
        <>
          <Component />
          <Component />
        </>,
      ),
    );
    expect(twice).toHaveLength(2);
    expect(twice[0]).not.toBe(twice[1]);
  });

  test('own root: the component useId starts with the island id', async () => {
    const html = await render('<Labelled />');
    const [id] = islandIds(html);
    const spanId = html.match(/<span id="([^"]+)"/)?.[1];
    // React 19 writes useId values as `_${identifierPrefix}R_…_`.
    expect(spanId?.startsWith(`_${id}`)).toBe(true);
  });

  test('children kept hidden travel in a template', async () => {
    const html = await render('<Hidden>\n\nSecret\n\n</Hidden>');
    const [id] = islandIds(html);
    expect(html).toContain(`</conloca-island><template data-conloca-island-slot="${id}"><p>Secret</p></template>`);
  });

  test('inline island stays inside its paragraph', async () => {
    const html = await render('Text <Tip>x</Tip> more');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const paragraphs = doc.querySelectorAll('p');
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.querySelector('conloca-island')).not.toBeNull();
    expect(paragraphs[0]?.textContent).toBe('Text x more');
  });

  test('static fragment unchanged', async () => {
    expect(await render('<Callout>a</Callout>')).toBe(await render('<Callout>a</Callout>', raw));
  });

  test.each([
    '<Probe href="javascript:x" onClick="y" data={{"u":"vbscript:z","onx":"w"}} text="</script><script>alert(1)</script>" />',
    "<Probe data={{ u: 'vbscript:z', onx: 'w', }} />",
  ])('props are the filtered props: %s', async (mdx) => {
    recorded.length = 0;
    const html = await render(mdx);
    const { children: _children, ...props } = recorded[0] ?? {};
    const island = new DOMParser().parseFromString(html, 'text/html').querySelector('conloca-island');
    expect(JSON.parse(island?.getAttribute('data-props') ?? '')).toEqual(props);
    expect(html).not.toContain('<script');
    expect(html.toLowerCase()).not.toContain('onclick');
    expect(props.data).toEqual({ u: '' });
  });

  test('parity with the canvas', async () => {
    const mdx = '<Counter start={2}>\n\nCount **this**\n\n</Counter>\n\n<Callout>b</Callout>';
    const stripped = (await render(mdx)).replace(/<\/?conloca-island(-slot)?\b[^>]*>|<!-- -->/g, '');
    expect(stripped).toBe(await render(mdx, raw));
  });
});
