import { applyContentDiff, serializeDoc } from '@conloca/content-api/ydoc';
import type { LocalizedEntry } from '@conloca/content-api-client';
import { type Config, type CustomField, type Data, Puck, type PuckApi, useGetPuck } from '@puckeditor/core';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { createFakeDocChannel, type FakeDocChannel } from '../../../test/fake-doc-channel.js';
import '../../main.css';
import { flushOpenEditor, registerEditorFlushHandler } from '../../editor-flush.js';
import type { FrameLiveDoc } from '../../live/doc-channel.js';
import { configureUI, getUIConfig } from '../../ui-config.js';
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

const SPIKE_BLOCK = {
  fields: { text: countedTextField, note: { type: 'text' } },
  render: ({ text, note }) => (
    <section>
      <p data-spike="text">{text}</p>
      <p data-spike="note">{note}</p>
    </section>
  ),
} satisfies Config['components'][string];

const SPIKE_CONFIG: Config = {
  // The root field shows while no block is selected, so Puck's API is reachable before the play selects one.
  root: { fields: { title: countedTextField } },
  components: { Block: SPIKE_BLOCK },
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
function SpikePageEditor({ live, config = SPIKE_CONFIG }: { live?: FrameLiveDoc; config?: Config }) {
  useFreshSpike();
  const [router] = useState(() =>
    createMemoryRouter([
      {
        path: '/',
        element: (
          <PageEditor
            // A bound editor shows the replica's page, as the page editor wrapper hands it over.
            entry={
              live
                ? {
                    ...SPIKE_PAGE,
                    localized: { ...SPIKE_PAGE.localized, content: { puckData: serializeDoc(live.doc).puckData } },
                  }
                : SPIKE_PAGE
            }
            config={config}
            availableLocales={['en']}
            onSave={async () => ({ success: true })}
            onBack={() => {}}
            onOpenMetadata={(field) => openedSettings.push(field)}
            live={live}
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

/** The parent behind the bound page editor, for the play functions: a teammate's edits arrive through it. */
interface BoundParent {
  fake?: FakeDocChannel;
  live?: FrameLiveDoc;
}

const bound: BoundParent = {};

/** What the flush registry answers while no editor replaced the story's own handler: a live page registers none. */
const NO_EDITOR_FLUSH = { ok: false, message: 'no editor flush handler' } as const;

/** The page editor bound to the spike page's replica, through the real doc channel over an in-memory parent. */
function BoundPageEditor({ config, data = SPIKE_DATA }: { config?: Config; data?: Data }) {
  const [live, setLive] = useState<FrameLiveDoc>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: the parent is made once per story with the page it starts on.
  useEffect(() => {
    const previous = getUIConfig();
    const fake = createFakeDocChannel({ puckData: data });
    configureUI({ ...previous, docChannel: fake.channel, hosted: true });
    // Registered before the editor mounts: an editor that registers its own save would replace it.
    const stopFlush = registerEditorFlushHandler(async () => NO_EDITOR_FLUSH);
    bound.fake = fake;
    void fake.channel.open({ kind: 'puck', id: 'spike', locale: 'en' }).then((opened) => {
      bound.live = opened;
      setLive(opened);
    });
    return () => {
      stopFlush();
      configureUI(previous);
    };
  }, []);
  return live ? <SpikePageEditor live={live} config={config} /> : null;
}

/** A block whose resolveData waits while `holding`, as one that fetches does, until the play releases it. */
const slowResolve = { holding: false, release: () => {} };

/**
 * The spike block with a slow resolveData that also derives a prop (`shout`), its note editable inline on the canvas,
 * and a list of items.
 */
const SLOW_RESOLVE_CONFIG: Config = {
  ...SPIKE_CONFIG,
  components: {
    Block: {
      ...SPIKE_BLOCK,
      fields: {
        ...SPIKE_BLOCK.fields,
        note: { type: 'text', contentEditable: true },
        items: { type: 'array', arrayFields: { label: { type: 'text' } } },
        pick: {
          type: 'external',
          placeholder: 'Pick one',
          fetchList: async () => [{ title: 'Alpha' }, { title: 'Beta' }],
          getItemSummary: (picked: { title?: string } | null) => picked?.title ?? '',
        },
      },
      resolveData: async (data) => {
        if (slowResolve.holding) {
          const { promise, resolve } = Promise.withResolvers<void>();
          slowResolve.release = resolve;
          await promise;
        }
        return { props: { ...data.props, shout: String(data.props.text ?? '').toUpperCase() } };
      },
    },
    // A block with a slot, holding blocks its own fields never touch.
    Box: { fields: { content: { type: 'slot' } }, render: ({ content: Content }) => <Content /> },
  },
};

/** A Box's resolveData waits while `holding`, as one that fetches does, until the play releases it. */
const slowBox = { holding: false, release: () => {} };

/** The slow spike block inside a Box with its own fields, a tag it shows, and resolveData that waits on `slowBox`. */
const BOX_CONFIG: Config = {
  ...SLOW_RESOLVE_CONFIG,
  components: {
    ...SLOW_RESOLVE_CONFIG.components,
    Box: {
      fields: { heading: { type: 'text' }, tag: { type: 'text' }, content: { type: 'slot' } },
      resolveData: async (data) => {
        if (slowBox.holding) {
          const { promise, resolve } = Promise.withResolvers<void>();
          slowBox.release = resolve;
          await promise;
        }
        return data;
      },
      render: ({ tag, content: Content }) => (
        <div>
          <p data-spike="tag">{tag}</p>
          <Content />
        </div>
      ),
    },
  },
};

/** Block A inside Box-1, which has a heading and a tag. */
const BOX_DATA: Data = {
  root: SPIKE_DATA.root,
  content: [
    {
      type: 'Box',
      props: {
        id: 'Box-1',
        heading: 'H',
        tag: 'T0',
        content: [{ type: 'Block', props: { id: 'Block-A', text: 'Hello world', note: 'A note' } }],
      },
    },
    { type: 'Block', props: { id: 'Block-B', text: 'Second block', note: 'B note' } },
  ],
};

/** The spike block with a default prop the page's file never stores. */
const DEFAULTS_CONFIG: Config = {
  ...SPIKE_CONFIG,
  components: { Block: { ...SPIKE_BLOCK, defaultProps: { text: '', note: '', tone: 'plain' } } },
};

/** What the editor was asked to open, from the header or a page setting a block shows on the canvas. */
const openedSettings: (string | undefined)[] = [];

/** The spike block marking a part of it as a page setting, as a site block that prints the post date does. */
const PAGE_SETTING_CONFIG: Config = {
  ...SPIKE_CONFIG,
  components: {
    Block: {
      ...SPIKE_BLOCK,
      render: ({ text }) => (
        <section>
          <p data-spike="text">{text}</p>
          <span data-conloca-page-setting="publishAt" data-spike="date">
            1 Jan
          </span>
        </section>
      ),
    },
  },
};

/** Block A holds three items without ids, as Puck array fields store them. */
const THREE_ITEMS: Data = {
  root: SPIKE_DATA.root,
  content: [
    {
      type: 'Block',
      props: {
        id: 'Block-A',
        text: 'Hello world',
        note: 'A note',
        items: [{ label: 'one' }, { label: 'two' }, { label: 'three' }],
      },
    },
    { type: 'Block', props: { id: 'Block-B', text: 'Second block', note: 'B note' } },
  ],
};

/** Block A inside a Box's slot. */
const SLOT_DATA: Data = {
  root: SPIKE_DATA.root,
  content: [
    {
      type: 'Box',
      props: {
        id: 'Box-1',
        content: [{ type: 'Block', props: { id: 'Block-A', text: 'Hello world', note: 'A note' } }],
      },
    },
    { type: 'Block', props: { id: 'Block-B', text: 'Second block', note: 'B note' } },
  ],
};

type Block = Data['content'][number];
type BlockProps = Block['props'];

function isBlockList(value: BlockProps[string]): value is Block[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item?.type === 'string' && typeof item?.props?.id === 'string')
  );
}

/** Block `id` at any depth: inside slots too. */
function findBlock(content: Block[], id: string): Block | undefined {
  for (const block of content) {
    if (block.props.id === id) return block;
    for (const value of Object.values(block.props)) {
      const inner = isBlockList(value) ? findBlock(value, id) : undefined;
      if (inner) return inner;
    }
  }
  return undefined;
}

/** `block` with `props` set on block `id`, at any depth. */
function setProps(block: Block, id: string, props: Partial<BlockProps>): Block {
  const own = block.props.id === id ? { ...block.props, ...props } : block.props;
  const nested = Object.fromEntries(
    Object.entries(own).map(([key, value]) => [
      key,
      isBlockList(value) ? value.map((child) => setProps(child, id, props)) : value,
    ]),
  );
  return { ...block, props: { ...own, ...nested } };
}

/** The spike page with a list of items on block A. */
const LIST_DATA: Data = {
  root: SPIKE_DATA.root,
  content: [
    {
      type: 'Block',
      props: { id: 'Block-A', text: 'Hello world', note: 'A note', items: [{ label: 'one' }, { label: 'two' }] },
    },
    { type: 'Block', props: { id: 'Block-B', text: 'Second block', note: 'B note' } },
  ],
};

/** The block as the parent's doc holds it now, at any depth. */
function parentBlock(blockId: string) {
  const { fake, live } = bound;
  if (!fake || !live) throw new Error('the bound editor has not opened its doc');
  const data: Data = serializeDoc(fake.parent(live.docKey)).puckData;
  return findBlock(data.content, blockId)?.props;
}

/** A teammate sets props of one block, at any depth; it reaches the editor through the parent, as a relayed update. */
function teammateSets(blockId: string, props: Partial<BlockProps>) {
  const { fake, live } = bound;
  if (!fake || !live) throw new Error('the bound editor has not opened its doc');
  fake.parentEdit(live.docKey, (doc) => {
    const data: Data = serializeDoc(doc).puckData;
    const content = data.content.map((block) => setProps(block, blockId, props));
    applyContentDiff(doc, { puckData: { ...data, content } }, null);
  });
}

/** Block A's items as the parent's doc holds them now. */
function parentItems(): { label: string }[] {
  const items = parentBlock('Block-A')?.items;
  return Array.isArray(items) ? items : [];
}

/**
 * A teammate relabels an item of block A, in the list as their editor has it: the parent's, the user's change
 * included once it arrived, as a teammate's own binding writes it.
 */
function teammateRelabels(from: string, to: string) {
  teammateSets('Block-A', { items: parentItems().map((item) => (item.label === from ? { label: to } : item)) });
}

/** A teammate inserts an item after the one labelled `after`, in the list as their editor has it. */
function teammateInsertsAfter(after: string, item: { label: string }) {
  const items = parentItems();
  const at = items.findIndex((existing) => existing.label === after) + 1;
  teammateSets('Block-A', { items: [...items.slice(0, at), item, ...items.slice(at)] });
}

/** A teammate adds a block at the end of the page. */
function teammateAdds(block: Block) {
  const { fake, live } = bound;
  if (!fake || !live) throw new Error('the bound editor has not opened its doc');
  fake.parentEdit(live.docKey, (doc) => {
    const data: Data = serializeDoc(doc).puckData;
    applyContentDiff(doc, { puckData: { ...data, content: [...data.content, block] } }, null);
  });
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

/** S1 with the binding: a teammate's change to another block shows, and the focused field keeps focus and caret. */
const boundRemoteEditKeepsFocus: Play = async ({ canvasElement }) => {
  const { input } = await focusBlockAText(canvasElement);
  const mounts = spike.textMounts;

  teammateSets('Block-B', { text: 'Remote edit' });
  await expectOnCanvas(canvasElement, 'Block-B', 'text', 'Remote edit');
  await settle();

  await expect(document.activeElement).toBe(input);
  await expect(input.selectionStart).toBe(3);
  await expect(spike.textMounts).toBe(mounts);
};

/** Undo takes back this user's typing and leaves a teammate's change to the same block. */
const boundUndoSkipsTeammate: Play = async ({ canvasElement }) => {
  const { input } = await focusBlockAText(canvasElement);
  await userEvent.type(input, '!');
  await expectOnCanvas(canvasElement, 'Block-A', 'text', 'Hello world!');
  teammateSets('Block-A', { note: 'Remote note' });
  await expectOnCanvas(canvasElement, 'Block-A', 'note', 'Remote note');
  await userEvent.keyboard('{Control>}z{/Control}');
  await expectOnCanvas(canvasElement, 'Block-A', 'text', 'Hello world');
  await expectOnCanvas(canvasElement, 'Block-A', 'note', 'Remote note');
};

/**
 * A teammate's value for the field being typed in shows in the field, which keeps focus; typing on goes on from the
 * teammate's value, never from the stale one Puck held for the focused field.
 */
const boundSameFieldRemoteWins: Play = async ({ canvasElement }) => {
  const { input } = await focusBlockAText(canvasElement);
  await userEvent.type(input, '!');
  teammateSets('Block-A', { text: 'Remote text' });
  await waitFor(() => expect(input).toHaveValue('Remote text'), { timeout: 10_000 });
  await expectOnCanvas(canvasElement, 'Block-A', 'text', 'Remote text');
  await expect(document.activeElement).toBe(input);
  await userEvent.type(input, '?');
  await expectOnCanvas(canvasElement, 'Block-A', 'text', 'Remote text?');
};

/**
 * Puck snapshots the block at the keystroke and hands `onChange` that snapshot plus the typed value only once the
 * block's resolveData settles. A teammate's change to another prop of the block, re-seeded meanwhile, must survive it.
 */
const slowResolveKeepsTeammate: Play = async ({ canvasElement }) => {
  const { input } = await focusBlockAText(canvasElement);
  slowResolve.holding = true;
  try {
    await userEvent.type(input, '!');
    teammateSets('Block-A', { note: 'Remote note' });
    await expectOnCanvas(canvasElement, 'Block-A', 'note', 'Remote note');
  } finally {
    slowResolve.holding = false;
    slowResolve.release();
  }
  await expectOnCanvas(canvasElement, 'Block-A', 'text', 'Hello world!');
  await settle();
  await expect(parentBlock('Block-A')).toMatchObject({ text: 'Hello world!', note: 'Remote note' });
  await expectOnCanvas(canvasElement, 'Block-A', 'note', 'Remote note');
};

/** A page waiting to be published (the parent refused an edit for size) is read-only, says why, and registers no save of its own. */
const heldPageIsReadOnly: Play = async ({ canvasElement }) => {
  await expectOnCanvas(canvasElement, 'Block-B', 'text', 'Second block');
  // Live, Page settings are off and say why: they save by a write the shared page does not merge yet.
  await expect(
    within(canvasElement).getByRole('button', {
      name: 'Page settings unavailable. Page settings are not available yet while changes save as you type.',
    }),
  ).toHaveAttribute('aria-disabled', 'true');
  bound.fake?.channel.receive('live.status', {
    connection: 'read-only',
    pending: true,
    persisted: true,
    readOnly: { status: 413, code: 'update-too-large-unsaved' },
  });
  await within(canvasElement).findByRole('alert');
  const getPuck = await waitFor(() => {
    if (!spike.getPuck) throw new Error('the root field has not handed over the Puck API yet');
    return spike.getPuck;
  });
  await waitFor(() =>
    expect(getPuck().getPermissions({ type: 'Block' })).toMatchObject({ edit: false, insert: false }),
  );
  await expect(await flushOpenEditor()).toEqual(NO_EDITOR_FLUSH);
};

/** Waits until the parent's doc holds `expected` for block A's props. */
async function expectInParent(expected: Partial<Data['content'][number]['props']>) {
  await waitFor(() => expect(parentBlock('Block-A')).toMatchObject(expected), { timeout: 10_000 });
}

/** A teammate changes the note; the user sets it back in the sidebar on purpose: the user's value is kept. */
const deliberateSetBackKept: Play = async ({ canvasElement }) => {
  await focusBlockAText(canvasElement);
  teammateSets('Block-A', { note: 'Remote note' });
  await expectOnCanvas(canvasElement, 'Block-A', 'note', 'Remote note');
  const note = within(canvasElement).getByRole('textbox', { name: 'note' });
  await userEvent.clear(note);
  await userEvent.type(note, 'A note');
  await settle();
  await expectInParent({ note: 'A note' });
};

/** The same through a custom field: a teammate changes the text; the user types the old text back; it is kept. */
const customFieldSetBackKept: Play = async ({ canvasElement }) => {
  const { input } = await focusBlockAText(canvasElement);
  teammateSets('Block-A', { text: 'Remote text' });
  await waitFor(() => expect(input).toHaveValue('Remote text'), { timeout: 10_000 });
  await userEvent.clear(input);
  await userEvent.type(input, 'Hello world');
  await settle();
  await expectInParent({ text: 'Hello world' });
};

/** The same inline on the canvas: the user edits the note in place back to its old value; it is kept. */
const inlineSetBackKept: Play = async ({ canvasElement }) => {
  await focusBlockAText(canvasElement);
  teammateSets('Block-A', { note: 'Remote note' });
  await expectOnCanvas(canvasElement, 'Block-A', 'note', 'Remote note');
  const inline = await waitFor(() => {
    const found = canvasFrame(canvasElement).contentDocument?.querySelector<HTMLElement>(
      '[data-puck-component="Block-A"] [data-spike="note"] [contenteditable]',
    );
    if (!found) throw new Error('the inline note is not on the canvas');
    return found;
  });
  inline.focus();
  // What typing does to a contentEditable in the canvas's realm (user-event cannot edit across the iframe): the text
  // changes and an `input` event fires, which Puck's inline field reads.
  inline.innerText = 'A note';
  inline.dispatchEvent(new (canvasWindow(canvasElement).Event)('input', { bubbles: true }));
  await settle();
  await expectInParent({ note: 'A note' });
};

/** Undo after an edit takes the edit back in the doc too. */
const undoAfterEditKept: Play = async ({ canvasElement }) => {
  const { input } = await focusBlockAText(canvasElement);
  await userEvent.type(input, '!');
  await expectInParent({ text: 'Hello world!' });
  await settle();
  await userEvent.keyboard('{Control>}z{/Control}');
  await expectInParent({ text: 'Hello world' });
};

/** A reorder of block A's items while a field change waits on resolveData: both are kept when it settles. */
const reorderDuringSlowResolveKept: Play = async ({ canvasElement }) => {
  const { getPuck, input } = await focusBlockAText(canvasElement);
  slowResolve.holding = true;
  try {
    await userEvent.type(input, '!');
    const block = getPuck().getItemById('Block-A');
    if (!block) throw new Error('no block A');
    const items = Array.isArray(block.props.items) ? block.props.items : [];
    getPuck().dispatch({
      type: 'replace',
      destinationIndex: 0,
      destinationZone: 'root:default-zone',
      data: { ...block, props: { ...block.props, items: items.toReversed() } },
    });
    await expectInParent({ items: [{ label: 'two' }, { label: 'one' }] });
  } finally {
    slowResolve.holding = false;
    slowResolve.release();
  }
  await settle();
  await expectInParent({ text: 'Hello world!', items: [{ label: 'two' }, { label: 'one' }] });
};

/** Duplicating a block writes the copy. */
const duplicateKept: Play = async ({ canvasElement }) => {
  const { getPuck } = await focusBlockAText(canvasElement);
  getPuck().dispatch({ type: 'duplicate', sourceIndex: 0, sourceZone: 'root:default-zone' });
  await waitFor(
    async () => {
      const { fake, live } = bound;
      if (!fake || !live) throw new Error('not open');
      await expect(serializeDoc(fake.parent(live.docKey)).puckData.content).toHaveLength(3);
    },
    { timeout: 10_000 },
  );
};

/** A prop resolveData derives from the user's change is written with it, beside a teammate's change. */
const derivedPropKept: Play = async ({ canvasElement }) => {
  const { input } = await focusBlockAText(canvasElement);
  slowResolve.holding = true;
  try {
    await userEvent.type(input, '!');
    teammateSets('Block-A', { note: 'Remote note' });
    await expectOnCanvas(canvasElement, 'Block-A', 'note', 'Remote note');
  } finally {
    slowResolve.holding = false;
    slowResolve.release();
  }
  await settle();
  await expectInParent({ text: 'Hello world!', shout: 'HELLO WORLD!', note: 'Remote note' });
};

/** Holds block A's resolveData while `act` runs, then lets it answer. */
async function whileResolveWaits(act: () => Promise<void>) {
  slowResolve.holding = true;
  try {
    await act();
  } finally {
    slowResolve.holding = false;
    slowResolve.release();
  }
  await settle();
}

/** Waits until the Puck API is handed over, then selects the block at `index` of `zone`. */
async function selectBlock(canvasElement: HTMLElement, zone: string, index = 0): Promise<GetPuck> {
  await expectOnCanvas(canvasElement, 'Block-B', 'text', 'Second block');
  const getPuck = await waitFor(() => {
    if (!spike.getPuck) throw new Error('the root field has not handed over the Puck API yet');
    return spike.getPuck;
  });
  getPuck().dispatch({ type: 'setUi', ui: { itemSelector: { index, zone } } });
  return getPuck;
}

/** The sidebar's array item elements, in order. */
function arrayItems(canvasElement: HTMLElement): HTMLElement[] {
  return [...canvasElement.querySelectorAll<HTMLElement>('[class*="_ArrayFieldItem_"]')];
}

/** Clicks the array item action titled `title` (Duplicate, Delete) on item `index`. */
async function itemAction(canvasElement: HTMLElement, index: number, title: 'Duplicate' | 'Delete') {
  const button = await waitFor(() => {
    const found = arrayItems(canvasElement)[index]?.querySelector<HTMLButtonElement>(`button[title="${title}"]`);
    if (!found) throw new Error(`no ${title} on item ${index}`);
    return found;
  });
  await userEvent.click(button);
}

/** A teammate's change inside a block in a slot survives a field change that waited on resolveData. */
const slotBlockKeepsTeammate: Play = async ({ canvasElement }) => {
  await selectBlock(canvasElement, 'Box-1:content');
  const input = await within(canvasElement).findByRole<HTMLInputElement>('textbox', { name: 'text' });
  await whileResolveWaits(async () => {
    await userEvent.type(input, '!');
    teammateSets('Block-A', { note: 'Remote note' });
    await expectOnCanvas(canvasElement, 'Block-A', 'note', 'Remote note');
  });
  await expectInParent({ text: 'Hello world!', note: 'Remote note' });
};

/** A block a teammate adds is shown to Puck with the default props the load gives every block. */
const teammateBlockGetsDefaults: Play = async ({ canvasElement }) => {
  const getPuck = await selectBlock(canvasElement, 'root:default-zone');
  teammateAdds({ type: 'Block', props: { id: 'Block-C', text: 'Third', note: 'C note' } });
  await expectOnCanvas(canvasElement, 'Block-C', 'text', 'Third');
  await waitFor(() => expect(getPuck().getItemById('Block-C')?.props).toMatchObject({ tone: 'plain' }));
};

/** Live, a page setting a block shows on the canvas opens nothing. */
const canvasPageSettingOpensNothing: Play = async ({ canvasElement }) => {
  await expectOnCanvas(canvasElement, 'Block-B', 'text', 'Second block');
  openedSettings.length = 0;
  const win = canvasWindow(canvasElement);
  const date = await waitFor(() => {
    const found = win.document.querySelector('[data-puck-component="Block-A"] [data-spike="date"]');
    if (!found) throw new Error('no date on the canvas');
    return found;
  });
  date.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  await settle();
  await expect(openedSettings).toEqual([]);
};

/** The user removes item 0 while a teammate edits item 2: the teammate's edit stays on that item. */
const removeKeepsTeammateItemEdit: Play = async ({ canvasElement }) => {
  await selectBlock(canvasElement, 'root:default-zone');
  await whileResolveWaits(async () => {
    await itemAction(canvasElement, 0, 'Delete');
    teammateRelabels('three', 'THREE');
  });
  await expectInParent({ items: [{ label: 'two' }, { label: 'THREE' }] });
};

/** The user inserts an item (Duplicate) before the one a teammate edits: the edit stays on that item. */
const insertKeepsTeammateItemEdit: Play = async ({ canvasElement }) => {
  await selectBlock(canvasElement, 'root:default-zone');
  await whileResolveWaits(async () => {
    await itemAction(canvasElement, 0, 'Duplicate');
    teammateRelabels('three', 'THREE');
  });
  await expectInParent({ items: [{ label: 'one' }, { label: 'one' }, { label: 'two' }, { label: 'THREE' }] });
};

/** The user adds an item at the end while a teammate edits one: both are kept. */
const addKeepsTeammateItemEdit: Play = async ({ canvasElement }) => {
  await selectBlock(canvasElement, 'root:default-zone');
  const add = await waitFor(() => {
    const found = canvasElement.querySelector<HTMLButtonElement>('[class*="_ArrayField-addButton_"]');
    if (!found) throw new Error('no add button');
    return found;
  });
  await whileResolveWaits(async () => {
    await userEvent.click(add);
    teammateRelabels('one', 'ONE');
  });
  const items = parentBlock('Block-A')?.items;
  await expect(items).toHaveLength(4);
  await expect(items?.slice(0, 3)).toEqual([{ label: 'ONE' }, { label: 'two' }, { label: 'three' }]);
};

/** A teammate inserts an item before the one the user removes: the insert is kept, the removal too. */
const teammateInsertUserRemove: Play = async ({ canvasElement }) => {
  await selectBlock(canvasElement, 'root:default-zone');
  await whileResolveWaits(async () => {
    await itemAction(canvasElement, 1, 'Delete');
    teammateInsertsAfter('one', { label: 'new' });
  });
  await expectInParent({ items: [{ label: 'one' }, { label: 'new' }, { label: 'three' }] });
};

/** A teammate edits an item while the user types in another field: the item edit is kept. */
const teammateItemEditDuringSlowLoad: Play = async ({ canvasElement }) => {
  const { input } = await focusBlockAText(canvasElement);
  await whileResolveWaits(async () => {
    await userEvent.type(input, '!');
    teammateSets('Block-A', { items: [{ label: 'one' }, { label: 'TWO' }, { label: 'three' }] });
  });
  await expectInParent({ text: 'Hello world!', items: [{ label: 'one' }, { label: 'TWO' }, { label: 'three' }] });
};

/** The user picks from an external list while a teammate changes the note: both are kept. */
const externalPickKeepsTeammate: Play = async ({ canvasElement }) => {
  await selectBlock(canvasElement, 'root:default-zone');
  const [placeholder] = await within(canvasElement).findAllByText('Pick one', {}, { timeout: 10_000 });
  const open = placeholder?.closest('button');
  if (!open) throw new Error('the picker has no button');
  await whileResolveWaits(async () => {
    await userEvent.click(open);
    const [beta] = await within(document.body).findAllByText('Beta');
    if (!beta) throw new Error('the picker shows no Beta');
    await userEvent.click(beta);
    teammateSets('Block-A', { note: 'Remote note' });
    await expectOnCanvas(canvasElement, 'Block-A', 'note', 'Remote note');
  });
  await expectInParent({ pick: { title: 'Beta' }, note: 'Remote note' });
};

/** The user pastes into a field while a teammate changes the note: both are kept. */
const pasteKeepsTeammate: Play = async ({ canvasElement }) => {
  const { input } = await focusBlockAText(canvasElement);
  await whileResolveWaits(async () => {
    await userEvent.paste('!!');
    teammateSets('Block-A', { note: 'Remote note' });
    await expectOnCanvas(canvasElement, 'Block-A', 'note', 'Remote note');
  });
  await expect(input).toHaveValue('Hel!!lo world');
  await expectInParent({ text: 'Hel!!lo world', note: 'Remote note' });
};

/**
 * The user types in a Box whose slot child Puck resolves again (a teammate changed it): Puck hands the Box over only
 * once the child's slow resolveData answers. A teammate's changes to the Box meanwhile survive.
 */
const boxKeepsTeammateWhileChildResolves: Play = async ({ canvasElement }) => {
  await expectOnCanvas(canvasElement, 'Block-B', 'text', 'Second block');
  teammateSets('Block-A', { note: 'Remote note' });
  await expectOnCanvas(canvasElement, 'Block-A', 'note', 'Remote note');
  await selectBlock(canvasElement, 'root:default-zone');
  const heading = await within(canvasElement).findByRole('textbox', { name: 'heading' });
  await whileResolveWaits(async () => {
    await userEvent.type(heading, '!');
    teammateSets('Box-1', { tag: 'T1' });
    await expectOnCanvas(canvasElement, 'Box-1', 'tag', 'T1');
    teammateSets('Box-1', { tag: 'T2' });
    await expectOnCanvas(canvasElement, 'Box-1', 'tag', 'T2');
  });
  await waitFor(() => expect(parentBlock('Box-1')).toMatchObject({ heading: 'H!', tag: 'T2' }), { timeout: 10_000 });
};

/**
 * Puck resolves a slot child again during its parent's update, with the child as the parent held it at the keystroke:
 * not the user's change, so a teammate's later change to the child survives it.
 */
const childResolveIsNotAKeystroke: Play = async ({ canvasElement }) => {
  await expectOnCanvas(canvasElement, 'Block-B', 'text', 'Second block');
  teammateSets('Block-A', { note: 'N1' });
  await expectOnCanvas(canvasElement, 'Block-A', 'note', 'N1');
  await selectBlock(canvasElement, 'root:default-zone');
  const heading = await within(canvasElement).findByRole('textbox', { name: 'heading' });
  slowBox.holding = true;
  try {
    await userEvent.type(heading, '!');
    teammateSets('Block-A', { note: 'N2' });
    // Box-1 shows its slot without the blocks' edit wrappers once Puck marks it loading (50 ms into the held resolve).
    await expectOnCanvas(canvasElement, 'Box-1', 'note', 'N2');
  } finally {
    slowBox.holding = false;
    slowBox.release();
  }
  await settle();
  await expect(parentBlock('Block-A')).toMatchObject({ note: 'N2' });
  await expect(parentBlock('Box-1')).toMatchObject({ heading: 'H!' });
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

export const RemoteEditKeepsFocus: Story = {
  name: "bound page editor: a teammate's change to another block keeps the focused field focused, caret in place",
  render: () => <BoundPageEditor />,
  play: boundRemoteEditKeepsFocus,
};

export const UndoSkipsTeammate: Story = {
  name: "bound page editor: Ctrl+Z takes back the user's typing and keeps a teammate's change to the same block",
  render: () => <BoundPageEditor />,
  play: boundUndoSkipsTeammate,
};

export const SameFieldRemoteWins: Story = {
  name: "bound page editor: a teammate's value for the field being typed in shows, and the field keeps focus",
  render: () => <BoundPageEditor />,
  play: boundSameFieldRemoteWins,
};

export const SlowResolveKeepsTeammate: Story = {
  name: "bound page editor: a change Puck hands over once a slow resolveData settles keeps a teammate's change to the block",
  render: () => <BoundPageEditor config={SLOW_RESOLVE_CONFIG} />,
  play: slowResolveKeepsTeammate,
};

export const HeldPageIsReadOnly: Story = {
  name: 'bound page editor: a page waiting to be published is read-only, says why, and registers no save of its own',
  render: () => <BoundPageEditor />,
  play: heldPageIsReadOnly,
};

const keptStory = (name: string, play: Play, data?: Data): Story => ({
  name: `bound page editor, slow resolveData: ${name}`,
  render: () => <BoundPageEditor config={SLOW_RESOLVE_CONFIG} data={data} />,
  play,
});

export const DeliberateSetBackKept = keptStory(
  "a deliberate set-back of a teammate's value is kept",
  deliberateSetBackKept,
);
export const CustomFieldSetBackKept = keptStory('a set-back through a custom field is kept', customFieldSetBackKept);
export const InlineSetBackKept = keptStory('a set-back inline on the canvas is kept', inlineSetBackKept);
export const UndoAfterEditKept = keptStory('undo after an edit is kept', undoAfterEditKept);
export const ReorderDuringSlowResolveKept = keptStory(
  'an item reorder made while a field change waits is kept',
  reorderDuringSlowResolveKept,
  LIST_DATA,
);
export const DuplicateKept = keptStory('a duplicated block is kept', duplicateKept);
export const DerivedPropKept = keptStory('a prop resolveData derives is kept', derivedPropKept);

const boundStory = (name: string, play: Play, config: Config, data?: Data): Story => ({
  name: `bound page editor: ${name}`,
  render: () => <BoundPageEditor config={config} data={data} />,
  play,
});

export const SlotBlockKeepsTeammate = boundStory(
  "a field change in a slot block that waited on resolveData keeps a teammate's change",
  slotBlockKeepsTeammate,
  SLOW_RESOLVE_CONFIG,
  SLOT_DATA,
);
export const TeammateBlockGetsDefaults = boundStory(
  'a block a teammate adds gets the default props',
  teammateBlockGetsDefaults,
  DEFAULTS_CONFIG,
);
export const CanvasPageSettingOpensNothing = boundStory(
  'a page setting on the canvas opens nothing while live',
  canvasPageSettingOpensNothing,
  PAGE_SETTING_CONFIG,
);
export const RemoveKeepsTeammateItemEdit = boundStory(
  "removing an item keeps a teammate's edit on a later item",
  removeKeepsTeammateItemEdit,
  SLOW_RESOLVE_CONFIG,
  THREE_ITEMS,
);
export const InsertKeepsTeammateItemEdit = boundStory(
  "duplicating an item keeps a teammate's edit on a later item",
  insertKeepsTeammateItemEdit,
  SLOW_RESOLVE_CONFIG,
  THREE_ITEMS,
);
export const AddKeepsTeammateItemEdit = boundStory(
  "adding an item keeps a teammate's edit on another",
  addKeepsTeammateItemEdit,
  SLOW_RESOLVE_CONFIG,
  THREE_ITEMS,
);
export const TeammateInsertUserRemove = boundStory(
  "a teammate's insert and the user's removal are both kept",
  teammateInsertUserRemove,
  SLOW_RESOLVE_CONFIG,
  THREE_ITEMS,
);
export const TeammateItemEditDuringSlowLoad = boundStory(
  "a teammate's item edit during a slow field change is kept",
  teammateItemEditDuringSlowLoad,
  SLOW_RESOLVE_CONFIG,
  THREE_ITEMS,
);
export const ExternalPickKeepsTeammate = boundStory(
  "an external pick keeps a teammate's change",
  externalPickKeepsTeammate,
  SLOW_RESOLVE_CONFIG,
);
export const PasteKeepsTeammate = boundStory(
  "a paste keeps a teammate's change",
  pasteKeepsTeammate,
  SLOW_RESOLVE_CONFIG,
);
export const BoxKeepsTeammateWhileChildResolves = boundStory(
  "a field change waiting on a slot child's resolve keeps a teammate's changes to the block",
  boxKeepsTeammateWhileChildResolves,
  BOX_CONFIG,
  BOX_DATA,
);
export const ChildResolveIsNotAKeystroke = boundStory(
  "a slot child's resolve in its parent's update keeps a teammate's change to the child",
  childResolveIsNotAKeystroke,
  BOX_CONFIG,
  BOX_DATA,
);
