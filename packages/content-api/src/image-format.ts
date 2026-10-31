/**
 * What an upload is, read from its bytes rather than its name: a server stores a file by what it actually holds.
 * Pure and runtime-neutral, so the browser entry can re-export it.
 */

/** The image formats the editors store, by content. */
export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'gif' | 'avif' | 'ico' | 'svg';

/** How much of a text file is read to find its first element: room for a long comment and an Illustrator DOCTYPE. */
const SVG_PROLOG_BYTES = 64 * 1024;

/**
 * True when `text` opens with an optional BOM, then whitespace, the XML declaration, comments, processing
 * instructions and DOCTYPEs, then `<svg`. Each skip searches forward from where the last one ended, so the scan stays
 * linear however the prolog is built (a backtracking pattern took seconds on a few KB of empty comments).
 */
function startsWithSvg(text: string): boolean {
  let at = text.startsWith('\uFEFF') ? 1 : 0;
  const past = (close: string, from: number) => {
    const found = text.indexOf(close, from);
    return found === -1 ? -1 : found + close.length;
  };
  while (at < text.length) {
    if (/\s/.test(text[at] ?? '')) at += 1;
    else if (text.startsWith('<?', at)) at = past('?>', at + 2);
    else if (text.startsWith('<!--', at)) at = past('-->', at + 4);
    else if (text.startsWith('<!DOCTYPE', at)) at = doctypeEnd(text, at);
    else return /^<svg[\s/>]/.test(text.slice(at, at + 5));
    if (at === -1) return false; // never closed
  }
  return false;
}

/** The index just past the `>` that closes the DOCTYPE at `start`, after its internal subset when it has one; -1 if none. */
function doctypeEnd(text: string, start: number): number {
  const close = text.indexOf('>', start);
  if (close === -1) return -1;
  // Looked for only up to that `>`, so a run of DOCTYPEs never rescans the rest of the text.
  const open = text.slice(start, close).indexOf('[');
  if (open === -1) return close + 1;
  const bracket = start + open;
  // The subset ends at the first `]` that only whitespace separates from `>`.
  for (let end = text.indexOf(']', bracket); end !== -1; end = text.indexOf(']', end + 1)) {
    let next = end + 1;
    while (/\s/.test(text[next] ?? '')) next += 1;
    if (text[next] === '>') return next + 1;
  }
  return -1;
}

function ascii(bytes: Uint8Array, start: number, text: string): boolean {
  if (bytes.length < start + text.length) return false;
  for (let i = 0; i < text.length; i += 1) if (bytes[start + i] !== text.charCodeAt(i)) return false;
  return true;
}

/** True when an ISO-BMFF `ftyp` box names an AVIF brand, as its major brand or a compatible one. */
function isAvif(bytes: Uint8Array): boolean {
  if (!ascii(bytes, 4, 'ftyp')) return false;
  const boxEnd = Math.min(new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0), bytes.length);
  for (let brand = 8; brand + 4 <= boxEnd; brand += brand === 8 ? 8 : 4) {
    if (ascii(bytes, brand, 'avif') || ascii(bytes, brand, 'avis')) return true;
  }
  return false;
}

function isSvg(bytes: Uint8Array): boolean {
  let prolog: string;
  try {
    // `stream` holds back a character the cut splits instead of failing on it.
    prolog = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, SVG_PROLOG_BYTES), { stream: true });
  } catch {
    return false;
  }
  return startsWithSvg(prolog);
}

/** The image format `bytes` hold, or `null` when they are no image the editors store. */
export function sniffImageFormat(bytes: Uint8Array): ImageFormat | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (ascii(bytes, 0, '\x89PNG\r\n\x1a\n')) return 'png';
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return 'webp';
  if (ascii(bytes, 0, 'GIF8')) return 'gif';
  if (isAvif(bytes)) return 'avif';
  if (ascii(bytes, 0, '\x00\x00\x01\x00')) return 'ico';
  return isSvg(bytes) ? 'svg' : null;
}
