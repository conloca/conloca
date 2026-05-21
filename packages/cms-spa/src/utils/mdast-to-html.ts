/**
 * Convert (small) mdast subtrees to HTML strings.
 *
 * Two motivating cases for these helpers:
 *
 *   1. Components like Starlight's `<Steps>`/`<FileTree>` whose Astro
 *      implementation validates the slot tag name and rejects
 *      `<conloca-slot>` — the GenericBlock editor renders the list body
 *      as raw HTML and passes that as the slot content instead.
 *
 *   2. Raw HTML the author writes directly in MDX (`<div class="x">`,
 *      `<details><summary>`, etc.) lands in the mdast as
 *      `mdxJsxFlowElement`/`mdxJsxTextElement` with a lowercase tag
 *      name. The editor renders those in place rather than routing
 *      through the Container API (which expects a component import).
 *
 * Anything unrecognized collapses to its concatenated children
 * (transparent wrapper). Safer than dropping content — text still
 * shows even if formatting doesn't.
 *
 * These functions live outside `GenericBlock.tsx` because they're pure
 * — no React, no DOM, no editor state. Importing from a single place
 * also keeps the call sites honest about what's serialization vs
 * editor wiring.
 */

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** True when a JSX tag name is a standard HTML element (lowercase-
 * first per the React/Astro convention). Used to render raw HTML
 * inline rather than routing it through the Astro Container API. */
export function isHtmlTag(name: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(name);
}

/** Self-closing HTML elements that must NOT have a closing tag. */
const VOID_HTML_TAGS = new Set([
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

export function attrsToHtml(attrs: unknown): string {
  if (!Array.isArray(attrs)) return '';
  const parts: string[] = [];
  for (const a of attrs as Array<{ type?: string; name?: string; value?: unknown }>) {
    if (a?.type !== 'mdxJsxAttribute' || typeof a.name !== 'string') continue;
    const v = a.value;
    if (v == null) {
      parts.push(a.name); // shorthand boolean
    } else if (typeof v === 'string') {
      parts.push(`${a.name}="${escapeHtml(v)}"`);
    } else if (typeof v === 'object' && v && 'value' in v && typeof (v as { value: unknown }).value === 'string') {
      // Expression — serialize the source. JSON-literal expressions
      // (`{42}`, `{true}`) round-trip; non-literal ones fall through
      // as-is, which mirrors what attrsToProps does for the SSR
      // payload.
      const src = ((v as { value: string }).value || '').trim();
      let parsed: unknown;
      try {
        parsed = JSON.parse(src);
      } catch {
        parsed = src;
      }
      if (typeof parsed === 'boolean') {
        if (parsed) parts.push(a.name);
      } else if (parsed != null) {
        parts.push(`${a.name}="${escapeHtml(String(parsed))}"`);
      }
    }
  }
  return parts.length ? ' ' + parts.join(' ') : '';
}

export function mdastToHtml(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as {
    type?: string;
    value?: unknown;
    children?: unknown[];
    ordered?: boolean;
    url?: string;
    name?: string;
    attributes?: unknown;
    depth?: number;
    lang?: string;
  };
  switch (n.type) {
    case 'text':
      return typeof n.value === 'string' ? escapeHtml(n.value) : '';
    case 'inlineCode':
      return `<code>${typeof n.value === 'string' ? escapeHtml(n.value) : ''}</code>`;
    case 'emphasis':
      return `<em>${(n.children ?? []).map(mdastToHtml).join('')}</em>`;
    case 'strong':
      return `<strong>${(n.children ?? []).map(mdastToHtml).join('')}</strong>`;
    case 'delete':
      return `<del>${(n.children ?? []).map(mdastToHtml).join('')}</del>`;
    case 'link':
      return `<a href="${escapeHtml(typeof n.url === 'string' ? n.url : '')}">${(n.children ?? []).map(mdastToHtml).join('')}</a>`;
    case 'image':
      return `<img src="${escapeHtml(typeof n.url === 'string' ? n.url : '')}" alt="${escapeHtml(typeof (n as { alt?: unknown }).alt === 'string' ? (n as { alt: string }).alt : '')}" />`;
    case 'paragraph':
      return `<p>${(n.children ?? []).map(mdastToHtml).join('')}</p>`;
    case 'heading': {
      const lvl = Math.max(1, Math.min(6, Number(n.depth) || 1));
      return `<h${lvl}>${(n.children ?? []).map(mdastToHtml).join('')}</h${lvl}>`;
    }
    case 'blockquote':
      return `<blockquote>${(n.children ?? []).map(mdastToHtml).join('')}</blockquote>`;
    case 'list': {
      const tag = n.ordered ? 'ol' : 'ul';
      return `<${tag}>${(n.children ?? []).map(mdastToHtml).join('')}</${tag}>`;
    }
    case 'listItem': {
      // Unwrap `paragraph` children of list items so their contents
      // render inline-of-the-`<li>` rather than wrapped in a block
      // `<p>`. Matches Astro's MDX pipeline for both tight lists (a
      // single-paragraph listItem) AND loose lists like `<FileTree>`'s
      // directory items (`paragraph` for the name + nested `list` for
      // children).
      //
      // Without this, Starlight's <FileTree> renders directory names
      // in a block <p>, which inside .tree-entry (inline-flex) wraps
      // onto its own line — folder icons end up stacked above their
      // names instead of inline with them, the way the live page
      // renders. Same fix protects any list-bearing strict-slot
      // component shipped via bodyHtml.
      const kids = n.children ?? [];
      const inner = kids
        .map((c) =>
          (c as { type?: string } | undefined)?.type === 'paragraph'
            ? ((c as { children?: unknown[] }).children ?? []).map(mdastToHtml).join('')
            : mdastToHtml(c),
        )
        .join('');
      return `<li>${inner}</li>`;
    }
    case 'thematicBreak':
      return '<hr />';
    case 'code': {
      const lang = typeof n.lang === 'string' && n.lang ? ` class="language-${escapeHtml(n.lang)}"` : '';
      return `<pre><code${lang}>${typeof n.value === 'string' ? escapeHtml(n.value) : ''}</code></pre>`;
    }
    case 'html':
      // Raw HTML mdast — pass through unescaped.
      return typeof n.value === 'string' ? n.value : '';
    case 'break':
      return '<br />';
    case 'mdxJsxFlowElement':
    case 'mdxJsxTextElement': {
      const tag = typeof n.name === 'string' ? n.name : '';
      if (!tag) return Array.isArray(n.children) ? n.children.map(mdastToHtml).join('') : '';
      if (!isHtmlTag(tag)) {
        // Capital-cased JSX — a component we don't know how to render
        // statically here. Fall back to children (their text/HTML).
        return Array.isArray(n.children) ? n.children.map(mdastToHtml).join('') : '';
      }
      const attrs = attrsToHtml(n.attributes);
      if (VOID_HTML_TAGS.has(tag)) return `<${tag}${attrs} />`;
      const inner = Array.isArray(n.children) ? n.children.map(mdastToHtml).join('') : '';
      return `<${tag}${attrs}>${inner}</${tag}>`;
    }
    default:
      return Array.isArray(n.children) ? n.children.map(mdastToHtml).join('') : '';
  }
}

/**
 * True when the mdast subtree's body contains any block-level non-JSX
 * mdast node that we'd want to render as HTML rather than route
 * through the editor's slot+portal flow. Two reasons we go this route:
 *
 *   1. Some Astro components validate the slot element type and
 *      reject `<conloca-slot>` (Starlight's `<Steps>` wants `<ol>`,
 *      `<FileTree>` wants `<ul>`, hypothetical Carousels/Tables/etc
 *      could want their own tag). Rendering the body as HTML and
 *      emitting it raw makes the validator see the real element.
 *
 *   2. The portal-based editor surface is built for prose text (with
 *      inline marks) plus block JSX. Heading/blockquote/table/code
 *      blocks as a component's direct body are less common and not
 *      cleanly editable inline anyway — rendering them statically
 *      until we add per-position slot markers (Phase 3) keeps the
 *      visual right.
 *
 * Plain text + inline JSX bodies stay on the slot+portal path so
 * Cards, Asides, etc. remain inline-editable.
 */
export function bodyNeedsStaticHtml(kids: unknown[]): boolean {
  return kids.some((c) => {
    const t = (c as { type?: string })?.type;
    return (
      t === 'list' ||
      t === 'heading' ||
      t === 'blockquote' ||
      t === 'table' ||
      t === 'code' ||
      t === 'thematicBreak' ||
      t === 'html'
    );
  });
}
