/**
 * The server-side SVG sanitiser: an uploaded SVG keeps its drawing and loses everything that could run or call out —
 * scripts, event handlers, `foreignObject`, animation, external references, style that loads anything and namespaces
 * other than SVG and XLink — and the photos embedded in it lose their metadata. Allowlist based on `svgo/browser`,
 * which runs in Node, Bun and workerd alike. Node-free but not in the browser barrel: svgo is reached through
 * `@conloca/content-api/upload-bytes` only.
 */
import { optimize, type XastChild, type XastElement, type XastParent } from 'svgo/browser';
import { stripImageMetadata } from './image-metadata.js';

/** The largest SVG the sanitiser parses, and the largest it returns once its entities are expanded. */
const MAX_SVG_CHARS = 5 * 1024 * 1024;

/** The largest DOCTYPE internal subset parsed: room for Illustrator's namespace entities (about 1 KB), not a bomb. */
const MAX_DOCTYPE_SUBSET_CHARS = 4 * 1024;

/**
 * Elements kept, filter primitives by their exact names; every other element goes with its subtree, and `a` is
 * unwrapped. A prefixed name (`fe:script`) is never in the list, whatever namespace its prefix is bound to.
 */
const KEPT_ELEMENTS = new Set([
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'textPath',
  'linearGradient',
  'radialGradient',
  'stop',
  'pattern',
  'clipPath',
  'mask',
  'marker',
  'filter',
  'image',
  'style',
  'title',
  'desc',
  'switch',
  'feBlend',
  'feColorMatrix',
  'feComponentTransfer',
  'feComposite',
  'feConvolveMatrix',
  'feDiffuseLighting',
  'feDisplacementMap',
  'feDistantLight',
  'feDropShadow',
  'feFlood',
  'feFuncA',
  'feFuncB',
  'feFuncG',
  'feFuncR',
  'feGaussianBlur',
  'feImage',
  'feMerge',
  'feMergeNode',
  'feMorphology',
  'feOffset',
  'fePointLight',
  'feSpecularLighting',
  'feSpotLight',
  'feTile',
  'feTurbulence',
]);

/** The namespaces an `xmlns` attribute may declare; any other declaration is removed with the attributes using it. */
const KEPT_NAMESPACES = new Set(['http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xlink']);

/** A link may point inside the file or hold an embedded PNG, JPEG or WebP, nothing else. */
const SAFE_HREF = /^(?:#|data:image\/(?:png|jpeg|webp);base64,)/i;

/** A `url(` target that stays inside the file or is an embedded font or PNG, JPEG or WebP. */
const SAFE_URL_TARGET = /^(?:#|data:font\/|data:image\/(?:png|jpeg|webp);base64,)/i;

const URL_TARGET = /url\(\s*['"]?\s*([^'")\s]*)/gi;

/** An embedded raster whose metadata is stripped; Inkscape wraps the base64 over several lines. */
const EMBEDDED_RASTER = /data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=\s]*)/gi;

/** `text` as a URL parser reads its scheme: character references decoded, ASCII whitespace and controls dropped. */
function schemeText(text: string): string {
  const decoded = text.replace(/&#(x[0-9a-f]+|[0-9]+);?/gi, (_reference, code: string) => {
    const point = /^x/i.test(code) ? Number.parseInt(code.slice(1), 16) : Number(code);
    return point <= 0x10ffff ? String.fromCodePoint(point) : '';
  });
  let scheme = '';
  for (const char of decoded) if (char > ' ' && char !== '\x7f') scheme += char;
  return scheme.toLowerCase();
}

/** Style or attribute text that could load something or run script; the attribute or element carrying it is removed. */
function isDangerous(text: string): boolean {
  const lower = text.toLowerCase();
  if (
    lower.includes('@import') ||
    lower.includes('\\') ||
    lower.includes('expression(') ||
    lower.includes('image-set(') ||
    schemeText(text).includes('javascript:')
  ) {
    return true;
  }
  for (const [, target] of text.matchAll(URL_TARGET)) if (!SAFE_URL_TARGET.test(target ?? '')) return true;
  return false;
}

/** `text` with every embedded PNG, JPEG or WebP re-encoded without its metadata; null when one cannot be read. */
function withStrippedRasters(text: string): string | null {
  let unreadable = false;
  const out = text.replace(EMBEDDED_RASTER, (embedded, type: string, data: string) => {
    const format = type.toLowerCase();
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    } catch {
      unreadable = true;
      return embedded;
    }
    const stripped =
      format === 'png' || format === 'jpeg' || format === 'webp' ? stripImageMetadata(bytes, format) : null;
    if (stripped === null) {
      unreadable = true;
      return embedded;
    }
    let binary = '';
    for (let at = 0; at < stripped.length; at += 0x8000) {
      binary += String.fromCharCode(...stripped.subarray(at, at + 0x8000));
    }
    return `data:image/${format};base64,${btoa(binary)}`;
  });
  return unreadable ? null : out;
}

/**
 * The characters the DOCTYPE internal subsets of `text` hold, read as the parser reads them: a `]` or `>` inside quotes
 * ends nothing. Every scan starts where the previous one stopped, so it stays linear.
 */
function doctypeSubsetChars(text: string): number {
  const doctype = /<!DOCTYPE/gi;
  let chars = 0;
  while (doctype.exec(text) !== null) {
    let inSubset = false;
    let quote: string | null = null;
    let at = doctype.lastIndex;
    for (; at < text.length; at += 1) {
      const char = text[at];
      if (inSubset) chars += 1;
      if (quote !== null) {
        if (char === quote) quote = null;
      } else if (char === '"' || char === "'") quote = char;
      else if (inSubset) inSubset = char !== ']';
      else if (char === '[') inSubset = true;
      else if (char === '>') break;
    }
    doctype.lastIndex = at;
  }
  return chars;
}

function detach(node: XastChild, parent: XastParent): void {
  parent.children = parent.children.filter((child) => child !== node);
}

function cleanAttributes(element: XastElement): void {
  for (const [name, value] of Object.entries(element.attributes)) {
    const lower = name.toLowerCase();
    const colon = lower.indexOf(':');
    const prefix = colon === -1 ? '' : lower.slice(0, colon);
    const local = lower.slice(colon + 1);
    const refused =
      prefix === 'xmlns' || lower === 'xmlns'
        ? !KEPT_NAMESPACES.has(value)
        : (prefix !== '' && prefix !== 'xlink' && prefix !== 'xml') ||
          local.startsWith('on') ||
          lower === 'xml:base' ||
          (local === 'href' && !SAFE_HREF.test(value)) ||
          isDangerous(value);
    const cleaned = refused ? null : withStrippedRasters(value);
    if (cleaned === null) delete element.attributes[name];
    else element.attributes[name] = cleaned;
  }
}

/**
 * `text` with only drawing left in it, or `null` when it cannot be parsed, is larger than 5 MiB before or after its
 * entities are expanded, declares more than 4 KB in its DOCTYPE, or its root is not exactly one `<svg>` element.
 * Undeclared namespace prefixes fail the parse; DOCTYPEs are dropped after their internal entities are expanded; an
 * embedded photo that cannot be read goes with the attribute or style holding it.
 */
export function sanitizeSvg(text: string): string | null {
  if (text.length > MAX_SVG_CHARS || doctypeSubsetChars(text) > MAX_DOCTYPE_SUBSET_CHARS) return null;
  let rootIsSvg = false;
  try {
    const { data } = optimize(text, {
      plugins: [
        {
          name: 'conlocaAllowlist',
          fn: () => ({
            doctype: { enter: detach },
            instruction: {
              enter: (node, parent) => {
                if (node.name !== 'xml') detach(node, parent);
              },
            },
            element: {
              enter: (node, parent) => {
                if (node.name === 'a') return;
                const styleText =
                  node.name === 'style'
                    ? node.children.map((child) => ('value' in child ? child.value : '')).join('')
                    : '';
                if (!KEPT_ELEMENTS.has(node.name) || isDangerous(styleText)) {
                  detach(node, parent);
                  return;
                }
                if (node.name === 'style') {
                  for (const child of node.children) {
                    if (!('value' in child)) continue;
                    const cleaned = withStrippedRasters(child.value);
                    if (cleaned === null) {
                      detach(node, parent);
                      return;
                    }
                    child.value = cleaned;
                  }
                }
                cleanAttributes(node);
              },
              exit: (node, parent) => {
                // Unwrapped after its children were cleaned; a new array, so the parent's walk is not disturbed.
                if (node.name === 'a')
                  parent.children = parent.children.flatMap((c) => (c === node ? node.children : [c]));
              },
            },
            root: {
              exit: (root) => {
                const elements = root.children.filter((child) => child.type === 'element');
                rootIsSvg = elements.length === 1 && elements[0]?.name === 'svg';
              },
            },
          }),
        },
      ],
    });
    return rootIsSvg && data.length <= MAX_SVG_CHARS ? data : null;
  } catch {
    return null;
  }
}
