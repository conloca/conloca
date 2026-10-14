// Drop-in replacement for `@tiptap/html` wherever the site's build resolves it, in
// the editor and in the server render alike: same named exports, no happy-dom and
// no `node:vm`. The richtext field render imports `generateHTML`/`generateJSON`
// from `@tiptap/html`; its browser build needs `window`, and its `/server` build
// fakes one with happy-dom — whose `Window` constructor calls `node:vm`
// (`Script.runInContext`). Workers runtimes ship `node:vm` as a stub, so that
// call throws at render time and every richtext section on the page dies. Here
// ProseMirror's own serializer, the one `@tiptap/html` runs, writes into a few
// string-backed elements instead of a DOM, so the same markup comes out on any
// engine; reading HTML back takes the browser's own parser, or linkedom where
// there is none.
import { type Extensions, getSchema, type JSONContent } from '@tiptap/core';
import {
  DOMSerializer,
  type ParseOptions,
  DOMParser as ProseMirrorDOMParser,
  Node as ProseMirrorNode,
} from '@tiptap/pm/model';
import { parseHTML } from 'linkedom/worker';

// Elements the HTML parser closes on its own, so a DOM serializer writes no end tag.
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const escapeText = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/\u00a0/g, '&nbsp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const escapeAttribute = (value: string) => escapeText(value).replace(/"/g, '&quot;');

class StringText {
  readonly nodeType = 3;
  constructor(private readonly text: string) {}
  toString(): string {
    return escapeText(this.text);
  }
}

/**
 * An element as far as ProseMirror's serializer uses one: attributes in the
 * order they were set, children appended. Having no `style` object, it takes
 * `style` as a plain attribute, as written.
 */
class StringElement {
  readonly nodeType = 1;
  private readonly attributes = new Map<string, string>();
  private readonly children: (StringElement | StringText)[] = [];
  constructor(private readonly tagName: string) {}

  setAttribute(name: string, value: unknown): void {
    this.attributes.set(name, String(value));
  }

  setAttributeNS(_namespace: string | null, name: string, value: unknown): void {
    this.setAttribute(name, value);
  }

  appendChild<T extends StringElement | StringText>(child: T): T {
    this.children.push(child);
    return child;
  }

  get innerHTML(): string {
    return this.children.join('');
  }

  toString(): string {
    const attributes = [...this.attributes].map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`).join('');
    const open = `<${this.tagName}${attributes}>`;
    return VOID_ELEMENTS.has(this.tagName) ? open : `${open}${this.innerHTML}</${this.tagName}>`;
  }
}

const stringDocument = {
  createElement: (tagName: string) => new StringElement(tagName),
  createElementNS: (_namespace: string, tagName: string) => new StringElement(tagName),
  createTextNode: (text: string) => new StringText(text),
};

/**
 * Generates HTML from a ProseMirror JSON document, without a DOM. The
 * serializer keeps a mark's element open across the runs that share it, so a
 * link with one underlined word stays one link.
 */
export function generateHTML(doc: JSONContent, extensions: Extensions): string {
  const schema = getSchema(extensions);
  const root = new StringElement('div');
  // The string-backed elements cover every DOM call the serializer makes, under types of their own.
  DOMSerializer.fromSchema(schema).serializeFragment(
    ProseMirrorNode.fromJSON(schema, doc).content,
    { document: stringDocument as unknown as Document },
    root as unknown as HTMLElement,
  );
  return root.innerHTML;
}

/**
 * Reads an HTML string into a ProseMirror JSON document. The richtext field stores
 * the editor's HTML and its render reads it back through here. A browser parses
 * with its own DOMParser; a server render has none, so linkedom parses there —
 * plain JavaScript without `node:vm`, so it runs in Workers runtimes too.
 */
export function generateJSON(html: string, extensions: Extensions, options?: ParseOptions): Record<string, unknown> {
  const parser = ProseMirrorDOMParser.fromSchema(getSchema(extensions));
  if (typeof globalThis.DOMParser === 'function') {
    const { body } = new globalThis.DOMParser().parseFromString(html, 'text/html');
    return parser.parse(body, options).toJSON();
  }

  const { document } = parseHTML(`<!DOCTYPE html><html><body>${html}</body></html>`);
  // linkedom's elements implement the part of the DOM ProseMirror reads, under types of their own.
  const doc = parser.parse(document.body as unknown as Node, options).toJSON();
  // linkedom answers `getAttribute('class')` with "" for an element that has no
  // class, where a browser answers null, so every link would read back with an
  // empty class and render as `class=""`. Give the null back.
  return JSON.parse(JSON.stringify(doc), (key, value) => (key === 'class' && value === '' ? null : value));
}
