// Drop-in replacement for `@tiptap/html` wherever the site's build resolves it, in
// the editor and in the server render alike: same named exports, no happy-dom and
// no `node:vm`. The richtext field render imports `generateHTML`/`generateJSON`
// from `@tiptap/html`; its browser build needs `window`, and its `/server` build
// fakes one with happy-dom — whose `Window` constructor calls `node:vm`
// (`Script.runInContext`). Workers runtimes ship `node:vm` as a stub, so that
// call throws at render time and every richtext section on the page dies. The
// static renderer walks the ProseMirror document and writes the markup as a
// string instead, so the same output comes out on any engine; reading HTML back
// takes the browser's own parser, or linkedom where there is none.
import { getSchema } from '@tiptap/core';
import { type ParseOptions, DOMParser as ProseMirrorDOMParser } from '@tiptap/pm/model';
import {
  escapeHTML,
  renderJSONContentToString,
  serializeChildrenToHTMLString,
} from '@tiptap/static-renderer/json/html-string';
import { domOutputSpecToHTMLString, renderToElement } from '@tiptap/static-renderer/pm/html-string';
import { parseHTML } from 'linkedom/worker';

type RenderArgs = Parameters<typeof renderToElement<string>>[0];
type RichTextContent = RenderArgs['content'];
type RichTextExtensions = RenderArgs['extensions'];
type ElementSpec = Parameters<typeof domOutputSpecToHTMLString>[0];

// Void elements the HTML parser closes on its own. The static renderer writes
// them self-closing (`<br/>`); a DOM serializer writes `<br>`. Both parse
// identically, but the rendered markup is compared byte for byte against the
// DOM output, so normalize to the DOM spelling.
const VOID_ELEMENTS = /<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)((?:\s[^>]*?)?)\/>/gi;

/**
 * Drops the attributes an extension left empty. A DOM serializer skips those;
 * the string renderer would spell them out as the text "null" (`class="null"`
 * on every link, `type="null"` on every ordered list).
 */
function withoutEmptyAttributes(spec: ElementSpec): ElementSpec {
  if (!Array.isArray(spec)) {
    return spec;
  }

  const [tag, ...parts] = spec;
  const cleaned: [string, ...unknown[]] = [
    tag,
    ...parts.map((part: unknown, index) => {
      // Position 0 of the rest holds the attributes, unless the element has
      // none — then a nested element spec sits there instead.
      if (Array.isArray(part) && typeof part[0] === 'string') {
        return withoutEmptyAttributes(part as [string, ...unknown[]]);
      }
      if (index !== 0 || part === null || typeof part !== 'object') {
        return part;
      }
      return Object.fromEntries(Object.entries(part).filter(([, value]) => value !== null && value !== undefined));
    }),
  ];

  return cleaned;
}

/** Generates HTML from a ProseMirror JSON document, without a DOM. */
export function generateHTML(doc: RichTextContent, extensions: RichTextExtensions): string {
  const html = renderToElement<string>({
    // The string renderer's own generic defaults describe plain JSON marks;
    // this walk hands it ProseMirror ones. Same function, narrower input.
    renderer: renderJSONContentToString as RenderArgs['renderer'],
    domOutputSpecToElement: (spec) => domOutputSpecToHTMLString(withoutEmptyAttributes(spec)),
    mapDefinedTypes: {
      doc: ({ children }) => serializeChildrenToHTMLString(children),
      text: ({ node }) => escapeHTML(node.text ?? ''),
    },
    content: doc,
    extensions,
  });

  return html.replace(VOID_ELEMENTS, '<$1$2>');
}

/**
 * Reads an HTML string into a ProseMirror JSON document. The richtext field stores
 * the editor's HTML and its render reads it back through here. A browser parses
 * with its own DOMParser; a server render has none, so linkedom parses there —
 * plain JavaScript without `node:vm`, so it runs in Workers runtimes too.
 */
export function generateJSON(
  html: string,
  extensions: RichTextExtensions,
  options?: ParseOptions,
): Record<string, unknown> {
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
