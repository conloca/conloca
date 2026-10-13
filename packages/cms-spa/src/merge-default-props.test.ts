import { describe, expect, it } from 'bun:test';
import type { Data } from '@puckeditor/core';
import { mergeDefaultProps } from './merge-default-props.js';

describe('mergeDefaultProps', () => {
  const config = {
    components: {
      Hero: { defaultProps: { title: 'Default', cta: 'Learn more' } },
    },
  } as never;

  it('layers component defaultProps under the stored sparse props', () => {
    const merged = mergeDefaultProps({ content: [{ type: 'Hero', props: { title: 'Stored' } }] } as never, config);
    expect(merged.content[0].props).toEqual({ title: 'Stored', cta: 'Learn more' });
  });

  it('applies defaults inside zones as well as top-level content', () => {
    const merged = mergeDefaultProps(
      { content: [], zones: { 'x:zone': [{ type: 'Hero', props: {} }] } } as never,
      config,
    );
    expect(merged.zones?.['x:zone'][0].props).toEqual({ title: 'Default', cta: 'Learn more' });
  });

  it('passes data through unchanged when it has no content or the config has no components', () => {
    const data = { content: [{ type: 'Unknown', props: { a: 1 } }] } as never;
    // Same reference back (early return) when the config carries no components…
    expect(mergeDefaultProps(data, {} as never)).toBe(data);
    // …and when the data carries no content.
    const empty = { content: undefined } as never;
    expect(mergeDefaultProps(empty, config)).toBe(empty);
  });
});

describe('mergeDefaultProps for blocks inside a slot', () => {
  // A template block whose slot starts out holding one Hero.
  const config = {
    components: {
      Template: { fields: { content: { type: 'slot' } }, defaultProps: { content: [{ type: 'Hero', props: {} }] } },
      Hero: { defaultProps: { title: 'Default', cta: 'Learn more' } },
    },
  } as never;

  it('fills defaults into a block that sits in a slot', () => {
    const merged = mergeDefaultProps(
      {
        root: {},
        content: [
          { type: 'Template', props: { id: 't', content: [{ type: 'Hero', props: { id: 'h', title: 'Stored' } }] } },
        ],
      } as Data,
      config,
    );

    expect(merged.content[0].props.content[0].props).toEqual({ id: 'h', title: 'Stored', cta: 'Learn more' });
  });

  it("seeds a missing slot from the block's defaults, with defaults and an id on each seeded child", () => {
    // What the create dialog stores: the template block and nothing else.
    const stored: Data = { root: {}, content: [{ type: 'Template', props: { id: 't' } }] };
    const seeded = mergeDefaultProps(stored, config).content[0].props.content[0].props;

    expect(seeded.title).toBe('Default');
    // Puck splits zone keys on ':', so an id carrying one would break the editor.
    expect(seeded.id).toMatch(/^[^:]+$/);
    // The editor and the published page each read the page on their own, so
    // both must arrive at the same id for the same stored page.
    expect(mergeDefaultProps(stored, config).content[0].props.content[0].props.id).toBe(seeded.id);
  });
});
