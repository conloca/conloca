import { describe, expect, test } from 'bun:test';
import { pinTimeZone } from '../../test/time-zone.js';
import {
  buildMetadataUpdate,
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
