import { afterEach, describe, expect, it, jest, spyOn } from 'bun:test';
import { applyItemChanges, hydrateDoc, type ItemIds, readItemIds } from '@conloca/content-api/ydoc';
import type { Data } from '@puckeditor/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { createFakeDocChannel } from '../../test/fake-doc-channel.js';
import { HELD_WRITE_FAILED, LOCAL_ORIGIN } from './doc-channel.js';
import {
  createPuckBinding,
  PuckHeldNotice,
  readPuckData,
  trackFieldResolves,
  writePuckChange,
} from './puck-binding.js';

const BASE: Data = {
  root: { props: { title: 'Page' } },
  content: [
    { type: 'Hero', props: { id: 'h1', title: 'One', subtitle: 'First', buttons: [{ label: 'Go' }] } },
    { type: 'Hero', props: { id: 'h2', title: 'Two', subtitle: 'Second', buttons: [] } },
  ],
};

/** Two replicas of one page, in step, and the ids of what both show. */
function pair(data: Data = BASE) {
  const a = hydrateDoc({ puckData: data });
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  return { a, b, ids: readItemIds(a) };
}

/** What one editor shows: the data and its item ids, as the binding keeps them. */
interface View {
  data: Data;
  ids: ItemIds;
}

/** Writes `next` over `view` the way the binding does, and returns the view after it (the write's ids, no re-seed). */
function edit(doc: Y.Doc, view: View, next: Data): View {
  const written = writePuckChange(doc, view.data, view.ids, next);
  if (!written.ok) throw new Error(written.error);
  return { data: next, ids: written.ids };
}

/** `data` with block `id`'s list `key` replaced by `list`. */
const withList = (data: Data, id: string, key: string, list: unknown[]) => withProps(data, id, { [key]: list });

/** Each replica takes what the other has. */
function exchange(a: Y.Doc, b: Y.Doc): void {
  const fromA = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
  const fromB = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
  Y.applyUpdate(b, fromA);
  Y.applyUpdate(a, fromB);
}

/** `data` with block `id`'s props changed, as Puck's onChange hands it over. */
function withProps(data: Data, id: string, props: Partial<Data['content'][number]['props']>): Data {
  return {
    ...data,
    content: data.content.map((block) =>
      block.props.id === id ? { ...block, props: { ...block.props, ...props } } : block,
    ),
  };
}

const propsOf = (data: Data, id: string) => data.content.find((block) => block.props.id === id)?.props;

/** A teammate sets h1's subtitle in the parent's doc. */
function setH1Subtitle(fake: ReturnType<typeof createFakeDocChannel>, docKey: string, subtitle: string): void {
  fake.parentEdit(docKey, (doc) => {
    doc.getMap<Y.Map<Y.Map<unknown>>>('blocks').get('h1')?.get('props')?.set('subtitle', subtitle);
  });
}

/** Counts the doc's update events while `run` runs. */
function updatesDuring(doc: Y.Doc, run: () => void): { origin: unknown }[] {
  const seen: { origin: unknown }[] = [];
  const onUpdate = (_update: Uint8Array, origin: unknown) => seen.push({ origin });
  doc.on('update', onUpdate);
  run();
  doc.off('update', onUpdate);
  return seen;
}

afterEach(() => {
  cleanup();
});

describe('writePuckChange', () => {
  it('keeps edits to different props of one block from two editors', () => {
    const { a, b, ids } = pair();
    expect(writePuckChange(a, BASE, ids, withProps(BASE, 'h1', { title: 'A title' }))).toMatchObject({ ok: true });
    expect(writePuckChange(b, BASE, ids, withProps(BASE, 'h1', { subtitle: 'B subtitle' }))).toMatchObject({
      ok: true,
    });
    exchange(a, b);
    for (const doc of [a, b]) {
      expect(propsOf(readPuckData(doc), 'h1')).toMatchObject({ title: 'A title', subtitle: 'B subtitle' });
    }
  });

  it('converges a same-prop clash to one value on every replica', () => {
    const { a, b, ids } = pair();
    writePuckChange(a, BASE, ids, withProps(BASE, 'h1', { title: 'A' }));
    writePuckChange(b, BASE, ids, withProps(BASE, 'h1', { title: 'B' }));
    exchange(a, b);
    expect(readPuckData(a)).toEqual(readPuckData(b));
    expect(['A', 'B']).toContain(propsOf(readPuckData(a), 'h1')?.title);
  });

  it('keeps an edit inside a block that a teammate moved', () => {
    const { a, b, ids } = pair();
    const [h1, h2] = BASE.content;
    if (!h1 || !h2) throw new Error('two blocks');
    writePuckChange(a, BASE, ids, { ...BASE, content: [h2, h1] });
    writePuckChange(b, BASE, ids, withProps(BASE, 'h1', { title: 'Edited' }));
    exchange(a, b);
    for (const doc of [a, b]) {
      const data = readPuckData(doc);
      expect(data.content.map((block) => block.props.id)).toEqual(['h2', 'h1']);
      expect(propsOf(data, 'h1')?.title).toBe('Edited');
    }
  });

  it('keeps edits to different items of one array from two editors', () => {
    const listed = withList(BASE, 'h1', 'buttons', [{ label: 'a' }, { label: 'b' }]);
    const { a, b, ids } = pair(listed);
    edit(a, { data: listed, ids }, withList(listed, 'h1', 'buttons', [{ label: 'A' }, { label: 'b' }]));
    edit(b, { data: listed, ids }, withList(listed, 'h1', 'buttons', [{ label: 'a' }, { label: 'B' }]));
    exchange(a, b);
    for (const doc of [a, b])
      expect(propsOf(readPuckData(doc), 'h1')?.buttons).toEqual([{ label: 'A' }, { label: 'B' }]);
  });

  it('keeps an edit to an item a teammate moved', () => {
    const listed = withList(BASE, 'h1', 'buttons', [{ label: 'a' }, { label: 'b' }, { label: 'c' }]);
    const { a, b, ids } = pair(listed);
    edit(a, { data: listed, ids }, withList(listed, 'h1', 'buttons', [{ label: 'c' }, { label: 'a' }, { label: 'b' }]));
    exchange(a, b);
    // B was not shown the move: it edits the last button where it saw it.
    edit(b, { data: listed, ids }, withList(listed, 'h1', 'buttons', [{ label: 'a' }, { label: 'b' }, { label: 'C' }]));
    exchange(a, b);
    for (const doc of [a, b])
      expect(propsOf(readPuckData(doc), 'h1')?.buttons).toEqual([{ label: 'C' }, { label: 'a' }, { label: 'b' }]);
  });

  it("keeps a teammate's insert the view had not shown", () => {
    const listed = withList(BASE, 'h1', 'buttons', [{ label: 'a' }, { label: 'b' }]);
    const { a, b, ids } = pair(listed);
    edit(
      b,
      { data: listed, ids },
      withList(listed, 'h1', 'buttons', [{ label: 'a' }, { label: 'new' }, { label: 'b' }]),
    );
    exchange(a, b);
    edit(a, { data: listed, ids }, withList(listed, 'h1', 'buttons', [{ label: 'a' }, { label: 'B' }]));
    expect(propsOf(readPuckData(a), 'h1')?.buttons).toEqual([{ label: 'a' }, { label: 'new' }, { label: 'B' }]);
  });

  it('edits the item the user edited, not an equal copy', () => {
    const listed = withList(BASE, 'h1', 'buttons', [{ label: 'same' }, { label: 'same' }]);
    const { a, b, ids } = pair(listed);
    // A teammate puts a third equal copy first; the user, not shown it, edits the second copy it saw.
    edit(
      b,
      { data: listed, ids },
      withList(listed, 'h1', 'buttons', [{ label: 'same' }, { label: 'same' }, { label: 'same' }]),
    );
    exchange(a, b);
    edit(a, { data: listed, ids }, withList(listed, 'h1', 'buttons', [{ label: 'same' }, { label: 'mine' }]));
    exchange(a, b);
    const [name, shownIds] = Object.entries(ids).find(([, list]) => list.length === 2) ?? [];
    const edited = shownIds?.[1];
    for (const doc of [a, b]) {
      const at = readItemIds(doc)[name ?? '']?.indexOf(edited ?? '') ?? -1;
      const buttons = propsOf(readPuckData(doc), 'h1')?.buttons;
      expect(buttons?.[at]).toEqual({ label: 'mine' });
      expect(buttons?.filter((button: { label: string }) => button.label === 'same')).toHaveLength(2);
    }
  });

  it('edits the tag the user edited after a teammate inserted one before it', () => {
    const tagged = withList(BASE, 'h1', 'tags', ['red', 'blue']);
    const { a, b, ids } = pair(tagged);
    edit(b, { data: tagged, ids }, withList(tagged, 'h1', 'tags', ['green', 'red', 'blue']));
    exchange(a, b);
    edit(a, { data: tagged, ids }, withList(tagged, 'h1', 'tags', ['red', 'navy']));
    exchange(a, b);
    for (const doc of [a, b]) expect(propsOf(readPuckData(doc), 'h1')?.tags).toEqual(['green', 'red', 'navy']);
  });

  it('writes typing into a just-inserted item into that item', () => {
    const listed = withList(BASE, 'h1', 'buttons', [{ label: 'a' }]);
    const { a, ids } = pair(listed);
    const inserted = withList(listed, 'h1', 'buttons', [{ label: 'a' }, { label: '' }]);
    let view = edit(a, { data: listed, ids }, inserted);
    view = edit(a, view, withList(listed, 'h1', 'buttons', [{ label: 'a' }, { label: 'T' }]));
    edit(a, view, withList(listed, 'h1', 'buttons', [{ label: 'a' }, { label: 'Ty' }]));
    expect(propsOf(readPuckData(a), 'h1')?.buttons).toEqual([{ label: 'a' }, { label: 'Ty' }]);
  });

  it('does nothing when Puck echoes the data it was given', () => {
    const { a } = pair();
    expect(updatesDuring(a, () => writePuckChange(a, readPuckData(a), readItemIds(a), readPuckData(a)))).toEqual([]);
  });

  it('keeps a remote edit that lands before the next dispatch when the user types', () => {
    const { a, b, ids } = pair();
    const shadow = withProps(BASE, 'h1', { title: 'T' });
    writePuckChange(a, BASE, ids, shadow);
    exchange(a, b);
    // A teammate's subtitle reaches the doc; Puck has not been shown it yet.
    writePuckChange(b, shadow, ids, withProps(shadow, 'h2', { subtitle: 'R' }));
    exchange(a, b);
    let h2Written = false;
    a.getMap<Y.Map<unknown>>('blocks')
      .get('h2')
      ?.observeDeep((_events, transaction) => {
        if (transaction.origin === LOCAL_ORIGIN) h2Written = true;
      });
    expect(writePuckChange(a, shadow, ids, withProps(shadow, 'h1', { title: 'T2' }))).toMatchObject({ ok: true });
    const data = readPuckData(a);
    expect(propsOf(data, 'h1')?.title).toBe('T2');
    expect(propsOf(data, 'h2')?.subtitle).toBe('R');
    expect(h2Written).toBe(false);
  });

  it("merges a list the user changed with a teammate's change inside it that Puck was not shown yet", () => {
    const listed = withProps(BASE, 'h1', { buttons: [{ label: 'a' }, { label: 'b' }, { label: 'c' }] });
    const doc = hydrateDoc({
      puckData: withProps(listed, 'h1', { buttons: [{ label: 'a' }, { label: 'b' }, { label: 'C' }] }),
    });
    // The doc's items are the shown ones; the third was edited since.
    writePuckChange(
      doc,
      listed,
      readItemIds(doc),
      withProps(listed, 'h1', { buttons: [{ label: 'b' }, { label: 'c' }] }),
    );
    expect(propsOf(readPuckData(doc), 'h1')?.buttons).toEqual([{ label: 'b' }, { label: 'C' }]);
  });

  it('writes nothing for a value that is not JSON', () => {
    const { a, ids } = pair();
    const shadow = readPuckData(a);
    const result = updatesDuring(a, () =>
      expect(writePuckChange(a, shadow, ids, withProps(shadow, 'h1', { title: new Date(0) }))).toMatchObject({
        ok: false,
      }),
    );
    expect(result).toEqual([]);
  });

  it('writes no list item when another value of the same change is not JSON', () => {
    const listed = withList(BASE, 'h1', 'buttons', [{ label: 'a' }]);
    const { a, ids } = pair(listed);
    const next = withProps(withList(listed, 'h1', 'buttons', [{ label: 'a' }, { label: 'new' }]), 'h2', {
      title: new Date(0),
    });
    const result = updatesDuring(a, () => expect(writePuckChange(a, listed, ids, next)).toMatchObject({ ok: false }));
    expect(result).toEqual([]);
    expect(propsOf(readPuckData(a), 'h1')?.buttons).toEqual([{ label: 'a' }]);
  });
});

/** What the page editor's `prepare` does: default props under every block's own. */
function addToneDefault(data: Data): Data {
  return { ...data, content: data.content.map((block) => ({ ...block, props: { tone: 'plain', ...block.props } })) };
}

describe('createPuckBinding', () => {
  it('re-seeds with the props the load handed Puck: default props and resolved props the doc never stored', async () => {
    const fake = createFakeDocChannel({ puckData: BASE });
    const live = await fake.channel.open({ kind: 'puck', id: 'p', locale: 'en' });
    // What the page editor hands Puck on load: defaults merged in, and h1's resolveData derived a prop.
    const loaded = withProps(addToneDefault(BASE), 'h1', { derived: 'resolved' });
    const binding = createPuckBinding(live, loaded, addToneDefault);
    fake.parentEdit(live.docKey, (doc) => {
      doc.getMap<Y.Map<Y.Map<unknown>>>('blocks').get('h2')?.get('props')?.set('title', 'Theirs');
    });
    const shown = binding.reseed();
    expect(shown && propsOf(shown, 'h1')).toMatchObject({ derived: 'resolved', tone: 'plain' });
    expect(shown && propsOf(shown, 'h2')).toMatchObject({ title: 'Theirs', tone: 'plain' });
    // Puck echoes the re-seed: the defaults and resolved props are not written as this user's edits.
    if (shown) binding.change(shown);
    expect(fake.updates()).toEqual([]);
  });

  it("narrows a field change's late replace to the props it made, and keeps a deliberate set-back", async () => {
    const fake = createFakeDocChannel({ puckData: BASE });
    const live = await fake.channel.open({ kind: 'puck', id: 'p', locale: 'en' });
    const binding = createPuckBinding(live);
    // The keystroke: Puck builds h1 as it shows it, plus the typed title, and starts resolveData.
    const typed = { ...propsOf(binding.shadow, 'h1'), id: 'h1', title: 'Mine' };
    const settle = binding.fieldResolveStarted('h1', typed);
    fake.parentEdit(live.docKey, (doc) => {
      doc.getMap<Y.Map<Y.Map<unknown>>>('blocks').get('h1')?.get('props')?.set('subtitle', 'Theirs');
    });
    const shown = binding.reseed();
    if (!shown) throw new Error('not held');
    // resolveData answers, deriving a prop; Puck hands over the block it built at the keystroke.
    settle({ ...typed, derived: 'MINE' });
    binding.change(withProps(shown, 'h1', { ...typed, derived: 'MINE' }));
    expect(propsOf(readPuckData(live.doc), 'h1')).toMatchObject({ title: 'Mine', subtitle: 'Theirs', derived: 'MINE' });
    // The re-seed that follows shows the doc again; the user sets the teammate's subtitle back on purpose: kept.
    binding.reseed();
    const back = { ...propsOf(binding.shadow, 'h1'), id: 'h1', subtitle: 'First' };
    binding.fieldResolveStarted('h1', back)(back);
    binding.change(withProps(binding.shadow, 'h1', back));
    expect(propsOf(readPuckData(live.doc), 'h1')).toMatchObject({ title: 'Mine', subtitle: 'First' });
  });

  it('writes in full a change to a block whose settled field change it does not match, as an undo is', async () => {
    const fake = createFakeDocChannel({ puckData: BASE });
    const live = await fake.channel.open({ kind: 'puck', id: 'p', locale: 'en' });
    const binding = createPuckBinding(live);
    const typed = { ...propsOf(binding.shadow, 'h1'), id: 'h1', title: 'Mine' };
    binding.fieldResolveStarted('h1', typed)(typed);
    setH1Subtitle(fake, live.docKey, 'Theirs');
    const shown = binding.reseed();
    if (!shown) throw new Error('not held');
    // Not the settled field change (another title): it keeps today's diff, so its subtitle is written too.
    binding.change(withProps(shown, 'h1', { title: 'Other', subtitle: 'Mine too' }));
    expect(propsOf(readPuckData(live.doc), 'h1')).toMatchObject({ title: 'Other', subtitle: 'Mine too' });
  });

  it('narrows a late replace however many field changes wait meanwhile', async () => {
    const fake = createFakeDocChannel({ puckData: BASE });
    const live = await fake.channel.open({ kind: 'puck', id: 'p', locale: 'en' });
    const binding = createPuckBinding(live);
    const typed = { ...propsOf(binding.shadow, 'h1'), id: 'h1', title: 'Mine' };
    const settle = binding.fieldResolveStarted('h1', typed);
    // Forty keystrokes on h2 while h1's resolveData waits.
    for (const n of Array.from({ length: 40 }, (_, i) => i)) {
      binding.fieldResolveStarted('h2', { ...propsOf(binding.shadow, 'h2'), id: 'h2', title: `t${n}` });
    }
    setH1Subtitle(fake, live.docKey, 'Theirs');
    const shown = binding.reseed();
    if (!shown) throw new Error('not held');
    settle(typed);
    binding.change(withProps(shown, 'h1', typed));
    expect(propsOf(readPuckData(live.doc), 'h1')).toMatchObject({ title: 'Mine', subtitle: 'Theirs' });
  });

  it('narrows a late replace of a block inside a slot', async () => {
    const nested: Data = {
      root: { props: {} },
      content: [
        {
          type: 'Box',
          props: { id: 'box', items: [{ type: 'Hero', props: { id: 'h1', title: 'One', subtitle: 'First' } }] },
        },
      ],
    };
    const fake = createFakeDocChannel({ puckData: nested });
    const live = await fake.channel.open({ kind: 'puck', id: 'p', locale: 'en' });
    const binding = createPuckBinding(live);
    const typed = { id: 'h1', title: 'Mine', subtitle: 'First' };
    const settle = binding.fieldResolveStarted('h1', typed);
    fake.parentEdit(live.docKey, (doc) => {
      doc.getMap<Y.Map<Y.Map<unknown>>>('blocks').get('h1')?.get('props')?.set('subtitle', 'Theirs');
    });
    const shown = binding.reseed();
    if (!shown) throw new Error('not held');
    settle(typed);
    const box = shown.content[0];
    if (!box) throw new Error('no box');
    binding.change({
      ...shown,
      content: [{ ...box, props: { ...box.props, items: [{ type: 'Hero', props: typed }] } }],
    });
    const h1 = readPuckData(live.doc).content[0]?.props.items?.[0]?.props;
    expect(h1).toMatchObject({ title: 'Mine', subtitle: 'Theirs' });
  });

  it("merges a list the user changes with a teammate's change inside it that Puck was not shown yet", async () => {
    const listed = withProps(BASE, 'h1', { buttons: [{ label: 'a' }, { label: 'b' }, { label: 'c' }] });
    const fake = createFakeDocChannel({ puckData: listed });
    const live = await fake.channel.open({ kind: 'puck', id: 'p', locale: 'en' });
    const binding = createPuckBinding(live);
    // A teammate's edit to the third button reaches the doc; Puck has not been re-seeded with it.
    fake.parentEdit(live.docKey, (doc) => {
      const next = withList(listed, 'h1', 'buttons', [{ label: 'a' }, { label: 'b' }, { label: 'C' }]);
      applyItemChanges(doc, { puckData: listed }, readItemIds(doc), { puckData: next }, 'mate');
    });
    // The user removes the first button, from what Puck shows; resolveData waits.
    const removed = { ...propsOf(binding.shadow, 'h1'), id: 'h1', buttons: [{ label: 'b' }, { label: 'c' }] };
    binding.fieldResolveStarted('h1', removed);
    expect(propsOf(readPuckData(live.doc), 'h1')?.buttons).toEqual([{ label: 'b' }, { label: 'C' }]);
  });

  it('writes a field change at the keystroke, before resolveData answers', async () => {
    const fake = createFakeDocChannel({ puckData: BASE });
    const live = await fake.channel.open({ kind: 'puck', id: 'p', locale: 'en' });
    const binding = createPuckBinding(live);
    binding.fieldResolveStarted('h1', { ...propsOf(binding.shadow, 'h1'), id: 'h1', title: 'Mine' });
    expect(propsOf(readPuckData(live.doc), 'h1')).toMatchObject({ title: 'Mine', subtitle: 'First' });
  });

  it('keeps a settled field change through any number of re-seeds until Puck hands its block over', async () => {
    const fake = createFakeDocChannel({ puckData: BASE });
    const live = await fake.channel.open({ kind: 'puck', id: 'p', locale: 'en' });
    const binding = createPuckBinding(live);
    const typed = { ...propsOf(binding.shadow, 'h1'), id: 'h1', title: 'Mine' };
    binding.fieldResolveStarted('h1', typed)(typed);
    // Puck still resolves the block's slot children; teammates keep changing it meanwhile.
    for (const subtitle of ['T1', 'T2', 'T3']) {
      setH1Subtitle(fake, live.docKey, subtitle);
      binding.reseed();
    }
    binding.change(withProps(binding.shadow, 'h1', typed));
    expect(propsOf(readPuckData(live.doc), 'h1')).toMatchObject({ title: 'Mine', subtitle: 'T3' });
  });

  it("writes the user's keystroke in a slot child while its parent's update waits on the children", async () => {
    const nested: Data = {
      root: { props: {} },
      content: [
        {
          type: 'Box',
          props: { id: 'box', heading: 'H', items: [{ type: 'Hero', props: { id: 'h1', title: 'One', note: 'N1' } }] },
        },
      ],
    };
    const fake = createFakeDocChannel({ puckData: nested });
    const live = await fake.channel.open({ kind: 'puck', id: 'p', locale: 'en' });
    const binding = createPuckBinding(live);
    const box = binding.shadow.content[0]?.props;
    if (!box) throw new Error('no box');
    // The Box's resolveData answered; Puck still resolves its children before handing it over.
    const typed = { ...box, heading: 'H!' };
    binding.fieldResolveStarted('box', typed)(typed);
    // The user types into the child meanwhile: its own field change, not the child as the Box held it.
    binding.fieldResolveStarted('h1', { id: 'h1', title: 'One!', note: 'N1' }, 'box');
    expect(readPuckData(live.doc).content[0]?.props.items?.[0]?.props).toMatchObject({ title: 'One!' });
  });

  it('takes back nothing a teammate overwrote when resolveData then throws', async () => {
    const fake = createFakeDocChannel({ puckData: BASE });
    const live = await fake.channel.open({ kind: 'puck', id: 'p', locale: 'en' });
    const binding = createPuckBinding(live);
    const settle = binding.fieldResolveStarted('h1', { ...propsOf(binding.shadow, 'h1'), id: 'h1', subtitle: 'Mine' });
    setH1Subtitle(fake, live.docKey, 'Theirs');
    settle(null);
    expect(propsOf(readPuckData(live.doc), 'h1')?.subtitle).toBe('Theirs');
  });

  it("takes back nothing a newer keystroke wrote when an older one's resolveData throws", async () => {
    const fake = createFakeDocChannel({ puckData: BASE });
    const live = await fake.channel.open({ kind: 'puck', id: 'p', locale: 'en' });
    const binding = createPuckBinding(live);
    const first = { ...propsOf(binding.shadow, 'h1'), id: 'h1', title: 'M' };
    const settleFirst = binding.fieldResolveStarted('h1', first);
    const second = { ...first, title: 'Mi' };
    binding.fieldResolveStarted('h1', second)(second);
    binding.change(withProps(binding.shadow, 'h1', second));
    settleFirst(null);
    expect(propsOf(readPuckData(live.doc), 'h1')?.title).toBe('Mi');
  });

  it("lets the block's older settled field changes go when Puck hands over a newer one", async () => {
    const fake = createFakeDocChannel({ puckData: BASE });
    const live = await fake.channel.open({ kind: 'puck', id: 'p', locale: 'en' });
    const binding = createPuckBinding(live);
    const first = { ...propsOf(binding.shadow, 'h1'), id: 'h1', title: 'M' };
    binding.fieldResolveStarted('h1', first)(first);
    const second = { ...first, title: 'Mi' };
    binding.fieldResolveStarted('h1', second)(second);
    binding.change(withProps(binding.shadow, 'h1', second));
    expect(binding.fieldResolvesWaiting()).toBe(0);
  });

  it('narrows an older resolve that answers after a newer handover, with no revert', async () => {
    const fake = createFakeDocChannel({ puckData: BASE });
    const live = await fake.channel.open({ kind: 'puck', id: 'p', locale: 'en' });
    const binding = createPuckBinding(live);
    // Two keystrokes on h1; the first one's resolveData is slow.
    const first = { ...propsOf(binding.shadow, 'h1'), id: 'h1', title: 'M' };
    const settleFirst = binding.fieldResolveStarted('h1', first);
    const second = { ...first, title: 'Mi' };
    const settleSecond = binding.fieldResolveStarted('h1', second);
    setH1Subtitle(fake, live.docKey, 'Theirs');
    const shown = binding.reseed();
    if (!shown) throw new Error('not held');
    // The second answers and is handed over first.
    settleSecond(second);
    binding.change(withProps(shown, 'h1', second));
    expect(binding.fieldResolvesWaiting()).toBe(1);
    // The first answers late; Puck hands over the block it built at the first keystroke.
    settleFirst(first);
    binding.change(withProps(binding.shadow, 'h1', first));
    expect(propsOf(readPuckData(live.doc), 'h1')).toMatchObject({ title: 'Mi', subtitle: 'Theirs' });
    expect(binding.fieldResolvesWaiting()).toBe(0);
  });

  it("keeps a teammate's value when Puck hands the block over a minute after resolveData answered", async () => {
    jest.useFakeTimers();
    try {
      const fake = createFakeDocChannel({ puckData: BASE });
      const live = await fake.channel.open({ kind: 'puck', id: 'p', locale: 'en' });
      const binding = createPuckBinding(live);
      const typed = { ...propsOf(binding.shadow, 'h1'), id: 'h1', title: 'Mine' };
      binding.fieldResolveStarted('h1', typed)(typed);
      setH1Subtitle(fake, live.docKey, 'Theirs');
      binding.reseed();
      // A slot child's slow fetch: Puck hands the block over only now.
      jest.advanceTimersByTime(60_000);
      binding.change(withProps(binding.shadow, 'h1', typed));
      expect(propsOf(readPuckData(live.doc), 'h1')).toMatchObject({ title: 'Mine', subtitle: 'Theirs' });
      expect(binding.fieldResolvesWaiting()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not write a slot child's resolve during its parent's update as a keystroke", async () => {
    const nested: Data = {
      root: { props: {} },
      content: [
        {
          type: 'Box',
          props: { id: 'box', heading: 'H', items: [{ type: 'Hero', props: { id: 'h1', title: 'One', note: 'N1' } }] },
        },
      ],
    };
    const fake = createFakeDocChannel({ puckData: nested });
    const live = await fake.channel.open({ kind: 'puck', id: 'p', locale: 'en' });
    const binding = createPuckBinding(live);
    // The user types in the Box; its resolveData answers.
    const box = binding.shadow.content[0]?.props;
    if (!box) throw new Error('no box');
    const typed = { ...box, heading: 'H!' };
    binding.fieldResolveStarted('box', typed)(typed);
    // A teammate changes the child's note before Puck resolves the Box's children.
    fake.parentEdit(live.docKey, (doc) => {
      doc.getMap<Y.Map<Y.Map<unknown>>>('blocks').get('h1')?.get('props')?.set('note', 'N2');
    });
    binding.reseed();
    // Puck resolves the child as the Box held it at the keystroke: not the user's change.
    binding.fieldResolveStarted('h1', { id: 'h1', title: 'One', note: 'N1' }, 'box');
    const h1 = readPuckData(live.doc).content[0]?.props.items?.[0]?.props;
    expect(h1).toMatchObject({ note: 'N2' });
  });

  it('writes nothing stale from what Puck shows until the re-seed after a narrowed replace', async () => {
    const fake = createFakeDocChannel({ puckData: BASE });
    const live = await fake.channel.open({ kind: 'puck', id: 'p', locale: 'en' });
    const binding = createPuckBinding(live);
    const typed = { ...propsOf(binding.shadow, 'h1'), id: 'h1', title: 'Mine' };
    const settle = binding.fieldResolveStarted('h1', typed);
    setH1Subtitle(fake, live.docKey, 'Theirs');
    const shown = binding.reseed();
    if (!shown) throw new Error('not held');
    settle(typed);
    // Puck shows the late replace, its stale subtitle included, until the re-seed lands.
    const late = withProps(shown, 'h1', typed);
    binding.change(late);
    // A keystroke in that frame on another prop, with no resolveData waiting, is built from what Puck shows.
    binding.change(withProps(late, 'h1', { title: 'Mine 2' }));
    expect(propsOf(readPuckData(live.doc), 'h1')).toMatchObject({ title: 'Mine 2', subtitle: 'Theirs' });
  });

  it('keeps no field change whose resolveData threw', async () => {
    const fake = createFakeDocChannel({ puckData: BASE });
    const live = await fake.channel.open({ kind: 'puck', id: 'p', locale: 'en' });
    const binding = createPuckBinding(live);
    const config = trackFieldResolves(
      {
        components: {
          Hero: {
            render: () => <p />,
            resolveData: async () => {
              throw new Error('fetch failed');
            },
          },
        },
      },
      () => binding,
    );
    const resolve = config.components.Hero?.resolveData;
    if (!resolve) throw new Error('not wrapped');
    const params = {
      changed: {},
      lastData: null,
      metadata: {},
      parent: null,
      root: { props: {} },
      trigger: 'replace' as const,
    };
    const typed = { ...propsOf(binding.shadow, 'h1'), id: 'h1', title: 'Mine' };
    const answer = Promise.resolve(resolve({ props: typed, readOnly: {} }, params));
    expect(await answer.catch(() => 'threw')).toBe('threw');
    expect(binding.fieldResolvesWaiting()).toBe(0);
    // Puck applies nothing when resolveData throws: the edit written at the keystroke is taken back, as Puck drops it.
    expect(propsOf(readPuckData(live.doc), 'h1')?.title).toBe('One');
  });

  it('keeps no field change for a block that is gone', async () => {
    const fake = createFakeDocChannel({ puckData: BASE });
    const live = await fake.channel.open({ kind: 'puck', id: 'p', locale: 'en' });
    const binding = createPuckBinding(live);
    binding.fieldResolveStarted('h2', { ...propsOf(binding.shadow, 'h2'), id: 'h2', title: 'Mine' });
    binding.change({ ...binding.shadow, content: binding.shadow.content.filter((block) => block.props.id !== 'h2') });
    expect(binding.fieldResolvesWaiting()).toBe(0);
  });

  it('reports only field changes (trigger replace) to the binding', async () => {
    const started: string[] = [];
    const binding = {
      fieldResolveStarted: (id: string) => {
        started.push(id);
        return () => {};
      },
    };
    const config = trackFieldResolves(
      { components: { Hero: { render: () => <p />, resolveData: async (data) => data } } },
      () => binding,
    );
    const resolve = config.components.Hero?.resolveData;
    if (!resolve) throw new Error('not wrapped');
    const params = { changed: {}, lastData: null, metadata: {}, parent: null, root: { props: {} } };
    for (const trigger of ['load', 'insert', 'move', 'force', 'replace'] as const) {
      // oxlint-disable-next-line no-await-in-loop -- each trigger is checked in order.
      await resolve({ props: { id: 'h1' }, readOnly: {} }, { ...params, trigger });
    }
    expect(started).toEqual(['h1']);
  });

  it('holds the view when the doc write throws', async () => {
    const fake = createFakeDocChannel({ data: { title: 'not a puck page' } });
    const live = await fake.channel.open({ kind: 'puck', id: 'p', locale: 'en' });
    const binding = createPuckBinding(live, BASE);
    const failed = withProps(BASE, 'h1', { title: 'Mine' });
    const logged = spyOn(console, 'error').mockImplementation(() => {});
    const events = updatesDuring(live.doc, () => binding.change(failed));
    logged.mockRestore();
    expect(events).toEqual([]);
    expect(fake.updates()).toEqual([]);
    expect(live.held).toBe(true);
    expect(fake.held()).toEqual([{ docKey: live.docKey, held: true, message: HELD_WRITE_FAILED }]);
    // A later remote update does not re-seed Puck: the view keeps the failed edit.
    fake.parentEdit(live.docKey, (doc) => doc.getMap('data').set('title', 'theirs'));
    expect(binding.reseed()).toBeNull();
    expect(binding.shadow).toBe(failed);
    // Later changes are not written either.
    binding.change(withProps(failed, 'h2', { title: 'More' }));
    expect(fake.updates()).toEqual([]);

    render(<PuckHeldNotice binding={binding} />);
    let copied = '';
    const clipboard = {
      writeText: async (text: string) => {
        copied = text;
      },
    };
    Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
    expect(screen.getByRole('alert').textContent).toContain(HELD_WRITE_FAILED);
    fireEvent.click(screen.getByRole('button', { name: 'Copy changes' }));
    await Promise.resolve();
    expect(JSON.parse(copied)).toMatchObject({ puckData: withProps(failed, 'h2', { title: 'More' }) });
  });

  it('writes typing into a just-inserted item into that item, with no re-seed between', async () => {
    const fake = createFakeDocChannel({ puckData: withList(BASE, 'h1', 'buttons', [{ label: 'a' }]) });
    const live = await fake.channel.open({ kind: 'puck', id: 'p', locale: 'en' });
    const binding = createPuckBinding(live);
    binding.change(withList(binding.shadow, 'h1', 'buttons', [{ label: 'a' }, { label: '' }]));
    binding.change(withList(binding.shadow, 'h1', 'buttons', [{ label: 'a' }, { label: 'T' }]));
    binding.change(withList(binding.shadow, 'h1', 'buttons', [{ label: 'a' }, { label: 'Ty' }]));
    expect(propsOf(readPuckData(fake.parent(live.docKey)), 'h1')?.buttons).toEqual([{ label: 'a' }, { label: 'Ty' }]);
  });

  it('writes typing into an item a waiting field change inserted into that item', async () => {
    const fake = createFakeDocChannel({ puckData: BASE });
    const live = await fake.channel.open({ kind: 'puck', id: 'p', locale: 'en' });
    const binding = createPuckBinding(live);
    // Two keystrokes on h1, both resolveData still waiting: the first adds an item, the second types into it.
    const h1 = { ...propsOf(binding.shadow, 'h1'), id: 'h1' };
    binding.fieldResolveStarted('h1', { ...h1, buttons: [{ label: 'Go' }, { label: '' }] });
    binding.fieldResolveStarted('h1', { ...h1, buttons: [{ label: 'Go' }, { label: 'T' }] });
    expect(propsOf(readPuckData(live.doc), 'h1')?.buttons).toEqual([{ label: 'Go' }, { label: 'T' }]);
  });

  it("writes typing into an item a waiting field change inserted, though another block's change landed between", async () => {
    const fake = createFakeDocChannel({ puckData: BASE });
    const live = await fake.channel.open({ kind: 'puck', id: 'p', locale: 'en' });
    const binding = createPuckBinding(live);
    const h1 = { ...propsOf(binding.shadow, 'h1'), id: 'h1' };
    binding.fieldResolveStarted('h1', { ...h1, buttons: [{ label: 'Go' }, { label: '' }] });
    // The user edits h2 (no resolveData) while h1's waits: Puck hands over h1 without the unsettled keystroke.
    binding.change(withProps(binding.shadow, 'h2', { title: 'Two' }));
    binding.fieldResolveStarted('h1', { ...h1, buttons: [{ label: 'Go' }, { label: 'T' }] });
    expect(propsOf(readPuckData(live.doc), 'h1')?.buttons).toEqual([{ label: 'Go' }, { label: 'T' }]);
    expect(propsOf(readPuckData(live.doc), 'h2')?.title).toBe('Two');
  });

  it('Ctrl+Z after adding the first tag to an empty tag list takes it out', async () => {
    // Loaded by update, as the frame's replica is: the empty list has no array root yet.
    const fake = createFakeDocChannel({ puckData: withList(BASE, 'h1', 'tags', []) });
    const live = await fake.channel.open({ kind: 'puck', id: 'p', locale: 'en' });
    const binding = createPuckBinding(live);
    // Its write also sets h1's props in `blocks`, so undo captures it with or without `track`; the data binding's twin
    // writes the array alone and pins `track`.
    expect([...live.doc.share.keys()].filter((name) => name.startsWith('a:'))).toEqual([]);
    binding.change(withList(binding.shadow, 'h1', 'tags', ['a']));
    expect(propsOf(readPuckData(live.doc), 'h1')?.tags).toEqual(['a']);
    binding.undo.undo();
    expect(propsOf(readPuckData(live.doc), 'h1')?.tags).toEqual([]);
  });

  it('Ctrl+Z after flipping a tag list brings the tags back', async () => {
    const fake = createFakeDocChannel({ puckData: withList(BASE, 'h1', 'tags', ['x', 'y']) });
    const live = await fake.channel.open({ kind: 'puck', id: 'p', locale: 'en' });
    const binding = createPuckBinding(live);
    binding.change(withList(binding.shadow, 'h1', 'tags', ['x', 'y', { label: 'z' }]));
    expect(propsOf(readPuckData(live.doc), 'h1')?.tags).toEqual(['x', 'y', { label: 'z' }]);
    binding.undo.undo();
    expect(propsOf(readPuckData(live.doc), 'h1')?.tags).toEqual(['x', 'y']);
  });

  it('Ctrl+Z after removing a card brings back its tag list', async () => {
    const cards = [
      { title: 'A', tags: ['1', '2'] },
      { title: 'B', tags: [] },
    ];
    const fake = createFakeDocChannel({ puckData: withList(BASE, 'h1', 'cards', cards) });
    const live = await fake.channel.open({ kind: 'puck', id: 'p', locale: 'en' });
    const binding = createPuckBinding(live);
    binding.change(withList(binding.shadow, 'h1', 'cards', [cards[1]]));
    binding.undo.undo();
    expect(propsOf(readPuckData(live.doc), 'h1')?.cards).toEqual(cards);
  });

  it("Ctrl+Z undoes a tag edit and keeps a teammate's edit of the same tag", async () => {
    const tagged = withList(BASE, 'h1', 'tags', ['a', 'k']);
    const fake = createFakeDocChannel({ puckData: tagged });
    const live = await fake.channel.open({ kind: 'puck', id: 'p', locale: 'en' });
    const parent = fake.parent(live.docKey);
    const teammate = { shown: { puckData: readPuckData(parent) }, ids: readItemIds(parent) };
    const binding = createPuckBinding(live);
    binding.change(withList(binding.shadow, 'h1', 'tags', ['mine', 'k']));
    // The teammate, not shown the user's edit, edits the same tag.
    fake.parentEdit(live.docKey, (doc) => {
      applyItemChanges(
        doc,
        teammate.shown,
        teammate.ids,
        { puckData: withList(tagged, 'h1', 'tags', ['theirs', 'k']) },
        'mate',
      );
    });
    expect(propsOf(readPuckData(live.doc), 'h1')?.tags).toEqual(expect.arrayContaining(['mine', 'theirs', 'k']));
    binding.undo.undo();
    const tags = propsOf(readPuckData(live.doc), 'h1')?.tags;
    expect(tags).toContain('theirs');
    expect(tags).not.toContain('mine');
  });

  it('re-seeds from the doc after a change it did not write, and writes its own change once', async () => {
    const fake = createFakeDocChannel({ puckData: BASE });
    const live = await fake.channel.open({ kind: 'puck', id: 'p', locale: 'en' });
    const binding = createPuckBinding(live);
    binding.change(withProps(binding.shadow, 'h1', { title: 'Mine' }));
    expect(fake.updates()).toHaveLength(1);
    fake.parentEdit(live.docKey, (doc) => {
      const h2 = doc.getMap<Y.Map<Y.Map<unknown>>>('blocks').get('h2');
      h2?.get('props')?.set('title', 'Theirs');
    });
    const shown = binding.reseed();
    expect(shown && propsOf(shown, 'h1')?.title).toBe('Mine');
    expect(shown && propsOf(shown, 'h2')?.title).toBe('Theirs');
    // Puck echoes the re-seed: nothing more is sent.
    if (shown) binding.change(shown);
    expect(fake.updates()).toHaveLength(1);
    // Undo takes back only this user's change.
    binding.undo.undo();
    const after = readPuckData(live.doc);
    expect(propsOf(after, 'h1')?.title).toBe('One');
    expect(propsOf(after, 'h2')?.title).toBe('Theirs');
  });
});
