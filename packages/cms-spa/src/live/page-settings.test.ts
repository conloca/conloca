import { describe, expect, it } from 'bun:test';
import { serializeDoc } from '@conloca/content-api/ydoc';
import { createFakeDocChannel } from '../../test/fake-doc-channel.js';
import { pageSettingEdits } from './page-settings.js';
import { applyDocEdits } from './use-live.js';

describe('pageSettingEdits', () => {
  it('writes keys with a dot, a space and a non-ASCII letter as themselves', async () => {
    const fake = createFakeDocChannel({ mdx: '---\na:\n  b: 0\na.b: 1\nmy key: x\ntítulo: y\n---\nHello\n' });
    const live = await fake.channel.open({ kind: 'mdx', id: 'x', locale: 'en' });
    const frontmatter = live.doc.getMap('frontmatter').toJSON();
    const edits = pageSettingEdits(frontmatter, { 'a.b': 2, 'my key': 'z', título: 'w' });

    expect(applyDocEdits(live, edits)).toEqual({ ok: true });
    expect(live.doc.getMap('frontmatter').toJSON()).toEqual({ a: { b: 0 }, 'a.b': 2, 'my key': 'z', título: 'w' });
    expect(serializeDoc(live.doc).mdx).toContain('Hello');
  });

  it('removes a nested object whose values are all cleared', () => {
    expect(pageSettingEdits({ sidebar: { label: 'x' } }, { sidebar: { label: null, order: null } })).toEqual([
      { anchor: 'frontmatter.sidebar', value: undefined },
    ]);
  });

  it('skips unchanged keys and keeps the values a nested object still has', () => {
    expect(pageSettingEdits({ title: 'Same' }, { title: 'Same', sidebar: { label: 'L', order: null } })).toEqual([
      { anchor: 'frontmatter.sidebar', value: { label: 'L' } },
    ]);
  });
});
