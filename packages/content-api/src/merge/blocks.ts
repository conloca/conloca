import type { JsonValue } from '../types.js';
import { formatAnchor } from './anchor.js';
import { type DiffField, deepEqual, isRecord, type MergeField, type WalkContext } from './record.js';
import type { AnchorStep, Field } from './types.js';

/** The `props.id` of a Puck block, or `undefined` when the element is not one. */
export function blockId(element: Field): string | undefined {
  if (!isRecord(element) || typeof element.type !== 'string' || !isRecord(element.props)) return undefined;
  const id = element.props.id;
  return typeof id === 'string' ? id : undefined;
}

const isKeyStep = (step: AnchorStep | undefined, key: string) =>
  step !== undefined && 'key' in step && step.key === key;

const sameOrder = (x: string[], y: string[]) => x.join('\0') === y.join('\0');

/** Whether `steps` points at a Puck block list: `content`, `zones.<key>`, or any list under a block's `props`. */
function isBlockListPath(steps: AnchorStep[]): boolean {
  const [first, second, ...rest] = steps;
  if (!isKeyStep(first, 'content') || !isKeyStep(second, 'puckData')) return false;
  if (rest.length === 1 && isKeyStep(rest[0], 'content')) return true;
  if (rest.length === 2 && isKeyStep(rest[0], 'zones')) return true;
  return rest.some((step, index) => 'id' in step && isKeyStep(rest[index + 1], 'props'));
}

/**
 * Whether the list at `steps` merges per `props.id`: a Puck block-list path, and every present side an array of blocks
 * with unique ids. Any other list, or a hand-edited one with a missing or duplicate id, stays one atomic value (D4).
 */
export function idKeyedListAt(steps: AnchorStep[], fileType: Field, sides: Field[]): boolean {
  if (fileType !== 'puck' || !isBlockListPath(steps)) return false;
  return sides.every((side) => {
    if (side === undefined) return true;
    if (!Array.isArray(side)) return false;
    const ids = side.map(blockId);
    return ids.every((id) => id !== undefined) && new Set(ids).size === ids.length;
  });
}

/** The blocks of a list `idKeyedListAt` accepted (an absent side is empty), by id in list order. */
function byId(list: Field): Map<string, JsonValue> {
  const map = new Map<string, JsonValue>();
  for (const element of Array.isArray(list) ? list : []) map.set(blockId(element) ?? '', element);
  return map;
}

/**
 * 3-way merge of a Puck block list by `props.id`: blocks merge field by field wherever they moved, one-sided adds and
 * deletes land, delete-versus-edit and two different reorders are reported at the block and at `#order`.
 */
export function mergeIdKeyedList(
  steps: AnchorStep[],
  base: Field,
  ours: Field,
  theirs: Field,
  ctx: WalkContext,
  mergeJson: MergeField,
): JsonValue[] {
  const [b, o, t] = [byId(base), byId(ours), byId(theirs)];
  const merged = new Map<string, JsonValue>();
  for (const id of new Set([...b.keys(), ...o.keys(), ...t.keys()])) {
    const [bv, ov, tv] = [b.get(id), o.get(id), t.get(id)];
    const idSteps = [...steps, { id }];
    let value: Field;
    if (bv === undefined || (ov !== undefined && tv !== undefined)) value = mergeJson(idSteps, bv, ov, tv, ctx);
    else if (ov === undefined && tv === undefined) value = undefined;
    else if (deepEqual(bv, ov ?? tv)) value = undefined;
    else {
      ctx.conflicts.push({ anchor: formatAnchor(idSteps, ctx.fileType), base: bv, ours: ov, theirs: tv });
      value = ov;
    }
    if (value !== undefined) merged.set(id, value);
  }

  const common = (side: Map<string, JsonValue>) => [...side.keys()].filter((id) => b.has(id) && o.has(id) && t.has(id));
  const [bo, oo, to] = [common(b), common(o), common(t)];
  const clash = !sameOrder(oo, bo) && !sameOrder(to, bo) && !sameOrder(oo, to);
  const order = sameOrder(oo, bo) ? to : oo;

  // Blocks a side added, plus one ours kept by editing it while theirs deleted it, go after their nearest kept predecessor.
  const inserted = new Set<string>();
  for (const side of [o, t]) {
    const sideIds = [...side.keys()];
    sideIds.forEach((id, index) => {
      if (order.includes(id) || !merged.has(id)) return;
      const pred = sideIds
        .slice(0, index)
        // oxlint-disable-next-line unicorn/no-array-reverse -- the target lib predates toReversed; this reverses a fresh slice.
        .reverse()
        .find((earlier) => order.includes(earlier));
      let at = pred === undefined ? 0 : order.indexOf(pred) + 1;
      // Ids inserted at the same spot sort by id; a run of them sits right after `pred`.
      while (at < order.length && inserted.has(order[at] ?? '') && (order[at] ?? '') < id) at++;
      order.splice(at, 0, id);
      inserted.add(id);
    });
  }

  const kept = order.filter((id) => merged.has(id));
  const result = kept.flatMap((id) => merged.get(id) ?? []);
  if (clash) {
    // F5: full lists, with ours as the merged order, so the anchor reads back what `value` holds.
    ctx.conflicts.push({
      anchor: formatAnchor([...steps, { order: true }], ctx.fileType),
      base: [...b.keys()],
      ours: kept,
      theirs: [...t.keys()],
    });
  }
  return result;
}

/**
 * The anchors `next` changed in a list `idKeyedListAt` accepted: inside kept blocks, `[id=X]` per added or removed
 * block, `#order` when the blocks both versions hold moved.
 */
export function diffIdKeyedList(
  steps: AnchorStep[],
  base: Field,
  next: Field,
  ctx: Omit<WalkContext, 'conflicts'>,
  out: string[],
  diffJson: DiffField,
): void {
  const [b, n] = [byId(base), byId(next)];
  for (const id of new Set([...b.keys(), ...n.keys()])) {
    const idSteps = [...steps, { id }];
    if (b.has(id) && n.has(id)) diffJson(idSteps, b.get(id), n.get(id), ctx, out);
    else out.push(formatAnchor(idSteps, ctx.fileType));
  }
  const common = (side: Map<string, JsonValue>) => [...side.keys()].filter((id) => b.has(id) && n.has(id));
  if (!sameOrder(common(b), common(n))) out.push(formatAnchor([...steps, { order: true }], ctx.fileType));
}
