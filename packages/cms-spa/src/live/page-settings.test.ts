import { describe, expect, it } from 'bun:test';
import { serializeDoc } from '@conloca/content-api/ydoc';
import { createFakeDocChannel } from '../../test/fake-doc-channel.js';
import { pageSettingClashes, pageSettingEdits } from './page-settings.js';
import { applyDocEdits } from './use-live.js';

describe('pageSettingEdits', () => {
  it('writes keys with a dot, a space and a non-ASCII letter as themselves', async () => {
    const fake = createFakeDocChannel({ mdx: '---\na:\n  b: 0\na.b: 1\nmy key: x\ntítulo: y\n---\nHello\n' });
    const live = await fake.channel.open({ kind: 'mdx', id: 'x', locale: 'en' });
    const frontmatter = live.doc.getMap('frontmatter').toJSON();
    const edits = pageSettingEdits(frontmatter, { 'a.b': 2, 'my key': 'z', título: 'w' }, frontmatter);

    expect(applyDocEdits(live, edits)).toEqual({ ok: true });
    expect(live.doc.getMap('frontmatter').toJSON()).toEqual({ a: { b: 0 }, 'a.b': 2, 'my key': 'z', título: 'w' });
    expect(serializeDoc(live.doc).mdx).toContain('Hello');
  });

  it('removes a nested object whose values are all cleared', () => {
    const was = { sidebar: { label: 'x' } };
    expect(pageSettingEdits(was, { sidebar: { label: null, order: null } }, was)).toEqual([
      { key: 'sidebar', anchor: 'frontmatter.sidebar', value: undefined, expected: { label: 'x' } },
    ]);
  });

  it('skips unchanged keys and keeps the values a nested object still has', () => {
    const was = { title: 'Same' };
    expect(pageSettingEdits(was, { title: 'Same', sidebar: { label: 'L', order: null } }, was)).toEqual([
      { key: 'sidebar', anchor: 'frontmatter.sidebar', value: { label: 'L' }, expected: undefined },
    ]);
  });

  it("keeps a teammate's change: an untouched setting is not written, a changed one clashes with theirs", async () => {
    const fake = createFakeDocChannel({ mdx: '---\ntitle: Old\ndescription: Old desc\n---\nHello\n' });
    const live = await fake.channel.open({ kind: 'mdx', id: 'x', locale: 'en' });
    const opened = live.doc.getMap('frontmatter').toJSON();
    // The teammate changes both while the dialog is open.
    live.doc.getMap('frontmatter').set('title', 'Theirs');
    live.doc.getMap('frontmatter').set('description', 'Their desc');
    const frontmatter = live.doc.getMap('frontmatter').toJSON();

    const edits = pageSettingEdits(frontmatter, { title: 'Mine', description: 'Old desc' }, opened);
    expect(applyDocEdits(live, edits)).toMatchObject({ ok: false, reason: 'changed' });
    expect(pageSettingClashes(frontmatter, edits)).toEqual([
      { anchor: 'frontmatter.title', base: 'Old', ours: 'Mine', theirs: 'Theirs' },
    ]);
    expect(live.doc.getMap('frontmatter').toJSON()).toEqual({ title: 'Theirs', description: 'Their desc' });

    // The retry starts from the front matter as it is now, as the dialog reloads it.
    const retry = pageSettingEdits(frontmatter, { title: 'Mine', description: 'Their desc' }, frontmatter);
    expect(applyDocEdits(live, retry)).toEqual({ ok: true });
    expect(live.doc.getMap('frontmatter').toJSON()).toEqual({ title: 'Mine', description: 'Their desc' });
  });
});
