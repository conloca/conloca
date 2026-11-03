/**
 * Moving a page's own links under the preview route, so a visitor clicking through a draft stays in the draft. The
 * dispatcher applies these rules with Cloudflare's `HTMLRewriter`; `rewritePreviewLinks` applies them anywhere else.
 */

import { Tokenizer } from 'htmlparser2';

/**
 * `value` under the preview route when it names a page of this site, else null (left as it is). It is resolved
 * against `page`, the unprefixed URL the page was rendered for, so `../x` and `?q` keep their meaning. Files, built
 * assets, the image endpoint, `/_conloca/` and other sites stay where they are.
 */
export function previewHref(
  value: string,
  page: URL,
  route: string,
  root: string,
  hosts: ReadonlySet<string>,
): string | null {
  if (value === '' || value.startsWith('#')) return null;
  let target: URL;
  try {
    target = new URL(value, page);
  } catch {
    return null;
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return null;
  const own = target.host === page.host;
  if (!own && !hosts.has(target.hostname)) return null;
  const { pathname } = target;
  if (root !== '' && pathname !== root && !pathname.startsWith(`${root}/`)) return null;
  const rest = pathname.slice(root.length) || '/';
  if (rest.startsWith('/_conloca/') || rest.startsWith('/_astro/') || rest === '/_image') return null;
  const last = rest.slice(rest.lastIndexOf('/') + 1);
  if (last.includes('.') && !last.endsWith('.html')) return null;
  const moved = `${route}${rest}${target.search}${target.hash}`;
  return own ? moved : `${target.origin}${moved}`;
}

/** A navigation, the only request that may receive draft HTML; without Sec-Fetch-*, one that asks for HTML. */
export function isNavigation(request: Request): boolean {
  const mode = request.headers.get('sec-fetch-mode');
  if (mode !== null) return mode === 'navigate';
  return (request.headers.get('accept') ?? '').includes('text/html');
}

/**
 * `srcset` with each candidate URL that `move` answers for replaced, everything else kept byte for byte; null when none
 * moved. A URL runs to the next whitespace, as the HTML parser reads it, so a `data:` URL's commas stay inside it.
 */
export function movedSrcset(value: string, move: (href: string) => string | null): string | null {
  let out = '';
  let rest = value;
  let moved = false;
  while (rest !== '') {
    const gap = /^[\s,]*/u.exec(rest)?.[0] ?? '';
    const token = /^\S*/u.exec(rest.slice(gap.length))?.[0] ?? '';
    const commas = /,*$/u.exec(token)?.[0] ?? '';
    const href = token.slice(0, token.length - commas.length);
    rest = rest.slice(gap.length + token.length);
    // Descriptors (`1x`, `400w`) run to the next comma, unless the URL already ended at one.
    const descriptor = commas === '' ? (/^[^,]*/u.exec(rest)?.[0] ?? '') : '';
    rest = rest.slice(descriptor.length);
    const target = href === '' ? null : move(href);
    if (target !== null) moved = true;
    out += `${gap}${target ?? href}${commas}${descriptor}`;
  }
  return moved ? out : null;
}

/** An attribute the rewriter may change: where its `=value` runs in the source, and its decoded value. */
interface Found {
  start: number;
  end: number;
  value: string;
}

const ignore = () => {};

/**
 * `html` with the links `linkRewriter` moves moved, every other byte kept. Only moved attributes are rewritten, in
 * double quotes; comments and raw text (`script`, `style`, `textarea`, `title`) are the tokenizer's own states.
 */
export function rewritePreviewLinks(
  html: string,
  page: URL,
  route: string,
  root: string,
  hosts: ReadonlySet<string>,
): string {
  // A `<base href>` changes what relative links resolve against for every link after it.
  let resolveAgainst = page;
  const edits: { start: number; end: number; text: string }[] = [];
  let tag = '';
  let attributes = new Map<string, Found>();
  let current: Found | null = null;
  const replace = (name: string, found: Found, value: string) => {
    edits.push({
      start: found.start,
      end: found.end,
      text: `="${value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`,
    });
    if (name !== 'href' || (tag !== 'a' && tag !== 'area')) return;
    // Astro's prefetch would spend the visitor's 60 requests per 10 s on links they never open.
    const prefetch = attributes.get('data-astro-prefetch');
    if (prefetch === undefined) edits.push({ start: found.end, end: found.end, text: ' data-astro-prefetch="false"' });
    else edits.push({ start: prefetch.start, end: prefetch.end, text: '="false"' });
  };
  const move = (name: string) => {
    const found = attributes.get(name);
    const moved = found === undefined ? null : previewHref(found.value, resolveAgainst, route, root, hosts);
    if (found !== undefined && moved !== null) replace(name, found, moved);
  };
  const finish = () => {
    if (tag === 'base') {
      const value = attributes.get('href')?.value;
      if (value !== undefined && URL.canParse(value, page.href)) resolveAgainst = new URL(value, page);
    }
    if (tag === 'base' || tag === 'a' || tag === 'area') move('href');
    if (tag === 'form') move('action');
    const srcset = attributes.get('srcset');
    const moved =
      srcset === undefined
        ? null
        : movedSrcset(srcset.value, (href) => previewHref(href, resolveAgainst, route, root, hosts));
    if (srcset !== undefined && moved !== null) replace('srcset', srcset, moved);
    tag = '';
  };
  const tokenizer = new Tokenizer(
    { xmlMode: false, decodeEntities: true },
    {
      onopentagname(start, end) {
        tag = html.slice(start, end).toLowerCase();
        attributes = new Map();
      },
      onattribname(start, end) {
        const name = html.slice(start, end).toLowerCase();
        // The first of two same-named attributes is the one the browser keeps.
        current = attributes.has(name) ? null : { start: end, end, value: '' };
        if (current !== null) attributes.set(name, current);
      },
      onattribdata(start, end) {
        if (current !== null) current.value += html.slice(start, end);
      },
      onattribentity(codepoint) {
        if (current !== null) current.value += String.fromCodePoint(codepoint);
      },
      onattribend(_quote, end) {
        if (current !== null) current.end = end;
        current = null;
      },
      onopentagend: finish,
      onselfclosingtag: finish,
      oncdata: ignore,
      onclosetag: ignore,
      oncomment: ignore,
      ondeclaration: ignore,
      onend: ignore,
      onprocessinginstruction: ignore,
      ontext: ignore,
      ontextentity: ignore,
    },
  );
  tokenizer.write(html);
  tokenizer.end();
  const out: string[] = [];
  let cursor = 0;
  // oxlint-disable-next-line unicorn/no-array-sort -- the target lib predates toSorted; this sorts its own array.
  for (const edit of edits.sort((a, b) => a.start - b.start || a.end - b.end)) {
    out.push(html.slice(cursor, edit.start), edit.text);
    cursor = edit.end;
  }
  out.push(html.slice(cursor));
  return out.join('');
}
