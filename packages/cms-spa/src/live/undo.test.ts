import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { applyItemChanges, hydrateDoc, readItemIds, serializeDoc } from '@conloca/content-api/ydoc';
import * as Y from 'yjs';
import { EDIT_ORIGIN, LOCAL_ORIGIN, RELAY_ORIGIN } from './doc-channel.js';
import { createListUndo, createLocalUndo, interceptUndoKeys } from './undo.js';

const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

function press(init: KeyboardEventInit, target: EventTarget = window): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe('local undo', () => {
  it('never undoes a remote edit', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const undo = createLocalUndo(a.getMap('m'));
    a.transact(() => a.getMap('m').set('title', 'Mine'), LOCAL_ORIGIN);
    b.getMap('m').set('subtitle', 'Theirs');
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b), RELAY_ORIGIN);
    undo.undo();
    expect(a.getMap('m').toJSON()).toEqual({ subtitle: 'Theirs' });
  });

  it("undoes a local edit in a list of primitives a teammate's transaction created after mount", () => {
    const doc = hydrateDoc({ data: { title: 'T' } });
    const { undo } = createListUndo(doc, ['data']);
    const teammate = hydrateDoc({ data: { title: 'T' } });
    Y.applyUpdate(teammate, Y.encodeStateAsUpdate(doc));
    const shown = serializeDoc(teammate);
    applyItemChanges(teammate, shown, readItemIds(teammate), { data: { title: 'T', tags: ['a'] } }, 'mate');
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(teammate, Y.encodeStateVector(doc)), RELAY_ORIGIN);
    // A local write that names no arrays: only the remote transaction's handler put the tag array in scope.
    applyItemChanges(
      doc,
      serializeDoc(doc),
      readItemIds(doc),
      { data: { title: 'T', tags: ['a', 'b'] } },
      LOCAL_ORIGIN,
    );
    undo.undo();
    expect(serializeDoc(doc)).toEqual({ data: { title: 'T', tags: ['a'] } });
  });

  it('lets go of the doc when its last user releases it, and not on a release a remount takes back', async () => {
    const doc = hydrateDoc({ data: { title: 'T' } });
    const off = spyOn(doc, 'off');
    const listUndo = createListUndo(doc, ['data']);
    // StrictMode: mount, unmount, mount again in one commit.
    listUndo.retain()();
    const release = listUndo.retain();
    await Promise.resolve();
    doc.transact(() => doc.getMap('data').set('title', 'Mine'), LOCAL_ORIGIN);
    expect(listUndo.undo.undoStack).toHaveLength(1);
    expect(off).not.toHaveBeenCalled();
    release();
    await Promise.resolve();
    // Both afterTransaction handlers go: the scope tracker's and the manager's.
    expect(off.mock.calls.filter(([name]) => name === 'afterTransaction')).toHaveLength(2);
  });

  it('undoes a restore written through useDocEdit', () => {
    const doc = new Y.Doc();
    const undo = createLocalUndo([doc.getMap('data'), doc.getMap('blocks')]);
    doc.transact(() => doc.getMap('data').set('price', 2), EDIT_ORIGIN);
    undo.undo();
    expect(doc.getMap('data').toJSON()).toEqual({});
  });

  it('turns mod+Z, mod+Shift+Z and mod+Y into undo and redo', () => {
    const doc = new Y.Doc();
    const undo = createLocalUndo(doc.getMap('m'));
    stops.push(interceptUndoKeys([window], undo));
    doc.transact(() => doc.getMap('m').set('title', 'Mine'), LOCAL_ORIGIN);
    const z = press({ key: 'z', metaKey: true });
    expect(z.defaultPrevented).toBe(true);
    expect(doc.getMap('m').get('title')).toBeUndefined();
    press({ key: 'z', metaKey: true, shiftKey: true });
    expect(doc.getMap('m').get('title')).toBe('Mine');
    press({ key: 'z', ctrlKey: true });
    press({ key: 'y', ctrlKey: true });
    expect(doc.getMap('m').get('title')).toBe('Mine');
  });

  it('leaves keys inside a data-native-undo element to the element', () => {
    const doc = new Y.Doc();
    const undo = createLocalUndo(doc.getMap('m'));
    stops.push(interceptUndoKeys([window], undo));
    doc.transact(() => doc.getMap('m').set('title', 'Mine'), LOCAL_ORIGIN);
    const field = document.createElement('div');
    field.setAttribute('data-native-undo', '');
    const input = document.createElement('input');
    field.append(input);
    document.body.append(field);
    const event = press({ key: 'z', metaKey: true }, input);
    field.remove();
    expect(event.defaultPrevented).toBe(false);
    expect(doc.getMap('m').get('title')).toBe('Mine');
  });
});
