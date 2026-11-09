import type { JsonValue } from '../types.js';

/** The file formats the merge engine understands. */
export type MergeKind = 'vxjson' | 'mdx';

/** A JSON value at a path, or `undefined` where the path is absent (a deleted side). */
export type Field = JsonValue | undefined;

/** Three versions of one file; `base` is `undefined` when both sides created it. */
export interface MergeInput {
  kind: MergeKind;
  base: unknown;
  ours: unknown;
  theirs: unknown;
}

/** One clashing target; a side that deleted the value is `undefined`. */
export interface FieldConflict {
  anchor: string;
  base: Field;
  ours: Field;
  theirs: Field;
}

/** A merged value, or one holding every clean merge plus ours at each clash. */
export type MergeResult =
  | { kind: 'merged'; value: JsonValue }
  | { kind: 'conflict'; value: JsonValue; conflicts: FieldConflict[] };

/** One step of a path into a document: an object key, a list item by `props.id`, or a list's order. */
export type AnchorStep = { key: string } | { id: string } | { order: true };
