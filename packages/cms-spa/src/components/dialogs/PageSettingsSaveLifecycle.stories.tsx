import type { FieldConflict } from '@conloca/content-api';
import type { Meta, StoryObj } from '@storybook/react-vite';
import React, { useState } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import '../../main.css';
import type { PageMetadata } from '../../types.js';
import { pageSettingsSaveError } from '../../utils/pageMetadata.js';
import { PageMetadataDialog } from './PageMetadataDialog.js';

let finishWrite: (() => void) | undefined;
const savedPage: PageMetadata = {
  title: 'Saved article',
  pathname: '/article',
  description: 'An article being edited.',
  customMeta: {},
  publishDate: null,
  unpublishDate: null,
  collection: 'pages',
  type: 'puck',
};

/** Real settings dialog with a controllable response, not a live production write. */
function SaveHarness({ reject = false }: { reject?: boolean }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('No write submitted');
  const save = async (metadata: PageMetadata) => {
    setStatus(`Pending write: ${metadata.title}`);
    await new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    setStatus('Server response received');
    if (reject) throw new Error('Storage unavailable. Your draft has not been saved.');
  };
  return (
    <main style={{ padding: 40, minHeight: '100vh', background: '#f7f8fa', color: '#17202a' }}>
      <h1 style={{ fontSize: 26, fontWeight: 600 }}>Page settings · save lifecycle</h1>
      <p style={{ marginTop: 12 }}>Real editor component with a controlled server response.</p>
      <p role="status" style={{ margin: '24px 0' }}>
        {status}
      </p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ padding: '10px 18px', background: '#173de8', color: 'white', borderRadius: 6 }}
      >
        Page settings
      </button>
      <PageMetadataDialog open={open} onOpenChange={setOpen} page={savedPage} onSave={save} />
    </main>
  );
}
const meta = {
  title: 'Editor/PageSettingsSaveLifecycle',
  component: SaveHarness,
  parameters: { layout: 'fullscreen' },
  args: { reject: false },
  render: (args) => (
    <React.StrictMode>
      <SaveHarness {...args} />
    </React.StrictMode>
  ),
} satisfies Meta<typeof SaveHarness>;
export default meta;
type Story = StoryObj<typeof meta>;

async function startWrite(canvasElement: HTMLElement) {
  const view = within(canvasElement.ownerDocument.body);
  await userEvent.click(view.getByRole('button', { name: 'Page settings' }));
  const title = await view.findByRole('textbox', { name: /^Title/ });
  await userEvent.clear(title);
  await userEvent.type(title, 'First saved draft');
  await userEvent.click(view.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(view.getByRole('status', { hidden: true })).toHaveTextContent('Pending write'));
  return view;
}
async function finish(view: ReturnType<typeof within>) {
  if (!finishWrite) throw new Error('No pending write');
  finishWrite();
  await waitFor(() => expect(view.getByRole('status', { hidden: true })).toHaveTextContent('Server response received'));
}

export const ReopenedDraftSurvives: Story = {
  play: async ({ canvasElement }) => {
    const view = await startWrite(canvasElement);
    await userEvent.click(view.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(view.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.click(view.getByRole('button', { name: 'Page settings' }));
    const title = await view.findByRole('textbox', { name: /^Title/ });
    await userEvent.clear(title);
    await userEvent.type(title, 'New unsaved draft');
    await finish(view);
    expect(view.getByRole('dialog')).toBeInTheDocument();
    expect(view.getByRole('textbox', { name: /^Title/ })).toHaveValue('New unsaved draft');
  },
};
export const EditsDuringWriteSurvive: Story = {
  play: async ({ canvasElement }) => {
    const view = await startWrite(canvasElement);
    const title = view.getByRole('textbox', { name: /^Title/ });
    await userEvent.clear(title);
    await userEvent.type(title, 'Newer unsaved changes');
    await finish(view);
    expect(view.getByRole('dialog')).toBeInTheDocument();
    expect(view.getByRole('textbox', { name: /^Title/ })).toHaveValue('Newer unsaved changes');
    expect(view.getByRole('button', { name: 'Save' })).toBeEnabled();
  },
};
export const FailedSaveKeepsDraft: Story = {
  args: { reject: true },
  play: async ({ canvasElement }) => {
    const view = await startWrite(canvasElement);
    await finish(view);
    await waitFor(() => expect(view.getByRole('alert')).toHaveTextContent('Storage unavailable'));
    expect(view.getByRole('textbox', { name: /^Title/ })).toHaveValue('First saved draft');
    expect(view.getByRole('button', { name: 'Save' })).toBeEnabled();
  },
};

const TITLE_CLASH: FieldConflict = {
  anchor: 'meta.title',
  base: 'Saved article',
  ours: 'Mine',
  theirs: 'Pricing for teams',
};
const CLASH_MESSAGE = 'Title changed while you were editing (last edited by Maria). Check it and apply again.';

/** Saves refused for a clash on the title until the person applies again. */
function ClashHarness({ onSave }: { onSave: (metadata: PageMetadata) => void }) {
  const [open, setOpen] = useState(true);
  const save = async (metadata: PageMetadata) => {
    onSave(metadata);
    throw pageSettingsSaveError({
      success: false,
      reason: 'stale_write',
      conflictDetails: { metaChanged: true, contentChanged: false, conflicts: [TITLE_CLASH], changedBy: 'Maria' },
    });
  };
  return <PageMetadataDialog open={open} onOpenChange={setOpen} page={savedPage} onSave={save} />;
}

/** A clash on the title loads the other value into the field, says so, and keeps the dialog open for another Save. */
export const ClashReloadsField: StoryObj<typeof ClashHarness> = {
  args: { onSave: fn() },
  render: (args) => <ClashHarness {...args} />,
  play: async ({ args, canvasElement }) => {
    const view = within(canvasElement.ownerDocument.body);
    const title = await view.findByRole('textbox', { name: /^Title/ });
    await userEvent.clear(title);
    await userEvent.type(title, 'Mine');
    await userEvent.click(view.getByRole('button', { name: 'Save' }));
    await expect(await view.findByRole('alert')).toHaveTextContent(CLASH_MESSAGE);
    await expect(title).toHaveValue('Pricing for teams');
    await expect(view.getByRole('dialog')).toBeInTheDocument();
    await userEvent.click(view.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(args.onSave).toHaveBeenCalledTimes(2));
    await expect(args.onSave).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Pricing for teams' }));
  },
};
