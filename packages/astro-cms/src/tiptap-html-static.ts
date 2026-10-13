// Drop-in replacement for `@tiptap/html` in server bundles: same named exports,
// no DOM anywhere. The richtext field render imports `generateHTML`/`generateJSON`
// from `@tiptap/html`; its browser build needs `window`, and its `/server` build
// fakes one with happy-dom — whose `Window` constructor calls `node:vm`
// (`Script.runInContext`). Workers runtimes ship `node:vm` as a stub, so that
// call throws at render time and every richtext section on the page dies. The
// static renderer walks the ProseMirror document and writes the markup as a
// string instead, so the same output comes out on any engine.
import {
  escapeHTML,
  renderJSONContentToString,
  serializeChildrenToHTMLString,
} from '@tiptap/static-renderer/json/html-string';
import { domOutputSpecToHTMLString, renderToElement } from '@tiptap/static-renderer/pm/html-string';

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
 * Parsing an HTML string back into ProseMirror JSON needs a real HTML parser,
 * which no DOM-free server runtime provides. Richtext values written by the
 * editor are already ProseMirror JSON, so this only trips on hand-authored HTML
 * strings — and says so instead of failing deep inside a fake DOM.
 */
export function generateJSON(_html: string, _extensions: RichTextExtensions): Record<string, unknown> {
  throw new Error(
    'generateJSON cannot parse HTML without a DOM. Store richtext values as tiptap JSON documents instead of HTML strings.',
  );
}
