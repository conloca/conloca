import type { JsonObject, JsonValue } from '../types.js';
import { blockId } from './blocks.js';
import { isRecord, setOwn } from './record.js';
import type { AnchorStep, Field } from './types.js';

export const isId = (id: string | undefined): id is string => id !== undefined;

/**
 * The value at `steps`; missing records on the way read as `undefined`. `null` when a block mid-path is missing, an id
 * or `#order` step finds no list, or a non-container is in the way.
 */
export function readAt(node: Field, steps: AnchorStep[]): { value: Field } | null {
  let current = node;
  for (const [index, step] of steps.entries()) {
    if ('key' in step) {
      if (current === undefined) continue;
      if (!isRecord(current)) return null;
      current = Object.hasOwn(current, step.key) ? current[step.key] : undefined;
      continue;
    }
    if (!Array.isArray(current)) return null;
    if ('order' in step) {
      const ids = current.map(blockId).filter(isId);
      return ids.length === current.length ? { value: ids } : null;
    }
    current = current.find((element) => blockId(element) === step.id);
    if (current === undefined && index < steps.length - 1) return null;
  }
  return { value: current };
}

/** Where a re-added block goes: after the nearest block before it in the base that the list still has. */
function insertionIndex(list: JsonValue[], id: string, baseIds: string[]): number {
  for (let at = baseIds.indexOf(id) - 1; at >= 0; at--) {
    const index = list.findIndex((element) => blockId(element) === baseIds[at]);
    if (index !== -1) return index + 1;
  }
  return baseIds.includes(id) ? 0 : list.length;
}

/**
 * A copy of `node` with `value` at `steps`, copying only the path; `undefined` removes the key or block. A block
 * written where its list lacks it goes to its position in `baseIds`, or to the end.
 */
export function writeAt(node: Field, steps: AnchorStep[], value: Field, baseIds: string[]): Field {
  const [step, ...rest] = steps;
  if (step === undefined) return value;
  if ('key' in step) {
    const record = isRecord(node) ? node : undefined;
    const child = writeAt(
      record && Object.hasOwn(record, step.key) ? record[step.key] : undefined,
      rest,
      value,
      baseIds,
    );
    if (!record && child === undefined) return node;
    // Spread copies an own `__proto__` key as data; `setOwn` writes it without touching the prototype.
    const copy: JsonObject = { ...record };
    if (child === undefined) delete copy[step.key];
    else setOwn(copy, step.key, child);
    return copy;
  }
  const list = Array.isArray(node) ? [...node] : [];
  if ('order' in step) {
    const ids = Array.isArray(value) ? value.filter((id) => typeof id === 'string') : [];
    if (!Array.isArray(value) || ids.length !== value.length) {
      throw new TypeError('applyAnchorValue: an #order value must be a list of ids');
    }
    // Ids the value does not name keep their relative order at the end (the sort is stable).
    const rank = (element: JsonValue) => {
      const at = ids.indexOf(blockId(element) ?? '');
      return at === -1 ? ids.length : at;
    };
    // oxlint-disable-next-line unicorn/no-array-sort -- the target lib predates toSorted; this sorts a fresh local array.
    return list.sort((a, b) => rank(a) - rank(b));
  }
  const index = list.findIndex((element) => blockId(element) === step.id);
  const child = writeAt(index === -1 ? undefined : list[index], rest, value, baseIds);
  if (index === -1) {
    if (child !== undefined) list.splice(insertionIndex(list, step.id, baseIds), 0, child);
  } else if (child === undefined) list.splice(index, 1);
  else list[index] = child;
  return list;
}
