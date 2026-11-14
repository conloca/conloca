import { serializeDoc } from '@conloca/content-api/ydoc';
import type { Config, Data } from '@puckeditor/core';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { createFakeDocChannel, type FakeDocChannel } from '../../../test/fake-doc-channel.js';
import type { PageRef } from '../../draft-tools.js';
import type { FrameLiveDoc } from '../../live/doc-channel.js';
import { applyDocEdits } from '../../live/use-live.js';
import { configureUI, getUIConfig } from '../../ui-config.js';
import '../../main.css';
import { EditorNoticeStrip } from './EditorNoticeStrip.js';
import { OverwriteNotice } from './OverwriteNotice.js';

const PAGE: PageRef = { site: 'default', id: 'home', locale: 'en' };
const config: Config = {
  components: {
    Hero: { label: 'Hero', fields: { title: { type: 'text', label: 'Hero title' } }, render: () => <div /> },
  },
};
const data: Data = { root: { props: {} }, content: [{ type: 'Hero', props: { id: 'hero-1', title: 'Summer sale' } }] };

/** A teammate replaced this person's value; they can put theirs back or dismiss the notice. */
const meta = {
  component: OverwriteNotice,
  args: { label: 'Hero title', byName: 'Maria', onRestore: fn(), onDismiss: fn() },
} satisfies Meta<typeof OverwriteNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Restore: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('status')).toHaveTextContent('Maria changed Hero title.');
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Restore yours' })).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Dismiss' })).toHaveFocus();
    await userEvent.click(canvas.getByRole('button', { name: 'Restore yours' }));
    await expect(args.onRestore).toHaveBeenCalled();
  },
};

let fake: FakeDocChannel;
let opened: FrameLiveDoc | undefined;

/** The strip on a live page, bound to its doc so `Restore yours` writes into it. */
function LiveStrip() {
  const [client] = useState(() => new QueryClient());
  const [live, setLive] = useState<FrameLiveDoc>();
  useEffect(() => {
    const previous = getUIConfig();
    fake = createFakeDocChannel({ puckData: data });
    configureUI({ ...previous, docChannel: fake.channel });
    void fake.channel.open({ kind: 'puck', id: PAGE.id, locale: PAGE.locale }).then((doc) => {
      opened = doc;
      setLive(doc);
    });
    return () => configureUI(previous);
  }, []);
  if (!live) return null;
  return (
    <QueryClientProvider client={client}>
      <EditorNoticeStrip page={PAGE} data={data} config={config} docKey={live.docKey} />
    </QueryClientProvider>
  );
}

const overwritten = (anchor: string) =>
  ({
    type: 'conloca:overwritten',
    ...PAGE,
    anchor,
    value: 'Spring sale',
    byUserId: 'u_maria',
    byName: 'Maria',
  }) as const;

export const StripShowsOverwrite: Story = {
  render: () => <LiveStrip />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(opened).toBeDefined());
    fake.emit(overwritten('content[id=hero-1].props.title'));
    await expect(await canvas.findByText('Maria changed Hero title.')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Restore yours' }));
    await waitFor(() => expect(canvas.queryByText('Maria changed Hero title.')).toBeNull());
    const doc = opened ? serializeDoc(opened.doc).puckData : undefined;
    await expect(doc?.content[0]?.props.title).toBe('Spring sale');
  },
};

/** The field changed again after the notice: Restore yours writes nothing and says so. */
export const RestoreRefusedAfterNewerChange: Story = {
  render: () => <LiveStrip />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(opened).toBeDefined());
    const anchor = 'content[id=hero-1].props.title';
    fake.emit(overwritten(anchor));
    await expect(await canvas.findByText('Maria changed Hero title.')).toBeVisible();
    // A third teammate's later value arrives in the doc.
    await expect(applyDocEdits(opened, [{ anchor, value: 'Autumn sale' }])).toEqual({ ok: true });
    await userEvent.click(canvas.getByRole('button', { name: 'Restore yours' }));
    await expect(await canvas.findByRole('alert')).toHaveTextContent('Changed again since. Check the field.');
    const doc = opened ? serializeDoc(opened.doc).puckData : undefined;
    await expect(doc?.content[0]?.props.title).toBe('Autumn sale');
  },
};

export const MdxBodyNeverNotified: Story = {
  render: () => <LiveStrip />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(opened).toBeDefined());
    fake.emit(overwritten('body#3'));
    // A later notice for a field shows: the prose one before it was dropped, not still on its way.
    fake.emit(overwritten('content[id=hero-1].props.title'));
    await expect(await canvas.findByText('Maria changed Hero title.')).toBeVisible();
    await expect(canvas.getAllByRole('button', { name: 'Dismiss' })).toHaveLength(1);
  },
};
