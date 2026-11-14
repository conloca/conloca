import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { serializeDoc } from '@conloca/content-api/ydoc';
import { cleanup, render } from '@testing-library/react';
import type * as Y from 'yjs';
import { createFakeDocChannel } from '../../test/fake-doc-channel.js';
import { configureUI } from '../ui-config.js';
import { EDIT_ORIGIN, type FrameLiveDoc } from './doc-channel.js';
import { createLocalUndo } from './undo.js';
import { type DocEditResult, type DocEdits, useDocEdit, useDocEdits } from './use-live.js';

const PAGE = {
  puckData: {
    root: { props: { seoTitle: 'Old' } },
    content: [{ type: 'Hero', props: { id: 'hero-1', title: 'Theirs' } }],
    zones: {},
  },
};

type Edit = (anchor: string, value: string | null | undefined) => DocEditResult;

/** Mounts `useDocEdit` for `docKey` and hands back the edit function it returned. */
function mountEdit(docKey: string): Edit {
  let edit: Edit | undefined;
  function Probe() {
    edit = useDocEdit(docKey);
    return null;
  }
  render(<Probe />);
  if (!edit) throw new Error('not mounted');
  return edit;
}

async function openWith(content: Parameters<typeof createFakeDocChannel>[0], kind: 'puck' | 'data' | 'mdx') {
  const fake = createFakeDocChannel(content);
  configureUI({ docChannel: fake.channel });
  const live: FrameLiveDoc = await fake.channel.open({ kind, id: 'x', locale: 'en' });
  return { fake, live };
}

afterEach(() => {
  cleanup();
  configureUI({ docChannel: undefined });
});

describe('useDocEdit', () => {
  it('refuses a write whose expected value no longer matches, and writes when it does', async () => {
    const { live } = await openWith(PAGE, 'puck');
    let edit: ReturnType<typeof useDocEdit> | undefined;
    function Probe() {
      edit = useDocEdit(live.docKey);
      return null;
    }
    render(<Probe />);
    const anchor = 'content[id=hero-1].props.title';
    expect(edit?.(anchor, 'Mine', { value: 'Older' })).toMatchObject({ ok: false, reason: 'changed' });
    expect(serializeDoc(live.doc).puckData.content[0].props.title).toBe('Theirs');
    expect(edit?.(anchor, 'Mine', { value: 'Theirs' })).toEqual({ ok: true });
    expect(serializeDoc(live.doc).puckData.content[0].props.title).toBe('Mine');
  });

  it('restores an overwritten Puck prop as a local, undoable edit', async () => {
    const { fake, live } = await openWith(PAGE, 'puck');
    const undo = createLocalUndo([live.doc.getMap('puck'), live.doc.getMap('blocks')]);
    const edit = mountEdit(live.docKey);
    expect(edit('content[id=hero-1].props.title', 'Mine')).toEqual({ ok: true });
    expect(serializeDoc(live.doc).puckData.content[0].props.title).toBe('Mine');
    expect(serializeDoc(fake.parent(live.docKey)).puckData.content[0].props.title).toBe('Mine');
    undo.undo();
    expect(serializeDoc(live.doc).puckData.content[0].props.title).toBe('Theirs');
  });

  it('writes a page setting and a data field by anchor', async () => {
    const page = await openWith(PAGE, 'puck');
    const origins: unknown[] = [];
    page.live.doc.on('afterTransaction', (tr: Y.Transaction) => origins.push(tr.origin));
    expect(mountEdit(page.live.docKey)('root.props.seoTitle', 'New')).toEqual({ ok: true });
    expect(serializeDoc(page.live.doc).puckData.root.props.seoTitle).toBe('New');
    // Not LOCAL_ORIGIN: every binding re-seeds its view from it.
    expect(origins).toEqual([EDIT_ORIGIN]);
    cleanup();
    const data = await openWith({ data: { price: 1, name: 'a' } }, 'data');
    expect(mountEdit(data.live.docKey)('data.price', '2')).toEqual({ ok: true });
    expect(serializeDoc(data.live.doc).data).toEqual({ price: '2', name: 'a' });
  });

  it('removes a key written as undefined, and writes frontmatter of an MDX page', async () => {
    const { live } = await openWith({ mdx: '---\ntitle: Old\ndraft: true\n---\n\n# Body\n' }, 'mdx');
    let edits: DocEdits | undefined;
    function Probe() {
      edits = useDocEdits(live.docKey);
      return null;
    }
    render(<Probe />);
    expect(
      edits?.([
        { anchor: 'frontmatter.title', value: 'New' },
        { anchor: 'frontmatter.draft', value: undefined },
      ]),
    ).toEqual({ ok: true });
    expect(serializeDoc(live.doc).mdx).toBe('---\ntitle: New\n---\n\n# Body\n');
  });

  // The server refuses a client's `_meta` write; the section of a page without front matter is derived from the map.
  it('restores a setting of an MDX page without front matter without writing _meta', async () => {
    const { fake, live } = await openWith({ mdx: 'Hello\n' }, 'mdx');
    const metaWrites: string[][] = [];
    fake
      .parent(live.docKey)
      .getMap('_meta')
      .observe((event) => metaWrites.push([...event.keysChanged]));
    expect(mountEdit(live.docKey)('frontmatter.title', 'New')).toEqual({ ok: true });
    expect(metaWrites).toEqual([]);
    expect(serializeDoc(fake.parent(live.docKey)).mdx).toBe('---\ntitle: New\n---\nHello\n');
  });

  it('reports a deleted block instead of doing nothing', async () => {
    const { fake, live } = await openWith(PAGE, 'puck');
    const before = fake.updates().length;
    expect(mountEdit(live.docKey)('content[id=gone].props.title', 'x')).toEqual({
      ok: false,
      reason: 'not-found',
      message: 'This block was deleted, so the value could not be restored.',
    });
    expect(fake.updates()).toHaveLength(before);
  });

  it('reports a key that is not open', async () => {
    const { live } = await openWith(PAGE, 'puck');
    expect(mountEdit(`${live.docKey}-other`)('root.props.seoTitle', 'x')).toMatchObject({
      ok: false,
      reason: 'not-open',
    });
  });

  it('reports a closing key as not open and writes nothing', async () => {
    const { fake, live } = await openWith({ data: { title: 'A' } }, 'data');
    live.close();
    expect(mountEdit(live.docKey)('data.title', 'restored')).toMatchObject({ ok: false, reason: 'not-open' });
    expect(serializeDoc(live.doc).data).toEqual({ title: 'A' });
    expect(fake.updates()).toHaveLength(0);
  });

  it('reports a write that throws', async () => {
    const { fake, live } = await openWith({ data: { price: 1 } }, 'data');
    // A doc without its kind tag: reading it throws.
    live.doc.transact(() => live.doc.getMap('_meta').delete('kind'));
    const before = fake.updates().length;
    const logged = spyOn(console, 'error').mockImplementation(() => {});
    const result = mountEdit(live.docKey)('root.props.title', 'x');
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();
    expect(result).toMatchObject({ ok: false, reason: 'error' });
    expect(fake.updates()).toHaveLength(before);
  });

  it('refuses to write into a held replica', async () => {
    const { live } = await openWith(PAGE, 'puck');
    live.hold('This change could not be applied. Copy your changes, then reload the page.');
    expect(mountEdit(live.docKey)('root.props.seoTitle', 'x')).toEqual({
      ok: false,
      reason: 'error',
      message: 'This change could not be applied. Copy your changes, then reload the page.',
    });
  });
});
