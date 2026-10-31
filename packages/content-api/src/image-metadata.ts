/**
 * Lossless metadata stripping for uploads: EXIF, GPS, XMP, C2PA and anything appended after the image leave a JPEG, PNG
 * or WebP before it is stored, while its pixels, colour profile and orientation stay. Each container is walked by an
 * allowlist of the parts a picture needs; everything else is dropped. Pure and runtime-neutral.
 */

/** A kept run of the input (`[start, end)`) or bytes written for the output. */
type Piece = [start: number, end: number] | Uint8Array;

/** Keep `[start, end)` of the input, joining it to the previous kept run when they touch. */
function keep(pieces: Piece[], start: number, end: number): void {
  const last = pieces.at(-1);
  if (last !== undefined && !(last instanceof Uint8Array) && last[1] === start) last[1] = end;
  else pieces.push([start, end]);
}

/** The output, built once from the pieces; the input itself when nothing was dropped. */
function assemble(bytes: Uint8Array, pieces: readonly Piece[]): Uint8Array {
  const only = pieces[0];
  if (pieces.length === 1 && !(only instanceof Uint8Array) && only[0] === 0 && only[1] === bytes.length) return bytes;
  let size = 0;
  for (const piece of pieces) size += piece instanceof Uint8Array ? piece.length : piece[1] - piece[0];
  const out = new Uint8Array(size);
  let offset = 0;
  for (const piece of pieces) {
    const part = piece instanceof Uint8Array ? piece : bytes.subarray(piece[0], piece[1]);
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function ascii(bytes: Uint8Array, start: number, text: string): boolean {
  if (bytes.length < start + text.length) return false;
  for (let i = 0; i < text.length; i += 1) if (bytes[start + i] !== text.charCodeAt(i)) return false;
  return true;
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** The EXIF Orientation (tag 0x0112 in IFD0) of the TIFF structure at `[start, end)`, or 1 when it has none. */
function tiffOrientation(bytes: Uint8Array, start: number, end: number): number {
  if (end - start < 8) return 1;
  const little = ascii(bytes, start, 'II');
  if (!little && !ascii(bytes, start, 'MM')) return 1;
  const data = view(bytes);
  const ifd = start + data.getUint32(start + 4, little);
  if (ifd + 2 > end) return 1;
  const count = data.getUint16(ifd, little);
  for (let entry = ifd + 2; entry + 12 <= end && entry < ifd + 2 + count * 12; entry += 12) {
    if (data.getUint16(entry, little) === 0x0112 && data.getUint16(entry + 2, little) === 3) {
      const orientation = data.getUint16(entry + 8, little);
      return orientation >= 1 && orientation <= 8 ? orientation : 1;
    }
  }
  return 1;
}

/** A big-endian TIFF holding only IFD0 with one Orientation entry. */
function orientationTiff(orientation: number): Uint8Array {
  // biome-ignore format: one TIFF field per row
  return Uint8Array.from([
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // "MM", 42, IFD0 at 8
    0x00, 0x01, // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00, // Orientation, SHORT, 1 value
    0x00, 0x00, 0x00, 0x00, // no next IFD
  ]);
}

/**
 * JPEG APPn markers kept: APP0 only when it is JFIF (a JFXX one holds a thumbnail with its own EXIF), APP14 (Adobe
 * colour transform), and APP2 only when it is an ICC profile.
 */
const APP0 = 0xe0;
const APP1 = 0xe1;
const APP2 = 0xe2;
const APP14 = 0xee;
const COM = 0xfe;
const SOS = 0xda;
const EOI = 0xd9;

function isRst(marker: number): boolean {
  return marker >= 0xd0 && marker <= 0xd7;
}

function stripJpeg(bytes: Uint8Array): Uint8Array | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const pieces: Piece[] = [];
  keep(pieces, 0, 2);
  let orientation = 1;
  let pos = 2;
  while (pos < bytes.length) {
    if (pos + 2 > bytes.length || bytes[pos] !== 0xff) return null;
    const marker = bytes[pos + 1];
    if (marker === 0xff) {
      pos += 1; // fill byte
      continue;
    }
    if (marker === EOI) {
      keep(pieces, pos, pos + 2);
      break; // everything after the primary image (MPF pictures, Ultra HDR gain maps, trailers) is dropped
    }
    if (marker === 0x01 || isRst(marker)) {
      keep(pieces, pos, pos + 2);
      pos += 2;
      continue;
    }
    if (pos + 4 > bytes.length) return null;
    const length = (bytes[pos + 2] << 8) | bytes[pos + 3];
    const end = pos + 2 + length;
    if (length < 2 || end > bytes.length) return null;
    const dataStart = pos + 4;
    if (marker === APP1) {
      if (ascii(bytes, dataStart, 'Exif\0\0')) orientation = tiffOrientation(bytes, dataStart + 6, end);
    } else if (
      (marker === APP0 && ascii(bytes, dataStart, 'JFIF\0')) ||
      marker === APP14 ||
      (marker === APP2 && ascii(bytes, dataStart, 'ICC_PROFILE\0'))
    ) {
      keep(pieces, pos, end);
    } else if (marker === COM || (marker & 0xf0) === 0xe0) {
      // other APPn and comments: metadata
    } else if (marker === SOS) {
      // The entropy-coded scan runs to the next marker that is neither a stuffed 0xFF00 nor a restart marker.
      let scan = end;
      while (scan < bytes.length) {
        if (bytes[scan] === 0xff && scan + 1 < bytes.length) {
          const next = bytes[scan + 1];
          if (next !== 0x00 && !isRst(next)) break;
          scan += 2;
        } else scan += 1;
      }
      keep(pieces, pos, scan);
      pos = scan;
      continue;
    } else {
      keep(pieces, pos, end); // tables, frame headers and every other structural segment
    }
    pos = end;
  }
  const first = pieces[0];
  if (orientation !== 1 && !(first instanceof Uint8Array)) {
    const tiff = orientationTiff(orientation);
    const segment = new Uint8Array(4 + 6 + tiff.length);
    segment.set([0xff, APP1, 0, 2 + 6 + tiff.length]);
    segment.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4); // "Exif\0\0"
    segment.set(tiff, 10);
    // Right after SOI, or after a kept JFIF APP0 that directly follows it: both always open the first kept run.
    const cut = bytes[3] === APP0 && ascii(bytes, 6, 'JFIF\0') ? 4 + ((bytes[4] << 8) | bytes[5]) : 2;
    const rest: Piece[] = first[1] > cut ? [[cut, first[1]]] : [];
    pieces.splice(0, 1, [0, cut], segment, ...rest);
  }
  return assemble(bytes, pieces);
}

/**
 * PNG chunks a picture needs, its HDR colour (cICP, mDCv, cLLi) included; everything else (eXIf, tEXt/zTXt/iTXt, tIME,
 * caBX, private chunks) is dropped.
 */
const PNG_KEPT = new Set([
  'IHDR',
  'PLTE',
  'IDAT',
  'IEND',
  'tRNS',
  'cHRM',
  'gAMA',
  'iCCP',
  'sBIT',
  'sRGB',
  'bKGD',
  'pHYs',
  'acTL',
  'cICP',
  'mDCv',
  'cLLi',
  'fcTL',
  'fdAT',
]);

function chunkType(bytes: Uint8Array, start: number): string {
  return String.fromCharCode(bytes[start], bytes[start + 1], bytes[start + 2], bytes[start + 3]);
}

function stripPng(bytes: Uint8Array): Uint8Array | null {
  if (!ascii(bytes, 0, '\x89PNG\r\n\x1a\n')) return null;
  const data = view(bytes);
  const pieces: Piece[] = [];
  keep(pieces, 0, 8);
  let pos = 8;
  while (pos + 12 <= bytes.length) {
    const end = pos + 12 + data.getUint32(pos);
    if (end > bytes.length) return null;
    const type = chunkType(bytes, pos + 4);
    if (PNG_KEPT.has(type)) keep(pieces, pos, end);
    if (type === 'IEND') return assemble(bytes, pieces);
    pos = end;
  }
  return null;
}

/** WebP chunks a picture needs; EXIF and XMP and anything unknown are dropped. */
const WEBP_KEPT = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF', 'ICCP']);
const VP8X_EXIF = 0x08;
const VP8X_XMP = 0x04;

function stripWebp(bytes: Uint8Array): Uint8Array | null {
  if (!ascii(bytes, 0, 'RIFF') || !ascii(bytes, 8, 'WEBP')) return null;
  const data = view(bytes);
  const riffEnd = 8 + data.getUint32(4, true);
  if (riffEnd > bytes.length) return null;
  const header = new Uint8Array(12);
  const pieces: Piece[] = [header];
  let vp8x: Uint8Array | null = null;
  let orientation = 1;
  let pos = 12;
  while (pos < riffEnd) {
    if (pos + 8 > riffEnd) return null;
    const size = data.getUint32(pos + 4, true);
    const end = pos + 8 + size + (size & 1);
    if (end > riffEnd) return null;
    const type = chunkType(bytes, pos);
    if (type === 'VP8X') {
      if (size < 10) return null;
      // Copied, not kept: its flags change.
      vp8x = bytes.slice(pos, end);
      pieces.push(vp8x);
    } else if (WEBP_KEPT.has(type)) {
      keep(pieces, pos, end);
    } else if (type === 'EXIF') {
      const tiff = ascii(bytes, pos + 8, 'Exif\0\0') ? pos + 14 : pos + 8;
      orientation = tiffOrientation(bytes, tiff, pos + 8 + size);
    }
    pos = end;
  }
  if (vp8x !== null) {
    vp8x[8] &= ~(VP8X_XMP | VP8X_EXIF);
    if (orientation !== 1) {
      // A simple WebP (no VP8X) cannot carry EXIF, so only an extended one gets its orientation back.
      vp8x[8] |= VP8X_EXIF;
      const tiff = orientationTiff(orientation);
      const chunk = new Uint8Array(8 + tiff.length);
      chunk.set([0x45, 0x58, 0x49, 0x46, tiff.length]); // "EXIF", little-endian size
      chunk.set(tiff, 8);
      pieces.push(chunk);
    }
  }
  let size = 0;
  for (const piece of pieces) size += piece instanceof Uint8Array ? piece.length : piece[1] - piece[0];
  header.set([0x52, 0x49, 0x46, 0x46]); // "RIFF"
  new DataView(header.buffer).setUint32(4, size - 8, true);
  header.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  return assemble(bytes, pieces);
}

/**
 * `bytes` without their metadata, read as `format`: colour profile and orientation kept, pixels untouched. `null` when
 * the container cannot be walked. The output is built once from slices of the input.
 */
export function stripImageMetadata(bytes: Uint8Array, format: 'jpeg' | 'png' | 'webp'): Uint8Array | null {
  if (format === 'jpeg') return stripJpeg(bytes);
  if (format === 'png') return stripPng(bytes);
  return stripWebp(bytes);
}
