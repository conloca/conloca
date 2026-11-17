import type { MDXHeading } from '@conloca/content-api';
import GithubSlugger, { slug } from 'github-slugger';
import { componentPropValue } from './component-props.js';
import type { FragmentOutlineProps } from './vocabulary.js';

/**
 * One heading of a fragment: the anchor target and the contents entry. Aliased
 * from the content API's own type rather than restated, so the shape hosts
 * exchange and the shape this pass produces cannot drift.
 */
export type FragmentHeading = MDXHeading;

/** One component the site's vocabulary declares a contents entry, with the anchor id and text read from its props. */
export interface FragmentOutlineComponent {
  component: string;
  id: string;
  text: string;
}

/**
 * A heading node in either shape this pipeline produces: a plain hast element,
 * or the mdxJsx node `remarkRehype`'s `passThrough` list preserves for a
 * heading the author wrote as literal JSX.
 */
type OutlineScalar = string | number | boolean | null | undefined;

interface OutlineAttribute {
  type?: string;
  name?: string | null;
  value?: string | null | object;
}

interface OutlineProperties {
  id?: OutlineScalar | readonly OutlineScalar[];
}

export interface OutlineTree {
  type: string;
  children?: OutlineTree[];
  value?: string;
  tagName?: string;
  name?: string | null;
  properties?: OutlineProperties;
  attributes?: OutlineAttribute[];
}

interface HeadingNode {
  node: OutlineTree;
  depth: number;
  jsx: boolean;
}

const HEADING_NAME = /^h([1-6])$/;

function headingOf(node: OutlineTree): HeadingNode | null {
  const type = node.type;
  const name = type === 'element' ? node.tagName : node.name;
  if (typeof name !== 'string') return null;
  const match = HEADING_NAME.exec(name);
  if (!match) return null;
  if (type !== 'element' && type !== 'mdxJsxFlowElement' && type !== 'mdxJsxTextElement') return null;
  return { node, depth: Number(match[1]), jsx: type !== 'element' };
}

function walk(node: OutlineTree, visit: (node: OutlineTree) => void): void {
  visit(node);
  const children = node.children;
  if (Array.isArray(children)) {
    for (const child of children) walk(child, visit);
  }
}

/** Visible text of a heading, with `**bold**`, `` `code` `` and the like flattened away. */
function textOf(node: OutlineTree): string {
  let text = '';
  walk(node, (child) => {
    if (child.type === 'text' && typeof child.value === 'string') text += child.value;
  });
  return text.trim().replace(/\s+/g, ' ');
}

function existingIdOf(heading: HeadingNode): string | undefined {
  if (!heading.jsx) {
    const id = heading.node.properties?.id;
    if (typeof id === 'string' && id !== '') return id;
    return undefined;
  }
  const attributes = heading.node.attributes;
  if (!Array.isArray(attributes)) return undefined;
  for (const attribute of attributes) {
    if (attribute.name === 'id' && typeof attribute.value === 'string' && attribute.value !== '') {
      return attribute.value;
    }
  }
  return undefined;
}

function setIdOf(heading: HeadingNode, id: string): void {
  if (!heading.jsx) {
    const properties: OutlineProperties = heading.node.properties ?? {};
    properties.id = id;
    heading.node.properties = properties;
    return;
  }
  const attributes = Array.isArray(heading.node.attributes) ? heading.node.attributes : [];
  attributes.push({ type: 'mdxJsxAttribute', name: 'id', value: id });
  heading.node.attributes = attributes;
}

/**
 * GitHub's heading-id rules, the ones Astro gives Markdown headings too, so a
 * heading in any script keeps a readable id that does not depend on its
 * position. `section` stands in for a heading that slugs to nothing ('!!!'),
 * because an empty id renders a contents link as a bare `#`; it goes through
 * the slugger like any other text, so a second one becomes `section-1`, not
 * `-1`. Author ids live in their own set because the slugger can only record
 * the slug of a value, never reserve an exact id.
 */
function idFor(text: string, slugger: GithubSlugger, reserved: ReadonlySet<string>): string {
  const base = slug(text) || 'section';
  let id = slugger.slug(base);
  while (reserved.has(id)) id = slugger.slug(base);
  return id;
}

/**
 * Give every heading in the tree an id and report them in document order.
 *
 * The one pipeline calls this: `evaluate.ts`, which the published page and
 * every editing surface render through. One pass assigns
 * the id and records it, so the anchor in the markup and the anchor in the
 * outline cannot disagree — which is the whole reason the outline is produced
 * here rather than read back off rendered HTML.
 *
 * `unknown` rather than a hast `Root`: this package does not depend on
 * `@types/hast`, and the walk is structural anyway — it reads `type`, `name`,
 * `tagName` and `children`, and ignores anything that does not carry them.
 */
export function applyHeadingIds(tree: OutlineTree, reservedIds: Iterable<string> = []): FragmentHeading[] {
  const headings: HeadingNode[] = [];
  walk(tree, (node) => {
    const heading = headingOf(node);
    if (heading) headings.push(heading);
  });

  // Author-chosen ids (on headings, or the caller's, such as outlined components') are reserved before any are
  // generated, so a generated slug never silently takes an id the author already spelled out further down.
  const reserved = new Set<string>(reservedIds);
  for (const heading of headings) {
    const existing = existingIdOf(heading);
    if (existing !== undefined) reserved.add(existing);
  }
  const slugger = new GithubSlugger();

  return headings.map((heading) => {
    const text = textOf(heading.node);
    const existing = existingIdOf(heading);
    const id = existing ?? idFor(text, slugger, reserved);
    if (existing === undefined) setIdOf(heading, id);
    return { depth: heading.depth, id, text };
  });
}

/**
 * The components `declared` names, in document order, with the id and text their props carry. Reads the tree
 * after the attribute gate, so an entry holds exactly the values the component renders with; one whose id or
 * text is not a non-empty string is left out rather than listed as a link to nothing.
 */
export function componentOutlineOf(
  tree: OutlineTree,
  declared: Readonly<Record<string, FragmentOutlineProps>>,
): FragmentOutlineComponent[] {
  const entries: FragmentOutlineComponent[] = [];
  walk(tree, (node) => {
    if (node.type !== 'mdxJsxFlowElement' && node.type !== 'mdxJsxTextElement') return;
    const component = node.name;
    if (typeof component !== 'string' || !Object.prototype.hasOwnProperty.call(declared, component)) return;
    const props = declared[component];
    // React keeps the last of two same-named attributes, so the entry does too.
    const propValue = (name: string) => {
      const attribute = node.attributes?.reduce<OutlineAttribute | undefined>(
        (last, candidate) => (candidate.name === name ? candidate : last),
        undefined,
      );
      return attribute ? componentPropValue({ ...attribute, name }) : undefined;
    };
    const id = propValue(props.id);
    const text = propValue(props.text);
    if (typeof id === 'string' && id !== '' && typeof text === 'string' && text !== '') {
      entries.push({ component, id, text });
    }
  });
  return entries;
}
