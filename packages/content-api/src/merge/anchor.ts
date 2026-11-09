import { digestHex } from './sha256.js';
import type { AnchorStep, Field } from './types.js';

const PLAIN_KEY = /^[A-Za-z0-9_$:-]+$/;
const PLAIN_PREFIX = /^[A-Za-z0-9_$:-]+/;
const JSON_STRING_PREFIX = /^"(?:[^"\\]|\\.)*"/;
const PUCK_PREFIX: AnchorStep[] = [{ key: 'content' }, { key: 'puckData' }];

const quote = (text: string) => (PLAIN_KEY.test(text) ? text : `[${JSON.stringify(text)}]`);

/** Writes a path in the anchor grammar; Puck files drop the `content.puckData` prefix. */
export function formatAnchor(steps: AnchorStep[], fileType: Field): string {
  const first = steps[0];
  const second = steps[1];
  const puckBody =
    fileType === 'puck' &&
    steps.length > 2 &&
    first !== undefined &&
    'key' in first &&
    first.key === 'content' &&
    second !== undefined &&
    'key' in second &&
    second.key === 'puckData';
  let anchor = '';
  for (const step of puckBody ? steps.slice(2) : steps) {
    if ('order' in step) anchor += '#order';
    else if ('id' in step) anchor += `[id=${quote(step.id)}]`;
    else if (PLAIN_KEY.test(step.key)) anchor += anchor === '' ? step.key : `.${step.key}`;
    else anchor += quote(step.key);
  }
  return anchor;
}

/** Reads a plain or quoted name at the start of `rest`; quoted names must need the quotes. */
function readName(rest: string): { name: string; length: number } | null {
  const plain = PLAIN_PREFIX.exec(rest);
  if (plain) return { name: plain[0], length: plain[0].length };
  const quoted = rest.startsWith('[') ? JSON_STRING_PREFIX.exec(rest.slice(1)) : null;
  if (!quoted || rest[quoted[0].length + 1] !== ']') return null;
  let name: unknown;
  try {
    name = JSON.parse(quoted[0]);
  } catch {
    return null; // a bad escape or raw control character
  }
  if (typeof name !== 'string' || PLAIN_KEY.test(name)) return null;
  return { name, length: quoted[0].length + 2 };
}

/** The inverse of `formatAnchor`; `null` for a malformed anchor or a `body…` anchor. */
export function parseAnchor(anchor: string, fileType: Field): AnchorStep[] | null {
  if (anchor.startsWith('body#') || anchor.startsWith('body@')) return null;
  const steps: AnchorStep[] = [];
  let rest = anchor;
  while (rest !== '') {
    if (rest === '#order' && steps.length > 0) {
      steps.push({ order: true });
      rest = '';
    } else if (rest.startsWith('[id=')) {
      const id = readName(rest.slice(4));
      if (!id || rest[id.length + 4] !== ']' || steps.length === 0) return null;
      steps.push({ id: id.name });
      rest = rest.slice(id.length + 5);
    } else {
      // A plain key needs a leading dot unless it starts the anchor; a quoted key never takes one.
      const body = steps.length > 0 && rest.startsWith('.') ? rest.slice(1) : rest;
      if (steps.length > 0 && (body === rest ? !rest.startsWith('[') : body.startsWith('['))) return null;
      const key = readName(body);
      if (!key) return null;
      steps.push({ key: key.name });
      rest = body.slice(key.length);
    }
  }
  const [first, second] = steps;
  const puckBody =
    fileType === 'puck' &&
    first !== undefined &&
    'key' in first &&
    ((first.key === 'content' && (second === undefined || !('key' in second))) ||
      first.key === 'root' ||
      first.key === 'zones');
  return puckBody ? [...PUCK_PREFIX, ...steps] : steps;
}

const PLACE_SUFFIX = ']#place';

/** The anchor of where a Puck block sits on the page, whichever list holds it: `[id=<props.id>]#place`. */
export function formatPlaceAnchor(id: string): string {
  return `[id=${quote(id)}${PLACE_SUFFIX}`;
}

/** The block id of a `formatPlaceAnchor` anchor, or `null` for any other anchor. */
export function parsePlaceAnchor(anchor: string): string | null {
  if (!anchor.startsWith('[id=') || !anchor.endsWith(PLACE_SUFFIX)) return null;
  const id = readName(anchor.slice(4));
  return id && anchor.slice(4 + id.length) === PLACE_SUFFIX ? id.name : null;
}

/** Storage form of a conflict side: a deletion is SQL `NULL`, anything else JSON text. */
export function encodeConflictValue(value: Field): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

/** The inverse of `encodeConflictValue`. */
export function decodeConflictValue(stored: string | null): Field {
  return stored === null ? undefined : JSON.parse(stored);
}

/**
 * The reference of each base block, `<hash of its text>[~n]`, where `~n` is the 0-based occurrence when that text
 * repeats in the base. Counts and occurrences are computed once, so referencing many regions stays linear.
 */
export function blockRefs(blocks: string[]): (index: number) => string {
  const counts = new Map<string, number>();
  const occurrences = blocks.map((block) => {
    const seen = counts.get(block) ?? 0;
    counts.set(block, seen + 1);
    return seen;
  });
  return (index) => {
    const text = blocks[index] ?? '';
    const repeats = (counts.get(text) ?? 0) > 1;
    return `${digestHex(text).slice(0, 16)}${repeats ? `~${occurrences[index] ?? 0}` : ''}`;
  };
}

/** The anchor of a body region of `length` base blocks from `start`; built only from base text so it never moves. */
export function bodyAnchor(region: { ref: (index: number) => string; start: number; length: number }): string {
  const { ref, start, length } = region;
  if (length === 0) return start === 0 ? 'body@start' : `body@after#${ref(start - 1)}`;
  return `body#${ref(start)}${length > 1 ? `+${length}` : ''}`;
}

const BODY_ANCHOR = /^body(?:(@start)|@after#([0-9a-f]{16})(?:~(\d+))?|#([0-9a-f]{16})(?:~(\d+))?(?:\+([1-9]\d*))?)$/;

/** The inverse of `bodyAnchor` against the same base blocks; `null` when malformed or naming no base block. */
export function parseBodyAnchor(anchor: string, baseBlocks: string[]): { start: number; length: number } | null {
  const match = BODY_ANCHOR.exec(anchor);
  if (!match) return null;
  const [, atStart, afterHash, afterOccurrence, hash, occurrence, count] = match;
  if (atStart) return { start: 0, length: 0 };
  const find = (wanted: string | undefined, nth: string | undefined) => {
    let seen = 0;
    return baseBlocks.findIndex((block) => digestHex(block).slice(0, 16) === wanted && seen++ === Number(nth ?? 0));
  };
  if (afterHash) {
    const index = find(afterHash, afterOccurrence);
    return index === -1 ? null : { start: index + 1, length: 0 };
  }
  const index = find(hash, occurrence);
  const length = Number(count ?? 1);
  return index === -1 || index + length > baseBlocks.length ? null : { start: index, length };
}
