import type { FieldConflict, JsonObject, JsonValue } from '@conloca/content-api';
import { formatFieldLabel } from './schema-fields.js';

/** A clashing field's value; `undefined` where that side deleted it. */
type Field = JsonValue | undefined;

/** The field path a clash anchor names: `meta.title`, `frontmatter.title` and `title` are all `title`. */
export function clashPath(anchor: string): string {
  return anchor.replace(/^(meta|frontmatter)\./, '');
}

/** A path of plain keys only; a step into a list (`[id=…]`, `#order`) or a quoted key names no form value. */
const PLAIN_PATH = /^[A-Za-z0-9_$:-]+(\.[A-Za-z0-9_$:-]+)*$/;

/** A value that is a branch of nested fields; the forms hold JSON, as they were read from and write JSON. */
function isBranch(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `branch` with `theirs` at `keys` (removed when they deleted it), copied so the form's own objects stay untouched. */
function setIn(branch: Field, keys: string[], theirs: Field): Field {
  const [key, ...rest] = keys;
  if (key === undefined) return theirs;
  const copy: JsonObject = isBranch(branch) ? { ...branch } : {};
  const own = Object.keys(copy).includes(key) ? copy[key] : undefined;
  const leaf = setIn(own, rest, theirs);
  if (leaf === undefined) delete copy[key];
  // defineProperty: a `__proto__` key must stay a field, not swap the prototype.
  else Object.defineProperty(copy, key, { value: leaf, enumerable: true, configurable: true, writable: true });
  return copy;
}

/**
 * `values` with each clashing field set to their value, where the form keeps it: under a dotted key the form shows
 * (`hintKeys`, e.g. `seo.robots`), else at its path inside the top-level value. A field inside a list has no form key;
 * it keeps the person's value, and the clash message still names it.
 */
export function withTheirs<V>(
  values: Readonly<Record<string, V>>,
  fields: FieldConflict[],
  hintKeys: ReadonlySet<string> = new Set(),
) {
  const loaded = new Map<string, Field>();
  for (const field of fields) {
    const path = clashPath(field.anchor);
    if (hintKeys.has(path)) loaded.set(path, field.theirs);
    else if (PLAIN_PATH.test(path)) {
      const [head = path, ...rest] = path.split('.');
      const current = loaded.has(head) ? loaded.get(head) : values[head];
      loaded.set(head, setIn(isBranch(current) ? current : undefined, rest, field.theirs));
    }
  }
  return { ...values, ...Object.fromEntries(loaded) };
}

/** `Title`, `Title and Tags`, `Title, Tags and Category`. */
function listLabels(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/**
 * An Apply refused because someone else changed the same fields meanwhile; `fields` hold their values (`theirs`), which
 * the dialog loads before the person applies again. `changedBy` names the page's last other editor, not who changed
 * these fields, so the copy never says that person changed them.
 */
export class ApplyClashError extends Error {
  readonly fields: FieldConflict[];
  readonly changedBy: string | undefined;

  constructor(fields: FieldConflict[], changedBy?: string) {
    super();
    this.name = 'ApplyClashError';
    this.fields = fields;
    this.changedBy = changedBy;
    this.message = this.describe(() => undefined);
  }

  /**
   * The message with each field named by `labelOf(path)`, the label its form shows, or else by its last plain key: a
   * field inside a list (`tags[id=x]`) is named by the list.
   */
  describe(labelOf: (path: string) => string | undefined): string {
    const label = (path: string) => {
      const plain = /^[A-Za-z0-9_$:.-]+/.exec(path)?.[0] ?? path;
      return labelOf(path) ?? formatFieldLabel(plain.split('.').pop() ?? plain);
    };
    const labels = [...new Set(this.fields.map((field) => label(clashPath(field.anchor))))];
    const by = this.changedBy ? ` (last edited by ${this.changedBy})` : '';
    return `${listLabels(labels)} changed while you were editing${by}. Check ${labels.length === 1 ? 'it' : 'them'} and apply again.`;
  }
}
