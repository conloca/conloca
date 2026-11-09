import type { LocalizedEntry } from '@conloca/content-api-client';
import { type Config, type CustomField, type Data, Puck, type PuckApi, useGetPuck } from '@puckeditor/core';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import '../../main.css';
import { PageEditor } from './PageEditor.js';

/**
 * How Puck takes page data that changed elsewhere (another editor's edit) while the author is typing: the co-editing
 * binding applies it with `dispatch({ type: 'setData', recordHistory: false })`. These stories pin that this keeps the
 * focused field mounted with its caret, stays out of Puck's undo history, and that a capture-phase key listener can
 * take Ctrl/Cmd+Z, Shift+Z and Y away from Puck's own undo, in the editor window and on the canvas.
 *
 * Each runs on Puck itself and on the page editor, which is what the binding drives.
 *
 * This lives in the browser target because focus, caret and Puck's canvas iframe need a real browser.
 */

type GetPuck = () => PuckApi;

/** What the fields leave for the play functions: Puck's API, and how often the `text` field has mounted. */
interface SpikeState {
  getPuck?: GetPuck;
  textMounts: number;
  onChangeCalls: number;
}

const spike: SpikeState = { textMounts: 0, onChangeCalls: 0 };

/** A plain text input whose mounts are counted: a remount loses focus and caret. */
function CountedTextField({
  name,
  value,
  onChange,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const getPuck = useGetPuck();
  useEffect(() => {
    spike.getPuck = getPuck;
  }, [getPuck]);
  useEffect(() => {
    if (name === 'text') spike.textMounts += 1;
  }, [name]);
  return <input aria-label={name} value={value} onChange={(event) => onChange(event.currentTarget.value)} />;
}

const countedTextField: CustomField<string> = { type: 'custom', render: CountedTextField };

const SPIKE_CONFIG: Config = {
  // The root field shows while no block is selected, so Puck's API is reachable before the play selects one.
  root: { fields: { title: countedTextField } },
  components: {
    Block: {
      fields: { text: countedTextField, note: { type: 'text' } },
      render: ({ text, note }) => (
        <section>
          <p data-spike="text">{text}</p>
          <p data-spike="note">{note}</p>
        </section>
      ),
    },
  },
};

const SPIKE_DATA: Data = {
  root: { props: { title: 'Spike page' } },
  content: [
    { type: 'Block', props: { id: 'Block-A', text: 'Hello world', note: 'A note' } },
    { type: 'Block', props: { id: 'Block-B', text: 'Second block', note: 'B note' } },
  ],
};

const SPIKE_PAGE: LocalizedEntry = {
  id: 'spike',
  type: 'puck',
  kind: 'page',
  site: 'default',
  collection: 'pages',
  localized: {
    locale: 'en',
    pathname: '/spike',
    etag: 'meta.content',
    created: '2026-09-01T10:00:00.000Z',
    modified: '2026-09-01T10:00:00.000Z',
    meta: { title: 'Spike page' },
    content: { puckData: SPIKE_DATA },
  },
};

/** Puck's history records 250 ms after the last change; waiting longer lets any pending record land. */
const PAST_HISTORY_DEBOUNCE_MS = 400;

const settle = () => new Promise((resolve) => setTimeout(resolve, PAST_HISTORY_DEBOUNCE_MS));

function useFreshSpike() {
  useState(() => {
    spike.getPuck = undefined;
    spike.textMounts = 0;
    spike.onChangeCalls = 0;
    return null;
  });
}

function BarePuck() {
  useFreshSpike();
  return (
    <div style={{ height: '800px' }}>
      <Puck
        config={SPIKE_CONFIG}
        data={SPIKE_DATA}
        onChange={() => {
          spike.onChangeCalls += 1;
        }}
      />
    </div>
  );
}

/** The page editor on the spike page; its unsaved-changes guard needs a data router. */
function SpikePageEditor() {
  useFreshSpike();
  const [router] = useState(() =>
    createMemoryRouter([
      {
        path: '/',
        element: (
          <PageEditor
            entry={SPIKE_PAGE}
            config={SPIKE_CONFIG}
            availableLocales={['en']}
            onSave={async () => ({ success: true })}
            onBack={() => {}}
            onOpenMetadata={() => {}}
          />
        ),
      },
    ]),
  );
  return (
    <div style={{ height: '800px' }}>
      <RouterProvider router={router} />
    </div>
  );
}

function canvasFrame(canvasElement: HTMLElement): HTMLIFrameElement {
  const frame = canvasElement.querySelector<HTMLIFrameElement>('iframe#preview-frame');
  if (!frame?.contentWindow) throw new Error('the canvas iframe is not there');
  return frame;
}

/** Waits until the canvas shows `expected` for one prop of a block. */
async function expectOnCanvas(canvasElement: HTMLElement, blockId: string, prop: string, expected: string) {
  await waitFor(
    () =>
      expect(
        canvasFrame(canvasElement).contentDocument?.querySelector(
          `[data-puck-component="${blockId}"] [data-spike="${prop}"]`,
        )?.textContent,
      ).toBe(expected),
    { timeout: 10_000 },
  );
}

const SELECT_BLOCK_A = { type: 'setUi', ui: { itemSelector: { index: 0, zone: 'root:default-zone' } } } as const;

/** Waits for the canvas, selects block A and puts the caret at 3 in its `text` field. */
async function focusBlockAText(canvasElement: HTMLElement): Promise<{ getPuck: GetPuck; input: HTMLInputElement }> {
  await expectOnCanvas(canvasElement, 'Block-B', 'text', 'Second block');
  const getPuck = await waitFor(() => {
    if (!spike.getPuck) throw new Error('the root field has not handed over the Puck API yet');
    return spike.getPuck;
  });
  getPuck().dispatch(SELECT_BLOCK_A);
  const input = await within(canvasElement).findByRole<HTMLInputElement>('textbox', { name: 'text' });
  input.focus();
  input.setSelectionRange(3, 3);
  await settle();
  return { getPuck, input };
}

/**
 * What the binding does with a remote change: the page data, applied without a history entry. The function form takes
 * the same reducer path as passing the data object, without the console warning Puck prints for the object form.
 */
function applyRemote(getPuck: GetPuck, blockId: string, props: Record<string, string>) {
  getPuck().dispatch({
    type: 'setData',
    data: (previous) => ({
      ...previous,
      content: previous.content.map((block) =>
        block.props.id === blockId ? { ...block, props: { ...block.props, ...props } } : block,
      ),
    }),
    recordHistory: false,
  });
}

const blockAText = (getPuck: GetPuck) => getPuck().getItemById('Block-A')?.props.text;

/** Swallows Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y. */
function blockUndoKeys(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && (event.code === 'KeyZ' || event.code === 'KeyY')) {
    event.preventDefault();
    event.stopPropagation();
  }
}

/** Captures the undo and redo keys on a window before anything below it sees them. */
function interceptUndoKeys(win: Window): () => void {
  win.addEventListener('keydown', blockUndoKeys, { capture: true });
  return () => win.removeEventListener('keydown', blockUndoKeys, { capture: true });
}

/** The canvas iframe's window, with its own realm's globals (its `KeyboardEvent`). */
function canvasWindow(canvasElement: HTMLElement): Window & typeof globalThis {
  const win = canvasFrame(canvasElement).contentWindow;
  if (!isWindowGlobal(win)) throw new Error('canvas frame has no window');
  return win;
}

function isWindowGlobal(win: Window | null): win is Window & typeof globalThis {
  return win !== null && 'KeyboardEvent' in win;
}

type Modifier = 'Control' | 'Meta';

/** Presses `modifier`+`key` (with Shift when asked) on the canvas document, the way Puck's canvas hotkeys see it. */
function pressOnCanvas(canvasElement: HTMLElement, modifier: Modifier, key: 'z' | 'y', shift = false) {
  const win = canvasWindow(canvasElement);
  const held = { ctrlKey: modifier === 'Control', metaKey: modifier === 'Meta', shiftKey: shift };
  const fire = (type: 'keydown' | 'keyup', code: string, name: string) =>
    win.document.body.dispatchEvent(
      new win.KeyboardEvent(type, { code, key: name, ...held, bubbles: true, cancelable: true }),
    );
  fire('keydown', `${modifier}Left`, modifier);
  if (shift) fire('keydown', 'ShiftLeft', 'Shift');
  fire('keydown', `Key${key.toUpperCase()}`, key);
  fire('keyup', `Key${key.toUpperCase()}`, key);
  if (shift) fire('keyup', 'ShiftLeft', 'Shift');
  fire('keyup', `${modifier}Left`, modifier);
}

/** Types into block A's `text` field and waits until Puck has recorded it. Undo restores the selection of the entry it goes to, so this selects block A first. */
async function typeIntoBlockA(canvasElement: HTMLElement, getPuck: GetPuck, typed: string) {
  getPuck().dispatch(SELECT_BLOCK_A);
  await userEvent.type(await within(canvasElement).findByRole('textbox', { name: 'text' }), typed);
  await settle();
  await expect(getPuck().history.hasPast).toBe(true);
}

type Play = NonNullable<StoryObj['play']>;

const remoteChangeToAnotherBlockKeepsFocus: Play = async ({ canvasElement }) => {
  const { getPuck, input } = await focusBlockAText(canvasElement);
  const mounts = spike.textMounts;
  await expect(mounts).toBeGreaterThan(0);

  applyRemote(getPuck, 'Block-B', { text: 'Remote edit' });
  await expectOnCanvas(canvasElement, 'Block-B', 'text', 'Remote edit');
  await settle();

  await expect(document.activeElement).toBe(input);
  await expect(input.selectionStart).toBe(3);
  await expect(spike.textMounts).toBe(mounts);
};

const remoteChangeToTheFocusedBlockKeepsFocus: Play = async ({ canvasElement }) => {
  const { getPuck, input } = await focusBlockAText(canvasElement);
  const mounts = spike.textMounts;

  applyRemote(getPuck, 'Block-A', { note: 'Remote note' });
  await expectOnCanvas(canvasElement, 'Block-A', 'note', 'Remote note');
  // Puck's own field for the changed prop shows the remote value too.
  await waitFor(() => expect(within(canvasElement).getByRole('textbox', { name: 'note' })).toHaveValue('Remote note'));
  await settle();

  await expect(document.activeElement).toBe(input);
  await expect(input.value).toBe('Hello world');
  await expect(input.selectionStart).toBe(3);
  await expect(spike.textMounts).toBe(mounts);
};

const remoteChangeStaysOutOfHistory: Play = async ({ canvasElement }) => {
  const { getPuck } = await focusBlockAText(canvasElement);
  const histories = getPuck().history.histories.length;

  applyRemote(getPuck, 'Block-B', { text: 'Remote edit' });
  await expectOnCanvas(canvasElement, 'Block-B', 'text', 'Remote edit');
  await settle();

  await expect(getPuck().history.histories.length).toBe(histories);
  await expect(getPuck().history.hasPast).toBe(false);
};

const undoKeysCanBeTakenFromPuck: Play = async ({ canvasElement }) => {
  const { getPuck } = await focusBlockAText(canvasElement);

  // Positive control: without the listener, Ctrl+Z and Cmd+Z undo in Puck from the editor window and from the canvas.
  const undoInPuck = async (modifier: Modifier) => {
    await typeIntoBlockA(canvasElement, getPuck, '!');
    await expect(blockAText(getPuck)).toBe('Hello world!');
    await userEvent.keyboard(`{${modifier}>}z{/${modifier}}`);
    await waitFor(() => expect(blockAText(getPuck)).toBe('Hello world'));

    await typeIntoBlockA(canvasElement, getPuck, '?');
    await expect(blockAText(getPuck)).toBe('Hello world?');
    pressOnCanvas(canvasElement, modifier, 'z');
    await waitFor(() => expect(blockAText(getPuck)).toBe('Hello world'));
  };
  await undoInPuck('Control');
  await undoInPuck('Meta');
  await expect(getPuck().history.hasFuture).toBe(true);

  const releases = [interceptUndoKeys(window), interceptUndoKeys(canvasWindow(canvasElement))];
  try {
    // Redo has an entry to go to, and does not.
    const redo = async (modifier: Modifier) => {
      await userEvent.keyboard(`{${modifier}>}{Shift>}z{/Shift}{/${modifier}}`);
      await userEvent.keyboard(`{${modifier}>}y{/${modifier}}`);
      pressOnCanvas(canvasElement, modifier, 'z', true);
      pressOnCanvas(canvasElement, modifier, 'y');
    };
    await redo('Control');
    await redo('Meta');
    await settle();
    await expect(blockAText(getPuck)).toBe('Hello world');

    // Undo has an entry to go to, and does not.
    await typeIntoBlockA(canvasElement, getPuck, '#');
    const undo = async (modifier: Modifier) => {
      await userEvent.keyboard(`{${modifier}>}z{/${modifier}}`);
      pressOnCanvas(canvasElement, modifier, 'z');
    };
    await undo('Control');
    await undo('Meta');
    await settle();
    await expect(blockAText(getPuck)).toBe('Hello world#');
  } finally {
    for (const release of releases) release();
  }
};

const meta = {
  title: 'Editor/PuckLiveUpdate',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
// No args: every story renders its own harness.
type Story = StoryObj;

export const PuckKeepsFocusOnARemoteChangeToAnotherBlock: Story = {
  name: 'Puck: a remote change to another block keeps the focused field mounted, focused, caret in place',
  render: () => <BarePuck />,
  play: remoteChangeToAnotherBlockKeepsFocus,
};

export const PageEditorKeepsFocusOnARemoteChangeToAnotherBlock: Story = {
  name: 'page editor: a remote change to another block keeps the focused field mounted, focused, caret in place',
  render: () => <SpikePageEditor />,
  play: remoteChangeToAnotherBlockKeepsFocus,
};

export const PuckKeepsFocusOnARemoteChangeToTheFocusedBlock: Story = {
  name: 'Puck: a remote change to another prop of the focused block keeps the field focused, caret in place',
  render: () => <BarePuck />,
  play: remoteChangeToTheFocusedBlockKeepsFocus,
};

export const PageEditorKeepsFocusOnARemoteChangeToTheFocusedBlock: Story = {
  name: 'page editor: a remote change to another prop of the focused block keeps the field focused, caret in place',
  render: () => <SpikePageEditor />,
  play: remoteChangeToTheFocusedBlockKeepsFocus,
};

export const PuckKeepsARemoteChangeOutOfHistory: Story = {
  name: 'Puck: a remote change adds no undo history entry',
  render: () => <BarePuck />,
  play: remoteChangeStaysOutOfHistory,
};

export const PageEditorKeepsARemoteChangeOutOfHistory: Story = {
  name: 'page editor: a remote change adds no undo history entry',
  render: () => <SpikePageEditor />,
  play: remoteChangeStaysOutOfHistory,
};

export const PuckReportsARemoteChangeThroughOnChange: Story = {
  name: 'Puck: a remote change reaches onChange once',
  render: () => <BarePuck />,
  play: async ({ canvasElement }) => {
    const { getPuck } = await focusBlockAText(canvasElement);
    const calls = spike.onChangeCalls;

    applyRemote(getPuck, 'Block-B', { text: 'Remote edit' });
    await expectOnCanvas(canvasElement, 'Block-B', 'text', 'Remote edit');
    await settle();

    await expect(spike.onChangeCalls - calls).toBe(1);
  },
};

export const PuckUndoKeysCanBeIntercepted: Story = {
  name: "Puck: a capture-phase key listener on the editor window and the canvas keeps Puck's undo and redo keys from changing data",
  render: () => <BarePuck />,
  play: undoKeysCanBeTakenFromPuck,
};

export const PageEditorUndoKeysCanBeIntercepted: Story = {
  name: "page editor: a capture-phase key listener on the editor window and the canvas keeps Puck's undo and redo keys from changing data",
  render: () => <SpikePageEditor />,
  play: undoKeysCanBeTakenFromPuck,
};
