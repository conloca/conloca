import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import type { ContentData } from '@conloca/content-api';
import { applyItemChanges, hydrateDoc, type ItemIds, readItemIds, serializeDoc } from '@conloca/content-api/ydoc';
import { renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import * as Y from 'yjs';
import { createFakeDocChannel } from '../../test/fake-doc-channel.js';
import { configureUI } from '../ui-config.js';
import {
  createDataBinding,
  dropHeldDataValues,
  hasHeldDataValues,
  useLiveDataValues,
  writeDataValues,
} from './data-binding.js';
import { HELD_WRITE_FAILED } from './doc-channel.js';

type Values = NonNullable<ContentData['data']>;

const dataOf = (doc: Y.Doc): Values => serializeDoc(doc).data ?? {};

/** Fails for a `price` that is not a number, as a schema would. */
const validate = (values: Values) =>
  values.price === undefined || typeof values.price === 'number' ? null : 'Fix these fields before saving: price';
const any = () => null;
/** Fails for a blank tag. */
const noBlank = (values: Values) =>
  Array.isArray(values.tags) && values.tags.includes('') ? 'Fix these fields before saving: tags' : null;

function pair(data: Values) {
  const a = hydrateDoc({ data });
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  return { a, b, ids: readItemIds(a) };
}

function exchange(a: Y.Doc, b: Y.Doc): void {
  const fromA = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
  const fromB = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
  Y.applyUpdate(b, fromA);
  Y.applyUpdate(a, fromB);
}

interface View {
  data: Values;
  ids: ItemIds;
}

/** Writes `next` over `view` as the binding does, and returns the view after it (the write's ids, no re-seed). */
function edit(doc: Y.Doc, view: View, next: Values): View {
  const written = writeDataValues(doc, view.data, view.ids, next, any);
  if (!written.ok) throw new Error(written.error);
  return { data: written.written, ids: written.ids };
}

async function openData(data: Values, id = 'd1') {
  const fake = createFakeDocChannel({ data });
  configureUI({ docChannel: fake.channel });
  const live = await fake.channel.open({ kind: 'data', id, locale: 'en' });
  return { fake, live };
}

afterEach(() => {
  dropHeldDataValues();
  configureUI({ docChannel: undefined });
});

describe('writeDataValues', () => {
  it('writes the valid keys and holds only the invalid one', () => {
    const { a, ids } = pair({ name: 'a', price: 1 });
    const result = writeDataValues(a, { name: 'a', price: 1 }, ids, { name: 'b', price: 'x' }, validate);
    expect(result).toMatchObject({ ok: true, held: { price: 'Fix these fields before saving: price' } });
    expect(dataOf(a)).toEqual({ name: 'b', price: 1 });
  });

  it('keeps a teammate edit to another field while typing', () => {
    const { a, b, ids } = pair({ name: 'a', price: 1 });
    edit(a, { data: { name: 'a', price: 1 }, ids }, { name: 'A', price: 1 });
    edit(b, { data: { name: 'a', price: 1 }, ids }, { name: 'a', price: 2 });
    exchange(a, b);
    for (const doc of [a, b]) expect(dataOf(doc)).toEqual({ name: 'A', price: 2 });
  });

  it('keeps a remote edit to another key that the editor has not shown yet', () => {
    const { a, ids } = pair({ name: 'a', price: 1 });
    edit(a, { data: dataOf(a), ids }, { name: 'a', price: 2 });
    edit(a, { data: { name: 'a', price: 1 }, ids }, { name: 'b', price: 1 });
    expect(dataOf(a)).toEqual({ name: 'b', price: 2 });
  });

  it('keeps edits to different items of one array from two editors', () => {
    const listed = { links: [{ label: 'a' }, { label: 'b' }] };
    const { a, b, ids } = pair(listed);
    edit(a, { data: listed, ids }, { links: [{ label: 'A' }, { label: 'b' }] });
    edit(b, { data: listed, ids }, { links: [{ label: 'a' }, { label: 'B' }] });
    exchange(a, b);
    for (const doc of [a, b]) expect(dataOf(doc).links).toEqual([{ label: 'A' }, { label: 'B' }]);
  });

  it('keeps an edit to an item a teammate moved', () => {
    const listed = { links: [{ label: 'a' }, { label: 'b' }, { label: 'c' }] };
    const { a, b, ids } = pair(listed);
    edit(a, { data: listed, ids }, { links: [{ label: 'c' }, { label: 'a' }, { label: 'b' }] });
    exchange(a, b);
    edit(b, { data: listed, ids }, { links: [{ label: 'a' }, { label: 'b' }, { label: 'C' }] });
    exchange(a, b);
    for (const doc of [a, b]) expect(dataOf(doc).links).toEqual([{ label: 'C' }, { label: 'a' }, { label: 'b' }]);
  });

  it("keeps a teammate's insert the view had not shown", () => {
    const listed = { links: [{ label: 'a' }, { label: 'b' }] };
    const { a, b, ids } = pair(listed);
    edit(b, { data: listed, ids }, { links: [{ label: 'a' }, { label: 'new' }, { label: 'b' }] });
    exchange(a, b);
    edit(a, { data: listed, ids }, { links: [{ label: 'a' }, { label: 'B' }] });
    expect(dataOf(a).links).toEqual([{ label: 'a' }, { label: 'new' }, { label: 'B' }]);
  });

  it('edits the item the user edited, not an equal copy', () => {
    const listed = { links: [{ label: 'same' }, { label: 'same' }] };
    const { a, b, ids } = pair(listed);
    edit(b, { data: listed, ids }, { links: [{ label: 'same' }, { label: 'same' }, { label: 'same' }] });
    exchange(a, b);
    edit(a, { data: listed, ids }, { links: [{ label: 'same' }, { label: 'mine' }] });
    exchange(a, b);
    const [name, shownIds] = Object.entries(ids).find(([, list]) => list.length === 2) ?? [];
    const edited = shownIds?.[1];
    for (const doc of [a, b]) {
      const at = readItemIds(doc)[name ?? '']?.indexOf(edited ?? '') ?? -1;
      const links = dataOf(doc).links;
      if (!Array.isArray(links)) throw new Error('no links');
      expect(links[at]).toEqual({ label: 'mine' });
      expect(links.filter((link: { label: string }) => link.label === 'same')).toHaveLength(2);
    }
  });

  it('edits the tag the user edited after a teammate inserted one before it', () => {
    const tagged = { tags: ['red', 'blue'] };
    const { a, b, ids } = pair(tagged);
    edit(b, { data: tagged, ids }, { tags: ['green', 'red', 'blue'] });
    exchange(a, b);
    edit(a, { data: tagged, ids }, { tags: ['red', 'navy'] });
    exchange(a, b);
    for (const doc of [a, b]) expect(dataOf(doc).tags).toEqual(['green', 'red', 'navy']);
  });

  it('writes typing into a just-inserted item into that item', () => {
    const listed = { links: [{ label: 'a' }] };
    const { a, ids } = pair(listed);
    let view = edit(a, { data: listed, ids }, { links: [{ label: 'a' }, { label: '' }] });
    view = edit(a, view, { links: [{ label: 'a' }, { label: 'T' }] });
    edit(a, view, { links: [{ label: 'a' }, { label: 'Ty' }] });
    expect(dataOf(a).links).toEqual([{ label: 'a' }, { label: 'Ty' }]);
  });

  it('writes nothing when the editor echoes what it was shown', () => {
    const { a, ids } = pair({ name: 'a' });
    const seen: unknown[] = [];
    a.on('update', () => seen.push(1));
    expect(writeDataValues(a, { name: 'a' }, ids, { name: 'a' }, validate)).toMatchObject({ ok: true, held: {} });
    expect(seen).toEqual([]);
  });

  it('answers not ok and writes nothing for a value that is not JSON', () => {
    const { a, ids } = pair({ name: 'a', links: [{ label: 'a' }] });
    const seen: unknown[] = [];
    a.on('update', () => seen.push(1));
    const next = { name: new Date(0), links: [{ label: 'a' }, { label: 'new' }] };
    expect(writeDataValues(a, dataOf(a), ids, next, any)).toMatchObject({ ok: false });
    expect(seen).toEqual([]);
  });
});

describe('createDataBinding', () => {
  it('keeps a held key through a rebind', async () => {
    const { fake, live } = await openData({ name: 'a', price: 1 });
    const binding = createDataBinding(live, validate, 'd1:en');
    binding.change({ name: 'a', price: 'x' });
    expect(binding.values).toEqual({ name: 'a', price: 'x' });
    expect(hasHeldDataValues()).toBe(true);
    const moved: (typeof live)[] = [];
    fake.channel.on('replaced', (event) => moved.push(event.live));
    fake.replace(live.docKey, { data: { name: 'a', price: 1 } });
    const [next] = moved;
    if (!next) throw new Error('not replaced');
    const rebound = createDataBinding(next, validate, 'd1:en');
    expect(rebound.values).toEqual({ name: 'a', price: 'x' });
    expect(rebound.errors).toEqual({ price: 'Fix these fields before saving: price' });
    expect(dataOf(next.doc).price).toBe(1);
  });

  it('keeps held keys over a remote update and writes a fixed one', async () => {
    const { fake, live } = await openData({ name: 'a', price: 1 });
    const binding = createDataBinding(live, validate, 'd1:en');
    binding.change({ name: 'a', price: 'x' });
    fake.parentEdit(live.docKey, (doc) => doc.getMap('data').set('name', 'theirs'));
    expect(binding.reseed()).toEqual({ name: 'theirs', price: 'x' });
    binding.change({ name: 'theirs', price: 5 });
    expect(dataOf(live.doc)).toEqual({ name: 'theirs', price: 5 });
    expect(binding.errors).toEqual({});
    expect(hasHeldDataValues()).toBe(false);
  });

  it('tells the channel about held values, and lets them go', async () => {
    const { fake, live } = await openData({ name: 'a', price: 1 });
    const binding = createDataBinding(live, validate, 'd1:en');
    binding.change({ name: 'a', price: 'x' });
    expect(fake.channel.held()).not.toBeNull();
    binding.change({ name: 'a', price: 2 });
    expect(fake.channel.held()).toBeNull();
  });

  it('holds the view when the doc write throws', async () => {
    const { fake, live } = await openData({ name: 'a' });
    const binding = createDataBinding(live, any, 'd1:en');
    const logged = spyOn(console, 'error').mockImplementation(() => {});
    binding.change({ name: new Date(0) });
    logged.mockRestore();
    expect(live.held).toBe(true);
    expect(fake.updates()).toHaveLength(0);
    fake.parentEdit(live.docKey, (doc) => doc.getMap('data').set('other', 'theirs'));
    expect(binding.reseed()).toBeNull();
    expect(binding.values).toEqual({ name: new Date(0) });
    expect(createDataBinding(live, any, 'd1:en').values).toEqual({ name: new Date(0) });
    expect(fake.channel.held()).toBe(HELD_WRITE_FAILED);
  });

  it('Ctrl+Z after flipping a tag list brings the tags back', async () => {
    const { live } = await openData({ tags: ['x', 'y'] });
    const binding = createDataBinding(live, any, 'd1:en');
    binding.change({ tags: ['x', 'y', { label: 'z' }] });
    expect(dataOf(live.doc).tags).toEqual(['x', 'y', { label: 'z' }]);
    binding.undo.undo();
    expect(dataOf(live.doc).tags).toEqual(['x', 'y']);
  });

  it('Ctrl+Z after removing a card brings back its tag list', async () => {
    const cards = [
      { title: 'A', tags: ['1', '2'] },
      { title: 'B', tags: [] },
    ];
    const { live } = await openData({ cards });
    const binding = createDataBinding(live, any, 'd1:en');
    binding.change({ cards: [cards[1]] });
    binding.undo.undo();
    expect(dataOf(live.doc).cards).toEqual(cards);
  });

  it("Ctrl+Z undoes a tag edit and keeps a teammate's edit of the same tag", async () => {
    const tagged = { tags: ['a', 'k'] };
    const { fake, live } = await openData(tagged);
    const parent = fake.parent(live.docKey);
    const teammate = { shown: { data: dataOf(parent) }, ids: readItemIds(parent) };
    const binding = createDataBinding(live, any, 'd1:en');
    binding.change({ tags: ['mine', 'k'] });
    fake.parentEdit(live.docKey, (doc) => {
      applyItemChanges(doc, teammate.shown, teammate.ids, { data: { tags: ['theirs', 'k'] } }, 'mate');
    });
    expect(dataOf(live.doc).tags).toEqual(expect.arrayContaining(['mine', 'theirs', 'k']));
    binding.undo.undo();
    const tags = dataOf(live.doc).tags;
    expect(tags).toContain('theirs');
    expect(tags).not.toContain('mine');
  });

  it('Ctrl+Z after adding a card with tags takes the tags out of the list the change created', async () => {
    const { live } = await openData({ name: 'a' });
    const binding = createDataBinding(live, any, 'd1:en');
    const before = new Set(live.doc.share.keys());
    binding.change({ name: 'a', cards: [{ title: 'A', tags: ['x', 'y'] }] });
    const created = [...live.doc.share.keys()].filter((name) => name.startsWith('a:') && !before.has(name));
    expect(created).not.toEqual([]);
    binding.undo.undo();
    expect(dataOf(live.doc)).toEqual({ name: 'a' });
    // Left in place, the entries would still be stored, and a teammate's later write could bring them back.
    expect(created.map((name) => live.doc.getArray(name).length)).toEqual(created.map(() => 0));
  });

  it('writes consecutive item changes without a re-seed', async () => {
    const { live } = await openData({ links: [{ label: 'a' }] });
    const binding = createDataBinding(live, any, 'd1:en');
    binding.change({ links: [{ label: 'a' }, { label: '' }] });
    binding.change({ links: [{ label: 'a' }, { label: 'T' }] });
    binding.change({ links: [{ label: 'T' }, { label: 'a' }] });
    expect(dataOf(live.doc).links).toEqual([{ label: 'T' }, { label: 'a' }]);
  });

  it('leaves no handler on the doc after a StrictMode mount unmounts, though the binding was built twice', async () => {
    const { live } = await openData({ name: 'a' });
    const on = spyOn(live.doc, 'on');
    const off = spyOn(live.doc, 'off');
    const { unmount } = renderHook(() => useLiveDataValues(live, any, 'd1:en'), { wrapper: StrictMode });
    unmount();
    await Promise.resolve();
    // By identity: a handler taken off twice must not hide one never taken off.
    const added = on.mock.calls.filter(([name]) => name === 'afterTransaction').map(([, handler]) => handler);
    const removed = new Set(
      off.mock.calls.filter(([name]) => name === 'afterTransaction').map(([, handler]) => handler),
    );
    expect(added.length).toBeGreaterThan(0);
    expect(added.filter((handler) => !removed.has(handler))).toEqual([]);
  });

  it('Ctrl+Z after adding the first tag to an empty tag list takes it out', async () => {
    // Loaded by update, as the frame's replica is: the empty list has no array root yet.
    const { live } = await openData({ tags: [] });
    const binding = createDataBinding(live, any, 'd1:en');
    binding.change({ tags: ['a'] });
    expect(dataOf(live.doc).tags).toEqual(['a']);
    binding.undo.undo();
    expect(dataOf(live.doc).tags).toEqual([]);
  });

  it("keeps a teammate's insert into a list held invalid once the list is fixed", async () => {
    const { fake, live } = await openData({ tags: ['a'] });
    const parent = fake.parent(live.docKey);
    const teammate = { shown: { data: dataOf(parent) }, ids: readItemIds(parent) };
    const binding = createDataBinding(live, noBlank, 'd1:en');
    binding.change({ tags: ['a', ''] });
    fake.parentEdit(live.docKey, (doc) => {
      applyItemChanges(doc, teammate.shown, teammate.ids, { data: { tags: ['a', 't'] } }, 'mate');
    });
    expect(binding.reseed()).toEqual({ tags: ['a', ''] });
    binding.change({ tags: ['a', 'b'] });
    expect(dataOf(live.doc).tags).toHaveLength(3);
    expect(dataOf(live.doc).tags).toEqual(expect.arrayContaining(['a', 't', 'b']));
  });
});
