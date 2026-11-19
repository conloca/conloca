/// <reference lib="dom" />
// Sync and continue after the session answered not ok while the doc reconnected.
import { afterEach, expect, it, mock } from 'bun:test';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createFakeDocChannel } from '../../../test/fake-doc-channel.js';
import { type EditorFlushResult, registerEditorFlushHandler } from '../../editor-flush.js';
import type { LiveStatus } from '../../live/messages.js';
import { configureUI } from '../../ui-config.js';
import { UnsavedChangesDialog } from './UnsavedChangesDialog.js';

afterEach(() => {
  cleanup();
  configureUI({ docChannel: undefined });
});

const status = (pending: boolean, connection: LiveStatus['connection']): LiveStatus => ({
  connection,
  pending,
  persisted: false,
  readOnly: null,
  deletedExport: null,
});

it('leaves once the server has the work, after a flush that answered while the socket reconnected', async () => {
  // The session's flush answers at once while the doc reconnects (its contract: the wait is on the status).
  let synced = false;
  const fake = createFakeDocChannel(
    { mdx: 'Hello\n' },
    { flush: async (): Promise<EditorFlushResult> => (synced ? { ok: true } : { ok: false, message: 'Syncing…' }) },
  );
  configureUI({ docChannel: fake.channel });
  await act(() => fake.channel.receive('live.status', status(true, 'syncing')));
  const onDiscard = mock(() => {});
  render(<UnsavedChangesDialog live onSave={() => {}} onDiscard={onDiscard} onCancel={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Sync and continue' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Syncing…');
  // The handshake resent the edit and the server acked it: the pill reads Connected.
  synced = true;
  await act(() => fake.channel.receive('live.status', status(false, 'connected')));
  await waitFor(() => expect(onDiscard).toHaveBeenCalledTimes(1), { timeout: 1000 });
});

it('leaves when the answer predates the ack that already landed (#673 waits for persisted before it answers)', async () => {
  let flushes = 0;
  const fake = createFakeDocChannel(
    { mdx: 'Hello\n' },
    {
      flush: async (): Promise<EditorFlushResult> => {
        flushes += 1;
        if (flushes > 1) return { ok: true };
        // The ack lands while this flush waits; its answer is stale.
        fake.channel.receive('live.status', status(false, 'connected'));
        return { ok: false, message: 'Not synced, and this device could not keep your changes.' };
      },
    },
  );
  configureUI({ docChannel: fake.channel });
  await act(() => fake.channel.receive('live.status', status(true, 'syncing')));
  const onDiscard = mock(() => {});
  render(<UnsavedChangesDialog live onSave={() => {}} onDiscard={onDiscard} onCancel={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Sync and continue' }));
  await waitFor(() => expect(onDiscard).toHaveBeenCalledTimes(1), { timeout: 1000 });
});

it('syncs once more, not forever, when the session owes nothing yet never answers ok', async () => {
  let flushes = 0;
  const fake = createFakeDocChannel(
    { mdx: 'Hello\n' },
    {
      flush: async (): Promise<EditorFlushResult> => {
        flushes += 1;
        // A macrotask lets React render between answers, so a retry loop would show.
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { ok: false, message: 'Earlier work could not be read.' };
      },
    },
  );
  configureUI({ docChannel: fake.channel });
  await act(() => fake.channel.receive('live.status', status(false, 'connected')));
  const onDiscard = mock(() => {});
  render(<UnsavedChangesDialog live onSave={() => {}} onDiscard={onDiscard} onCancel={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Sync and continue' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Earlier work could not be read.');
  await waitFor(() => expect(flushes).toBe(2));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(flushes).toBe(2);
  expect(onDiscard).not.toHaveBeenCalled();
});

it("leaves once for the stage's sequence: offline Sync, release, Sync, then the status owes nothing", async () => {
  const answers: ((result: EditorFlushResult) => void)[] = [];
  const fake = createFakeDocChannel(
    { mdx: 'Hello\n' },
    { flush: () => new Promise<EditorFlushResult>((resolve) => answers.push(resolve)) },
  );
  configureUI({ docChannel: fake.channel });
  await act(() => fake.channel.receive('live.status', status(true, 'syncing')));
  const onDiscard = mock(() => {});
  render(<UnsavedChangesDialog live onSave={() => {}} onDiscard={onDiscard} onCancel={() => {}} />);
  // Held frames: the flush answers only once the dead socket closes, offline.
  fireEvent.click(screen.getByRole('button', { name: 'Sync and continue' }));
  await waitFor(() => expect(answers).toHaveLength(1));
  await act(() => fake.channel.receive('live.status', status(true, 'offline')));
  await act(async () => answers[0]({ ok: false, message: 'Offline. Your changes are kept on this device.' }));
  await screen.findByRole('alert');
  // Released: a new socket connects, and Sync is pressed again while it does.
  await act(() => fake.channel.receive('live.status', status(true, 'syncing')));
  fireEvent.click(screen.getByRole('button', { name: 'Sync and continue' }));
  await waitFor(() => expect(answers).toHaveLength(2));
  // The handshake resent the edit and the server acked it before this flush answers.
  await act(() => fake.channel.receive('live.status', status(false, 'connected')));
  await new Promise((resolve) => setTimeout(resolve, 20));
  await act(async () => {
    for (const answer of answers.slice(1)) answer({ ok: true });
  });
  await waitFor(() => expect(onDiscard).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(answers).toHaveLength(2);
  expect(onDiscard).toHaveBeenCalledTimes(1);
});

it('waits again when an auto-retry answers not ok while work is owed, then leaves once', async () => {
  const answers: ((result: EditorFlushResult) => void)[] = [];
  const fake = createFakeDocChannel(
    { mdx: 'Hello\n' },
    { flush: () => new Promise<EditorFlushResult>((resolve) => answers.push(resolve)) },
  );
  configureUI({ docChannel: fake.channel });
  await act(() => fake.channel.receive('live.status', status(true, 'syncing')));
  const onDiscard = mock(() => {});
  render(<UnsavedChangesDialog live onSave={() => {}} onDiscard={onDiscard} onCancel={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Sync and continue' }));
  await waitFor(() => expect(answers).toHaveLength(1));
  await act(async () => answers[0]({ ok: false, message: 'Syncing…' }));
  // Cleared: the auto-retry flushes, and the status owes work again before it answers not ok.
  await act(() => fake.channel.receive('live.status', status(false, 'connected')));
  await waitFor(() => expect(answers).toHaveLength(2));
  await act(() => fake.channel.receive('live.status', status(true, 'syncing')));
  await act(async () => answers[1]({ ok: false, message: 'Syncing…' }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(answers).toHaveLength(2);
  await act(() => fake.channel.receive('live.status', status(false, 'connected')));
  await waitFor(() => expect(answers).toHaveLength(3));
  await act(async () => answers[2]({ ok: true }));
  await waitFor(() => expect(onDiscard).toHaveBeenCalledTimes(1));
});

it('leaves anyway while the retry after a failed Sync is still running, and only once', async () => {
  const answers: ((result: EditorFlushResult) => void)[] = [];
  const fake = createFakeDocChannel(
    { mdx: 'Hello\n' },
    { flush: () => new Promise<EditorFlushResult>((resolve) => answers.push(resolve)) },
  );
  configureUI({ docChannel: fake.channel });
  await act(() => fake.channel.receive('live.status', status(false, 'connected')));
  const onDiscard = mock(() => {});
  render(<UnsavedChangesDialog live onSave={() => {}} onDiscard={onDiscard} onCancel={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Sync and continue' }));
  await waitFor(() => expect(answers).toHaveLength(1));
  await act(async () => answers[0]({ ok: false, message: 'Held.' }));
  // The clicked Sync syncs once more on its own; its answer has not come.
  await waitFor(() => expect(answers).toHaveLength(2));
  fireEvent.click(screen.getByRole('button', { name: 'Leave anyway' }));
  expect(onDiscard).toHaveBeenCalledTimes(1);
  await act(async () => answers[1]({ ok: true }));
  expect(onDiscard).toHaveBeenCalledTimes(1);
});

it('shows the error and re-enables the buttons when the flush rejects', async () => {
  // No doc channel: the open editor's flush runs, and nothing below the dialog catches its rejection.
  const unregister = registerEditorFlushHandler(() => Promise.reject(new Error('Socket gone.')));
  const onDiscard = mock(() => {});
  try {
    render(<UnsavedChangesDialog live onSave={() => {}} onDiscard={onDiscard} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sync and continue' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Socket gone.');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sync and continue' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Leave anyway' })).toBeEnabled();
    expect(onDiscard).not.toHaveBeenCalled();
  } finally {
    unregister();
  }
});

it('does nothing when the flush answers ok after Stay closed the dialog', async () => {
  const answers: ((result: EditorFlushResult) => void)[] = [];
  const fake = createFakeDocChannel(
    { mdx: 'Hello\n' },
    { flush: () => new Promise<EditorFlushResult>((resolve) => answers.push(resolve)) },
  );
  configureUI({ docChannel: fake.channel });
  await act(() => fake.channel.receive('live.status', status(true, 'syncing')));
  // As blocker.proceed after a reset: react-router throws 'Invalid blocker state transition'.
  const onDiscard = mock(() => {
    throw new Error('Invalid blocker state transition unblocked -> proceeding');
  });
  const rejections = mock((_reason: unknown) => {});
  process.on('unhandledRejection', rejections);
  const onCancel = mock(() => {});
  const view = render(<UnsavedChangesDialog live onSave={() => {}} onDiscard={onDiscard} onCancel={onCancel} />);
  fireEvent.click(screen.getByRole('button', { name: 'Sync and continue' }));
  await waitFor(() => expect(answers).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  // The blocker resets, which unmounts the dialog; the answer lands after.
  view.unmount();
  await act(async () => answers[0]({ ok: true }));
  await act(() => fake.channel.receive('live.status', status(false, 'connected')));
  await new Promise((resolve) => setTimeout(resolve, 20));
  process.off('unhandledRejection', rejections);
  expect(onDiscard).not.toHaveBeenCalled();
  expect(rejections).not.toHaveBeenCalled();
});

it('does not leave when Stay was pressed, even if the dialog stays mounted', async () => {
  const answers: ((result: EditorFlushResult) => void)[] = [];
  const fake = createFakeDocChannel(
    { mdx: 'Hello\n' },
    { flush: () => new Promise<EditorFlushResult>((resolve) => answers.push(resolve)) },
  );
  configureUI({ docChannel: fake.channel });
  await act(() => fake.channel.receive('live.status', status(true, 'syncing')));
  const onDiscard = mock(() => {});
  render(<UnsavedChangesDialog live onSave={() => {}} onDiscard={onDiscard} onCancel={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Sync and continue' }));
  await waitFor(() => expect(answers).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
  await act(async () => answers[0]({ ok: true }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(onDiscard).not.toHaveBeenCalled();
});

it('drops an armed retry on Stay while the dialog stays mounted', async () => {
  let flushes = 0;
  const fake = createFakeDocChannel(
    { mdx: 'Hello\n' },
    {
      flush: async (): Promise<EditorFlushResult> => {
        flushes += 1;
        return { ok: false, message: 'Syncing…' };
      },
    },
  );
  configureUI({ docChannel: fake.channel });
  await act(() => fake.channel.receive('live.status', status(true, 'syncing')));
  const onDiscard = mock(() => {});
  render(<UnsavedChangesDialog live onSave={() => {}} onDiscard={onDiscard} onCancel={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Sync and continue' }));
  // Not ok while pending: a retry is armed for when the status clears.
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
  await act(() => fake.channel.receive('live.status', status(false, 'connected')));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(flushes).toBe(1);
  expect(onDiscard).not.toHaveBeenCalled();
});

it("does not leave for an earlier target when the first flush answers during a second navigation's prompt", async () => {
  const answers: ((result: EditorFlushResult) => void)[] = [];
  const fake = createFakeDocChannel(
    { mdx: 'Hello\n' },
    { flush: () => new Promise<EditorFlushResult>((resolve) => answers.push(resolve)) },
  );
  configureUI({ docChannel: fake.channel });
  await act(() => fake.channel.receive('live.status', status(true, 'syncing')));
  const toA = mock(() => {});
  const first = render(<UnsavedChangesDialog live onSave={() => {}} onDiscard={toA} onCancel={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Sync and continue' }));
  await waitFor(() => expect(answers).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
  first.unmount();
  // A second navigation, to B, raises a fresh prompt.
  const toB = mock(() => {});
  render(<UnsavedChangesDialog live onSave={() => {}} onDiscard={toB} onCancel={() => {}} />);
  await act(async () => answers[0]({ ok: true }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(toA).not.toHaveBeenCalled();
  expect(toB).not.toHaveBeenCalled();
  expect(answers).toHaveLength(1);
});
