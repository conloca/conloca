import { describe, expect, test } from 'bun:test';
import type { ContentMeta } from '@conloca/content-api-client';
import { editableEntryMeta, entryMetaPatch } from './entry-meta.js';

describe('editableEntryMeta', () => {
  test('reads back every field the properties dialog can write', () => {
    // The dialog always saves all four fields, so any field the list fails to
    // read arrives undefined and overwrites the stored value on save.
    const meta = {
      title: 'Pricing',
      description: 'Plan comparison',
      category: 'marketing',
      tags: ['pricing', 'plans'],
    } as ContentMeta;

    expect(editableEntryMeta(meta, 'fallback')).toEqual({
      title: 'Pricing',
      description: 'Plan comparison',
      category: 'marketing',
      tags: ['pricing', 'plans'],
    });
  });

  test('falls back to the supplied title when none is stored', () => {
    expect(editableEntryMeta({} as ContentMeta, 'entry-id')?.title).toBe('entry-id');
  });

  test('drops a hand-edited non-string category rather than showing it in a text field', () => {
    const meta = { title: 'T', category: 42, tags: ['a', 7, 'b'] } as unknown as ContentMeta;
    const result = editableEntryMeta(meta, 'fallback');

    expect(result?.category).toBeUndefined();
    expect(result?.tags).toEqual(['a', 'b']);
  });

  test('turns the dialog fields into a patch where cleared means null, not absent', () => {
    // The dialog owns these four fields and always saves all of them. A
    // cleared field used to travel as undefined, which JSON.stringify drops,
    // so the server's merge kept the old value — the save reported success
    // and the field reappeared on refresh. Null is the wire form of "clear".
    expect(entryMetaPatch({ title: 'Kept', description: undefined, category: undefined, tags: undefined })).toEqual({
      title: 'Kept',
      description: null,
      category: null,
      tags: null,
    });

    expect(entryMetaPatch({ title: 'T', description: 'd', category: 'c', tags: ['x'] })).toEqual({
      title: 'T',
      description: 'd',
      category: 'c',
      tags: ['x'],
    });
  });

  test('returns undefined when there is no stored metadata at all', () => {
    expect(editableEntryMeta(undefined, 'fallback')).toBeUndefined();
  });
});
