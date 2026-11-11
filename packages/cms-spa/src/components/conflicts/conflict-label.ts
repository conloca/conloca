import { isRecord } from '@conloca/content-api/component-vocabulary';
import { type AnchorStep, parseAnchor, parsePlaceAnchor } from '@conloca/content-api/merge';
import type { Config } from '@puckeditor/core';

/** How a conflict's place reads to a person: a field label, and the component it sits on (`null` for page fields). */
export interface ConflictLabel {
  component: string | null;
  field: string;
}

interface Block {
  type: string;
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- page data as stored; each read checks the field it uses.
  props: Record<string, unknown>;
}

const REMOVED: ConflictLabel = { component: null, field: 'a field on a removed block' };

/* oxlint-disable anti-slop/no-unknown-parameters -- the page data is walked as stored, untyped until each step checks it. */

function asBlock(value: unknown): Block | null {
  if (!isRecord(value) || typeof value.type !== 'string' || !isRecord(value.props)) return null;
  return { type: value.type, props: value.props };
}

/** The block with `props.id === id` in `list`, without looking into slots. */
function listedBlock(list: unknown, id: string): Block | null {
  if (!Array.isArray(list)) return null;
  for (const item of list) {
    const block = asBlock(item);
    if (block?.props.id === id) return block;
  }
  return null;
}

/** The block with `props.id === id` anywhere on the page: the content, legacy zones and every slot inside them. */
function findBlock(lists: unknown[], id: string): Block | null {
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const block = asBlock(item);
      if (!block) continue;
      if (block.props.id === id) return block;
      const nested = findBlock(Object.values(block.props), id);
      if (nested) return nested;
    }
  }
  return null;
}

/* oxlint-enable anti-slop/no-unknown-parameters */

function keyAt(steps: AnchorStep[], index: number): string | undefined {
  const step = steps[index];
  return step !== undefined && 'key' in step ? step.key : undefined;
}

function lastKey(steps: AnchorStep[]): string | undefined {
  return steps.flatMap((step) => ('key' in step ? [step.key] : [])).pop();
}

/** A field on a block, walked by id from `list` through any slots; a block gone from the data or config is removed. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- `list` is page data as stored; listedBlock checks each item.
function blockFieldLabel(steps: AnchorStep[], start: number, list: unknown, config: Config): ConflictLabel {
  let block: Block | null = null;
  let index = start;
  let current = list;
  for (let step = steps[index]; step !== undefined && 'id' in step; step = steps[index]) {
    block = listedBlock(current, step.id);
    if (!block) return REMOVED;
    index += keyAt(steps, index + 1) === 'props' ? 2 : 1;
    const next = steps[index + 1];
    // A key followed by an id is a slot list on this block.
    if (keyAt(steps, index) === undefined || next === undefined || !('id' in next)) break;
    current = block.props[keyAt(steps, index) ?? ''];
    index += 1;
  }
  const component = block ? config.components[block.type] : undefined;
  if (!block || !component) return REMOVED;
  const name = component.label ?? block.type;
  const key = keyAt(steps, index);
  if (key === undefined) return { component: name, field: 'the whole block' };
  const known = component.fields?.[key];
  return { component: name, field: known ? (known.label ?? key) : (lastKey(steps) ?? key) };
}

/**
 * The words for a conflict's anchor (plan 01's grammar) on a page whose Puck data is `data`, with labels from the
 * site's `config`. Never the raw path: an anchor that no longer resolves reads "a field on a removed block".
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- `data` is the editor's Puck data, checked step by step.
export function resolveConflictLabel(anchor: string, data: unknown, config: Config): ConflictLabel {
  if (anchor === '') return { component: null, field: 'the whole page' };
  if (anchor.startsWith('lfs:')) return { component: null, field: anchor.slice('lfs:'.length) };
  if (anchor.startsWith('body#') || anchor.startsWith('body@')) {
    return { component: null, field: 'a paragraph in the text' };
  }
  const page = isRecord(data) ? data : {};
  const zones = isRecord(page.zones) ? page.zones : {};
  const placed = parsePlaceAnchor(anchor);
  if (placed !== null) {
    const block = findBlock([page.content, ...Object.values(zones)], placed);
    const component = block ? config.components[block.type] : undefined;
    if (!block || !component) return REMOVED;
    const name = component.label ?? block.type;
    return { component: name, field: `where ${name} sits` };
  }
  // A non-Puck file type: a Puck one would prefix `content.puckData`, and the data here starts below it.
  const steps = parseAnchor(anchor, null);
  if (steps === null) return REMOVED;
  if (steps.some((step) => 'order' in step)) return { component: null, field: 'the order of blocks' };
  const first = keyAt(steps, 0);
  if (first === 'content') return blockFieldLabel(steps, 1, page.content, config);
  if (first === 'zones') return blockFieldLabel(steps, 2, zones[keyAt(steps, 1) ?? ''], config);
  if (first === 'root') {
    const key = keyAt(steps, 1) === 'props' ? keyAt(steps, 2) : keyAt(steps, 1);
    const known = key === undefined ? undefined : config.root?.fields?.[key];
    return { component: null, field: known?.label ?? key ?? 'the page settings' };
  }
  if (steps.length === 1 && (first === 'frontmatter' || first === 'meta')) {
    return { component: null, field: 'the page settings' };
  }
  return { component: null, field: lastKey(steps) ?? anchor };
}
