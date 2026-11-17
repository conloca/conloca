import { Parser } from 'htmlparser2';

/** One element between `<body>` and the page-root marker. */
export interface AncestorElement {
  tag: string;
  classes: readonly string[];
}

/** The attribute a framed page carries on the element that wraps its content. */
const PAGE_ROOT = 'data-conloca-page-root';

/**
 * The elements from `<body>` (excluded) down to the first element carrying `data-conloca-page-root` (excluded), with
 * sorted classes; undefined when there is no marker. Script and style text is raw to the parser; template content is
 * skipped.
 */
export function ancestorChain(html: string): AncestorElement[] | undefined {
  const stack: AncestorElement[] = [];
  let inBody = false;
  let templates = 0;
  let chain: AncestorElement[] | undefined;
  const parser = new Parser({
    onopentag(name, attribs) {
      if (chain !== undefined) return;
      if (name === 'template' || templates > 0) {
        if (name === 'template') templates++;
        return;
      }
      if (name === 'body') {
        inBody = true;
        return;
      }
      if (!inBody) return;
      if (PAGE_ROOT in attribs) {
        chain = [...stack];
        return;
      }
      // oxlint-disable-next-line unicorn/no-array-sort -- sorts the fresh array `filter` made; ES2022 has no toSorted.
      stack.push({ tag: name, classes: (attribs.class ?? '').split(/\s+/).filter(Boolean).sort() });
    },
    onclosetag(name) {
      if (chain !== undefined) return;
      if (templates > 0) {
        if (name === 'template') templates--;
        return;
      }
      if (name === 'body') inBody = false;
      else if (inBody) stack.pop();
    },
  });
  parser.end(html);
  return chain;
}

/** A chain as `tag.class.class > …`. */
export function formatChain(chain: readonly AncestorElement[]): string {
  return chain.length === 0 ? '(nothing)' : chain.map((e) => [e.tag, ...e.classes].join('.')).join(' > ');
}
