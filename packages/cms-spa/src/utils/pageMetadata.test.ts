import { afterEach, describe, expect, test } from 'bun:test';
import { pinTimeZone } from '../../test/time-zone.js';
import {
  buildMetadataUpdate,
  extractPageMetadata,
  flattenForHints,
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
  unflattenFromHints,
} from './pageMetadata.js';

describe('dotted hint keys round-trip', () => {
  // A host declares hints for some keys of a nested frontmatter object
  // ('sidebar.label'), never all of them. Flattening used to drop the whole
  // branch, and unflattening rebuilt only the hinted leaves — so opening page
  // settings to change one unrelated field and pressing Save deleted the
  // author's `order` and `badge` from the file, with nothing to connect the
  // loss to the save that caused it.
  const hintKeys: ReadonlySet<string> = new Set(['sidebar.label']);

  test('keeps sibling keys the host did not declare a hint for', () => {
    const stored = {
      title: 'Docs',
      sidebar: { label: 'Docs', order: 3, badge: { text: 'New', variant: 'tip' } },
    };

    const roundTripped = unflattenFromHints(flattenForHints(stored, hintKeys));

    expect(roundTripped.sidebar).toEqual({ label: 'Docs', order: 3, badge: { text: 'New', variant: 'tip' } });
    expect(roundTripped.title).toBe('Docs');
  });

  test('an edit to a hinted leaf survives without disturbing its siblings', () => {
    const stored = { sidebar: { label: 'Old', order: 3 } };

    const flat = flattenForHints(stored, hintKeys);
    expect(flat['sidebar.label']).toBe('Old');
    flat['sidebar.label'] = 'New';

    expect(unflattenFromHints(flat).sidebar).toEqual({ label: 'New', order: 3 });
  });

  test('drops the branch entirely when the hints cover all of it', () => {
    const stored = { sidebar: { label: 'Docs' } };

    expect(unflattenFromHints(flattenForHints(stored, hintKeys)).sidebar).toEqual({ label: 'Docs' });
  });

  test('leaves undotted keys alone', () => {
    const stored = { title: 'Docs', draft: true };

    expect(unflattenFromHints(flattenForHints(stored, hintKeys))).toEqual({ title: 'Docs', draft: true });
  });
});

describe('hostile frontmatter keys', () => {
  // Frontmatter keys come from content files, so a key like `__proto__.x` can
  // arrive from an author (or a contributor's pull request) and must never walk
  // into Object.prototype while the page-settings form rebuilds the tree.
  afterEach(() => {
    Reflect.deleteProperty(Object.prototype, 'polluted');
  });

  test('a `__proto__` path does not pollute Object.prototype', () => {
    const hostile: Record<string, unknown> = JSON.parse('{"__proto__.polluted":"yes","title":"Docs"}');

    const result = unflattenFromHints(hostile);

    expect(Object.getOwnPropertyDescriptor(Object.prototype, 'polluted')).toBeUndefined();
    expect(result.title).toBe('Docs');
  });

  test('a `constructor.prototype` path does not pollute Object.prototype', () => {
    const hostile: Record<string, unknown> = JSON.parse('{"constructor.prototype.polluted":"yes"}');

    unflattenFromHints(hostile);

    expect(Object.getOwnPropertyDescriptor(Object.prototype, 'polluted')).toBeUndefined();
  });

  test('nests the hostile dotted key as own data instead of dropping the author data', () => {
    const hostile: Record<string, unknown> = JSON.parse('{"__proto__.polluted":"yes"}');

    const result = unflattenFromHints(hostile);

    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(result, '__proto__')?.value).toEqual({ polluted: 'yes' });
  });

  test('a nested key named `prototype` or `constructor` still round-trips', () => {
    const stored = { widget: { prototype: 'old', constructor: 'kept', label: 'L' } };
    const hints: ReadonlySet<string> = new Set(['widget.prototype', 'widget.constructor']);

    const widget = unflattenFromHints(flattenForHints(stored, hints)).widget;

    expect(Object.getOwnPropertyDescriptor(widget, 'prototype')?.value).toBe('old');
    expect(Object.getOwnPropertyDescriptor(widget, 'constructor')?.value).toBe('kept');
    expect(Object.getOwnPropertyDescriptor(widget, 'label')?.value).toBe('L');
  });

  // A bare `__proto__` key assigned with `obj[key] = value` runs the prototype
  // setter: the author's value vanishes and the target's prototype changes.
  test('a bare `__proto__` key stays an own data key through unflattenFromHints', () => {
    const hostile: Record<string, unknown> = JSON.parse('{"__proto__":{"polluted":"yes"}}');

    const result = unflattenFromHints(hostile);

    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(result, '__proto__')?.value).toEqual({ polluted: 'yes' });
  });

  test('a nested `__proto__` key survives pruning a hinted sibling', () => {
    const stored: Record<string, unknown> = JSON.parse('{"sidebar":{"label":"L","__proto__":{"kept":"v"}}}');
    const hints: ReadonlySet<string> = new Set(['sidebar.label']);

    const sidebar = unflattenFromHints(flattenForHints(stored, hints)).sidebar;

    expect(Object.getPrototypeOf(sidebar)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(sidebar, '__proto__')?.value).toEqual({ kept: 'v' });
    expect(Object.getOwnPropertyDescriptor(sidebar, 'label')?.value).toBe('L');
  });

  test('a bare `__proto__` meta key round-trips through page settings as data', () => {
    const meta = JSON.parse('{"title":"Docs","__proto__":{"polluted":"yes"}}');

    const metadata = extractPageMetadata({ meta, pathname: '/docs' }, null);
    const payload = buildMetadataUpdate(metadata);

    expect(Object.getPrototypeOf(metadata.customMeta)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(metadata.customMeta, '__proto__')?.value).toEqual({ polluted: 'yes' });
    expect(Object.getOwnPropertyDescriptor(payload.meta, '__proto__')?.value).toEqual({ polluted: 'yes' });
  });
});

describe('datetime-local conversion', () => {
  // A fixed offset far from UTC, so local and UTC digits differ: UTC−12
  // (Etc/GMT+12; POSIX signs are reversed), where nobody lives.
  pinTimeZone('Etc/GMT+12');

  test('toDatetimeLocalValue uses local hours, not UTC', () => {
    const stored = new Date('2026-09-15T05:00:00.000Z');
    expect(toDatetimeLocalValue(stored)).toBe('2026-09-14T17:00');
  });

  test('round-tripping a stored instant through the picker keeps it', () => {
    const stored = new Date('2026-09-15T05:00:00.000Z');
    expect(fromDatetimeLocalValue(toDatetimeLocalValue(stored))?.toISOString()).toBe(stored.toISOString());
  });

  test('an empty picker value means the date was cleared', () => {
    expect(fromDatetimeLocalValue('')).toBeNull();
    expect(fromDatetimeLocalValue(undefined)).toBeNull();
  });
});

describe('buildMetadataUpdate clear semantics', () => {
  test('cleared fields become explicit nulls so the server can clear them', () => {
    // Undefined keys are dropped by JSON.stringify, so the server's merge
    // kept the old description/robots/canonical — the dialog reported
    // success and the cleared field reappeared on refresh. Null is the wire
    // form of "clear"; the empty string matches it because the vxjson
    // serializer never stores '' anyway (clearing removes the key).
    const payload = buildMetadataUpdate({
      title: 'Kept',
      description: undefined,
      robots: '',
      canonical: undefined,
      pathname: '/p',
      customMeta: { author: '', tags: ['x'] },
    } as never);

    expect(payload.meta.title).toBe('Kept');
    expect(payload.meta.description).toBeNull();
    expect(payload.meta.robots).toBeNull();
    expect(payload.meta.canonical).toBeNull();
    expect(payload.meta.author).toBeNull();
    expect(payload.meta.tags).toEqual(['x']);
  });
});
