/// <reference lib="dom" />
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  addNestedEditorChild$,
  addTableCellEditorChild$,
  BoldItalicUnderlineToggles,
  diffSourcePlugin,
  jsxPlugin,
  MDXEditor,
  markdown$,
  markdownSourceEditorValue$,
  type Realm,
  type RealmPlugin,
  readOnly$,
  realmPlugin,
  tablePlugin,
  toolbarPlugin,
  viewMode$,
} from '@mdxeditor/editor';
import { act, cleanup, fireEvent, type RenderResult, render, waitFor } from '@testing-library/react';
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  getNearestEditorFromDOMNode,
  type LexicalEditor,
  REDO_COMMAND,
  UNDO_COMMAND,
} from 'lexical';
import { StrictMode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as Y from 'yjs';
import { GenericBlock } from '../components/editor/GenericBlock.js';
import { JsxPropsPanel } from '../components/editor/JsxPropsPanel.js';
import { jsxLayoutPlugin } from '../components/editor/jsx-layout-plugin.js';
import { softBreakPlugin } from '../components/editor/soft-break-plugin.js';
import { type MdxComponentProp, setMdxComponents } from '../mdx-components.js';
import { isLiveEditing, setSelectedBlock } from '../selected-block.js';
import { LOCAL_ORIGIN } from './doc-channel.js';
import { hasHeldWork, markdownLivePlugin } from './markdown-live-plugin.js';

const REMOTE = Symbol('remote');
const BODY = '<Callout>\n\nHello\n\n</Callout>\n\nOther\n';

// Each scenario runs on a page and again as the fragment editor runs it: with a save check (here passing) and #730's
// soft-break plugin, so a fragment keeps every guarantee a page has.
const scenarios: [string, () => Promise<void>][] = [];
// Collects; the describes at the end register each scenario per mode.
const test = (name: string, run: () => Promise<void>) => void scenarios.push([name, run]);
let fragmentCheck: ((markdown: string) => string | null) | undefined;
const livePlugin = (input: Parameters<typeof markdownLivePlugin>[0]) =>
  markdownLivePlugin(fragmentCheck ? { check: fragmentCheck, ...input } : input);

// A component the side panel can edit; with no import it renders its body in the editor's fallback block.
const CALLOUT_PROPS: MdxComponentProp[] = [
  { name: 'title', type: 'string' },
  { name: 'count', type: 'number' },
  { name: 'meta', type: 'object', fields: { note: { type: 'string', label: 'Note' } } },
];
beforeEach(() => setMdxComponents([{ name: 'Callout', kind: 'flow', hasChildren: true, props: CALLOUT_PROPS }]));
afterEach(() => {
  // Unmounted first, so clearing the shared selection re-renders nothing.
  cleanup();
  setSelectedBlock(null);
  setMdxComponents([]);
});

/**
 * The page editor's shape: an editor with a toolbar and the editor's own component layout, whose component blocks
 * publish to the side panel next to it.
 */
function LiveEditor({
  text,
  plugin,
  markdown,
  extra,
}: {
  text: Y.Text;
  plugin?: RealmPlugin;
  markdown?: string;
  extra?: RealmPlugin;
}) {
  const [plugins] = useState<RealmPlugin[]>(() => [
    jsxPlugin({
      jsxComponentDescriptors: [
        {
          name: 'Callout',
          kind: 'flow',
          props: [
            { name: 'title', type: 'string' },
            { name: 'count', type: 'number' },
            { name: 'meta', type: 'expression' },
          ],
          hasChildren: true,
          Editor: GenericBlock,
        },
      ],
    }),
    jsxLayoutPlugin(),
    tablePlugin(),
    toolbarPlugin({ toolbarContents: () => <BoldItalicUnderlineToggles /> }),
    ...(fragmentCheck ? [softBreakPlugin()] : []),
    plugin ?? livePlugin({ text, undoScope: [text], onSelectionBlock: () => {} }),
    ...(extra ? [extra] : []),
  ]);
  return (
    <>
      <MDXEditor markdown={markdown ?? text.toJSON()} plugins={plugins} />
      <JsxPropsPanel />
    </>
  );
}

/** A body in a shared doc, bound to an editor, and a teammate who edits their own replica of the doc. */
interface Live extends RenderResult {
  text: Y.Text;
  /** Transactions this user's editor wrote to the doc so far. */
  writes(): number;
  /**
   * The teammate's edit to their replica, sent to this doc. `concurrent`: made before the teammate received what this
   * user wrote; otherwise the replica takes this user's writes first, as the doc channel would have sent them.
   */
  teammate(edit: (shared: Y.Text) => void, options?: { concurrent?: boolean }): void;
}

/** `extra`: a plugin published after the live one, so its nested-editor children come after the live plugin's. */
function openLive(body: string, extra?: RealmPlugin): Live {
  const doc = new Y.Doc();
  const text = doc.getText('body');
  text.insert(0, body);
  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  let writes = 0;
  doc.on('afterTransaction', (transaction: Y.Transaction) => {
    if (transaction.origin === LOCAL_ORIGIN) writes++;
  });
  const view = render(<LiveEditor text={text} extra={extra} />);
  const teammate = (edit: (shared: Y.Text) => void, { concurrent = false } = {}) => {
    if (!concurrent) Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc, Y.encodeStateVector(remote)));
    const before = Y.encodeStateVector(remote);
    edit(remote.getText('body'));
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote, before), REMOTE);
  };
  return { ...view, text, teammate, writes: () => writes };
}

function nextFrame(): Promise<number> {
  const frame = Promise.withResolvers<number>();
  requestAnimationFrame(frame.resolve);
  return frame.promise;
}

async function frames(count = 3) {
  await act(async () => {
    // oxlint-disable-next-line no-await-in-loop -- in order: each frame lets the work the previous one scheduled run.
    for (let i = 0; i < count; i++) await nextFrame();
  });
}

function findBody(container: HTMLElement, content: string): HTMLElement | undefined {
  return [...container.querySelectorAll<HTMLElement>('.conloca-generic-block [contenteditable="true"]')].find(
    (el) => el.textContent === content,
  );
}

async function bodyWith(
  container: HTMLElement,
  content: string,
): Promise<{ body: HTMLElement; nested: LexicalEditor }> {
  const body = await waitFor(() => {
    const found = findBody(container, content);
    if (!found) throw new Error(`no component body showing ${JSON.stringify(content)}`);
    return found;
  });
  const nested = getNearestEditorFromDOMNode(body);
  if (!nested) throw new Error('no nested editor');
  return { body, nested };
}

function caretOffset(editor: LexicalEditor): number | null {
  return editor.getEditorState().read(() => {
    const selection = $getSelection();
    return $isRangeSelection(selection) ? selection.anchor.offset : null;
  });
}

/** Selects the body's `Hello` the way a user's drag does: the page selection changes, and the body reads it. */
function selectHello(body: HTMLElement) {
  const hello = body.querySelector('span')?.firstChild;
  if (!hello) throw new Error('no text in the body');
  act(() => {
    document.getSelection()?.setBaseAndExtent(hello, 0, hello, 'Hello'.length);
  });
}

/** Clicks into the Callout's body, which selects the block for the side panel, and types `!` at its end. */
async function typeInBody(live: Live) {
  const { body, nested } = await bodyWith(live.container, 'Hello');
  act(() => {
    fireEvent.mouseDown(body);
    body.focus();
    nested.update(() => $getRoot().selectEnd().insertText('!'), { discrete: true });
  });
  return { body, nested };
}

test('text typed in a component body is in the shared text before the body is left', async () => {
  const live = openLive(BODY);
  await typeInBody(live);
  expect(live.text.toJSON()).toContain('Hello!');
});

test('a teammate edit to another block shows at once; the body being typed in keeps its element, focus and caret', async () => {
  const live = openLive(BODY);
  const { body, nested } = await typeInBody(live);
  live.teammate((shared) => shared.insert(0, 'Intro\n\n'));
  await frames();
  expect(live.container.textContent).toContain('Intro');
  expect(body.isConnected).toBe(true);
  expect(document.activeElement).toBe(body);
  expect(body.textContent).toBe('Hello!');
  expect(caretOffset(nested)).toBe('Hello!'.length);
  expect(live.text.toJSON()).toBe('Intro\n\n<Callout>\n\nHello!\n\n</Callout>\n\nOther\n');
});

test('a teammate edit inside the body being typed in shows both edits and puts the caret back in the body', async () => {
  const live = openLive(BODY);
  await typeInBody(live);
  live.teammate((shared) => shared.insert(shared.toJSON().indexOf('Hello'), 'Hey '));
  await frames();
  const { body, nested } = await bodyWith(live.container, 'Hey Hello!');
  await waitFor(() => expect(document.activeElement).toBe(body));
  // The text after the caret did not change, so the caret stays after the user's `!`.
  expect(caretOffset(nested)).toBe('Hey Hello!'.length);
  expect(live.text.toJSON()).toContain('Hey Hello!');
});

test('a teammate edit inside the body being typed in that never saw the typing keeps both', async () => {
  const live = openLive(BODY);
  await typeInBody(live);
  live.teammate((shared) => shared.insert(shared.toJSON().indexOf('Hello'), 'Hey '), { concurrent: true });
  await frames();
  await bodyWith(live.container, 'Hey Hello!');
  expect(live.text.toJSON()).toBe('<Callout>\n\nHey Hello!\n\n</Callout>\n\nOther\n');
});

/**
 * Types `typed` at the end of the nested editor showing `shows` (a body by default; a table cell with
 * `addTableCellEditorChild$`) from a layout effect, where its DOM is live but no passive effect has run yet (mdxeditor
 * registers the handler that writes it in one); `then` runs right after, and can ask whether this child's passive
 * effects ran since.
 */
function typeOnMount(
  then: (body: LexicalEditor, effectsRan: () => boolean) => void = () => {},
  { slot = addNestedEditorChild$, shows = 'Hello', typed: key = '!' } = {},
): RealmPlugin {
  let typed = false;
  function TypeOnMount() {
    const [body] = useLexicalComposerContext();
    const effectsRan = useRef(false);
    useLayoutEffect(() => {
      if (typed || body.getEditorState().read(() => $getRoot().getTextContent()) !== shows) return;
      typed = true;
      body.update(() => $getRoot().selectEnd().insertText(key), { discrete: true });
      then(body, () => effectsRan.current);
    }, [body]);
    useEffect(() => {
      effectsRan.current = true;
    }, []);
    return null;
  }
  return realmPlugin({ init: (realm) => realm.pub(slot, TypeOnMount) })();
}

const TABLE = '| Name  | Note |\n| ----- | ---- |\n| a     | b    |\n';
/** Every table cell is an editor that mounts with its table; this types into the one showing `shows` as it does. */
const typeInCellOnMount = (shows: string, then?: (cell: LexicalEditor, effectsRan: () => boolean) => void) =>
  typeOnMount(then, { slot: addTableCellEditorChild$, shows, typed: 'lpha' });

test('a key typed into a table cell the moment it mounts, before its effects run, survives a teammate edit to that table', async () => {
  const live = openLive(
    TABLE,
    typeInCellOnMount('a', (cell) => cell.getRootElement()?.focus()),
  );
  await waitFor(() => expect(live.container.textContent).toContain('alpha'));
  live.teammate((shared) => shared.insert(shared.toJSON().lastIndexOf('b    |'), 'B'));
  await frames();
  await waitFor(() => expect(live.container.textContent).toContain('Bb'));
  expect(live.container.textContent).toContain('alpha');
  expect(live.text.toJSON()).toContain('alpha');
});

test('a table cell runs its effects in the task that mounts it, so a key typed then is written when the page closes at once', async () => {
  const text = new Y.Doc().getText('body');
  text.insert(0, TABLE);
  const stepped = Promise.withResolvers<boolean>();
  const closed = Promise.withResolvers<string>();
  const cell = typeInCellOnMount('a', (_cell, effectsRan) =>
    betweenCommitAndEffects(() => {
      stepped.resolve(effectsRan());
      window.dispatchEvent(new Event('pagehide'));
      closed.resolve(text.toJSON());
    }),
  );
  // Opened outside `act`, as on the page, where a body's passive effects run in a task of their own.
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  try {
    root.render(<LiveEditor text={text} extra={cell} />);
    // Should a cell ever mount in a commit whose effects wait, page close needs the flushSync bodies get.
    expect(await stepped.promise).toBe(true);
    expect(await closed.promise).toContain('| alpha');
  } finally {
    root.unmount();
  }
});

test('a key typed into a body the moment it mounts, before its effects run, is written and survives a teammate edit to that body', async () => {
  const live = openLive(BODY, typeOnMount());
  await bodyWith(live.container, 'Hello!');
  await frames();
  expect(live.text.toJSON()).toBe('<Callout>\n\nHello!\n\n</Callout>\n\nOther\n');
  // The teammate's edit rebuilds the body from the doc.
  live.teammate((shared) => shared.insert(shared.toJSON().indexOf('Hello'), 'Hey '));
  await frames();
  await bodyWith(live.container, 'Hey Hello!');
  expect(live.text.toJSON()).toContain('Hey Hello!');
});

test('a key typed into a body nested in another body the moment it mounts is written, not swallowed by the outer body', async () => {
  const live = openLive(
    '<Callout>\n\nOuter\n\n<Callout>\n\nHello\n\n</Callout>\n\n</Callout>\n\nOther\n',
    typeOnMount(),
  );
  await bodyWith(live.container, 'Hello!');
  await frames();
  expect(live.text.toJSON()).toContain('<Callout>\n\nHello!\n\n</Callout>');
  live.teammate((shared) => shared.insert(shared.toJSON().indexOf('Hello'), 'Hey '));
  await frames();
  await bodyWith(live.container, 'Hey Hello!');
  expect(live.text.toJSON()).toContain('Hey Hello!');
});

test('a key typed into a body the moment it mounts is written when the editor closes before the body is', async () => {
  let live: Live | undefined;
  // Ahead of the write the body's passive effects queue: only the editor's teardown can write it.
  live = openLive(
    BODY,
    typeOnMount(() => queueMicrotask(() => live?.unmount())),
  );
  await waitFor(() => expect(live?.container.querySelector('.conloca-generic-block')).toBeNull());
  expect(live.text.toJSON()).toBe('<Callout>\n\nHello!\n\n</Callout>\n\nOther\n');
});

/**
 * Runs `step` after the commit that mounts a body but before React runs that commit's passive effects: the commit
 * uses up the scheduler's time slice, so the scheduler yields to the event loop before it flushes them.
 */
function betweenCommitAndEffects(step: () => void) {
  const sliceUsedUp = performance.now() + 10;
  // oxlint-disable-next-line no-empty -- a busy wait: the time spent is the point.
  while (performance.now() < sliceUsedUp) {}
  queueMicrotask(step);
}

/**
 * Opens a Callout the site renders, whose body mounts once the render arrives, outside `act` as on the page; `then`
 * runs between that body's commit and its passive effects, right after the `!` is typed. A `title` of its own, as a
 * render cached by an earlier test mounts the body at once.
 */
async function typeAsTheSiteRenderMounts(
  title: string,
  then: (live: Live, body: LexicalEditor) => void,
): Promise<Live> {
  let live: Live | undefined;
  const stepped = Promise.withResolvers<boolean>();
  live = openLive(
    // Each mode runs the scenario, so the title differs per mode too.
    TITLED.replace('Note', fragmentCheck ? `${title} in a fragment` : title),
    typeOnMount((body, effectsRan) =>
      betweenCommitAndEffects(() => {
        stepped.resolve(!effectsRan());
        if (live) then(live, body);
      }),
    ),
  );
  // Ran before the body's passive effects, or the test proves nothing.
  expect(await stepped.promise).toBe(true);
  return live;
}

test('a key typed into a body the moment it mounts is written when the page is closed before its effects run', async () => {
  const site = renderedBySite();
  try {
    const closed = Promise.withResolvers<string>();
    await typeAsTheSiteRenderMounts('Closing', (opened) => {
      window.dispatchEvent(new Event('pagehide'));
      closed.resolve(opened.text.toJSON());
    });
    expect(await closed.promise).toContain('Hello!');
  } finally {
    site.mockRestore();
  }
});

test('a teammate edit to a focused body that shows the moment it mounts keeps the typing in it', async () => {
  const site = renderedBySite();
  try {
    const live = await typeAsTheSiteRenderMounts('Rebuilt', (opened, body) => {
      body.getRootElement()?.focus();
      // The teammate's change shows in a frame that comes before the body's passive effects.
      const queued: FrameRequestCallback[] = [];
      const raf = spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => queued.push(callback));
      opened.teammate((shared) => shared.insert(shared.toJSON().indexOf('Hello'), 'Hey '));
      raf.mockRestore();
      for (const callback of queued) callback(0);
    });
    await bodyWith(live.container, 'Hey Hello!');
    expect(live.text.toJSON()).toContain('Hey Hello!');
  } finally {
    site.mockRestore();
  }
});

test('opening the editor writes nothing to the page', async () => {
  const live = openLive(BODY);
  await bodyWith(live.container, 'Hello');
  await frames();
  expect(live.writes()).toBe(0);
});

test("showing a teammate's edit to a body writes nothing back, so undo has nothing of the teammate's to revert", async () => {
  const live = openLive(BODY);
  const { body } = await bodyWith(live.container, 'Hello');
  act(() => {
    fireEvent.mouseDown(body);
    body.focus();
  });
  live.teammate((shared) => shared.insert(shared.toJSON().indexOf('Hello'), 'Hey '));
  await frames();
  await bodyWith(live.container, 'Hey Hello');
  await frames();
  expect(live.writes()).toBe(0);
});

test("a teammate edit after the caret in the body being typed in leaves the caret after the user's text", async () => {
  const live = openLive(BODY);
  await typeInBody(live);
  live.teammate((shared) => shared.insert(shared.toJSON().indexOf('Hello!') + 'Hello!'.length, ' there'));
  await frames();
  const { body, nested } = await bodyWith(live.container, 'Hello! there');
  await waitFor(() => expect(document.activeElement).toBe(body));
  expect(caretOffset(nested)).toBe('Hello!'.length);
});

test('undo in a component body reverts the typing and shows it at once', async () => {
  const live = openLive(BODY);
  const { nested } = await typeInBody(live);
  act(() => {
    nested.dispatchCommand(UNDO_COMMAND, undefined);
  });
  await frames();
  expect(live.text.toJSON()).toBe(BODY);
  const { body } = await bodyWith(live.container, 'Hello');
  await waitFor(() => expect(document.activeElement).toBe(body));
});

test('a toolbar action on a body still applies when a teammate edit lands between leaving the body and the click', async () => {
  const live = openLive(BODY);
  const { body } = await typeInBody(live);
  selectHello(body);
  const bold = live.getByLabelText('Bold');
  act(() => bold.focus());
  live.teammate((shared) => shared.insert(0, 'Intro\n\n'));
  await frames();
  act(() => {
    fireEvent.click(bold);
  });
  await waitFor(() => expect(live.text.toJSON()).toContain('**Hello**!'));
  expect(live.text.toJSON()).toStartWith('Intro\n\n');
});

test('a toolbar action on a body the teammate also changed applies, and the teammate edit shows after it', async () => {
  const live = openLive(BODY);
  const { body } = await typeInBody(live);
  selectHello(body);
  const bold = live.getByLabelText('Bold');
  act(() => bold.focus());
  live.teammate((shared) => shared.insert(shared.toJSON().indexOf('Hello!') + 'Hello!'.length, ' there'));
  await frames();
  act(() => {
    fireEvent.click(bold);
  });
  await waitFor(() => expect(live.text.toJSON()).toContain('**Hello**! there'));
  await waitFor(() => expect(live.container.textContent).toContain('Hello! there'));
});

test('a toolbar button pressed while focus stays in the body applies when a teammate edits that body before the release', async () => {
  const live = openLive(BODY);
  const { body } = await typeInBody(live);
  selectHello(body);
  const bold = live.getByLabelText('Bold');
  // The toolbar keeps focus in the body on press, as a browser does for a button that prevents its mousedown.
  fireEvent.pointerDown(bold);
  live.teammate((shared) => shared.insert(shared.toJSON().indexOf('Hello!') + 'Hello!'.length, ' there'));
  await frames();
  expect(document.activeElement).toBe(body);
  act(() => {
    fireEvent.pointerUp(bold);
    fireEvent.click(bold);
  });
  await waitFor(() => expect(live.text.toJSON()).toContain('**Hello**! there'));
  await waitFor(() => expect(live.container.textContent).toContain('Hello! there'));
});

/** Selects the Callout, then types `value` into the side panel's title field without leaving it. */
async function typeInPanel(live: Live, value: string) {
  await typeInBody(live);
  const title = await waitFor(() => live.getByLabelText('title'));
  act(() => {
    title.focus();
    fireEvent.change(title, { target: { value } });
  });
  return title;
}

test('a prop typed in the side panel is kept when a teammate edit to another block lands before the field is left', async () => {
  const live = openLive(BODY);
  const title = await typeInPanel(live, 'Tip');
  live.teammate((shared) => shared.insert(0, 'Intro\n\n'));
  await frames();
  act(() => title.blur());
  await waitFor(() => expect(live.text.toJSON()).toContain('<Callout title="Tip">'));
  expect(live.text.toJSON()).toStartWith('Intro\n\n');
});

test('a prop typed in the side panel is kept when a teammate edits the same block, and the panel stays bound to it', async () => {
  const live = openLive(BODY);
  const title = await typeInPanel(live, 'Tip');
  live.teammate((shared) => shared.insert(shared.toJSON().indexOf('Hello'), 'Hey '));
  await frames();
  await waitFor(() => expect(live.text.toJSON()).toContain('<Callout title="Tip">'));
  // The field is still the user's: typing on and leaving it writes to the same block.
  const field = live.getByLabelText('title');
  act(() => {
    field.focus();
    fireEvent.change(field, { target: { value: 'Tips' } });
  });
  act(() => field.blur());
  await waitFor(() => expect(live.text.toJSON()).toContain('<Callout title="Tips">'));
  expect(live.text.toJSON()).toContain('Hey Hello!');
  expect(title.isConnected).toBe(true);
});

test('a prop typed in the side panel is kept when a teammate who never saw the typing edits the same block', async () => {
  const live = openLive(BODY);
  const title = await typeInPanel(live, 'Tip');
  live.teammate((shared) => shared.insert(shared.toJSON().indexOf('Hello'), 'Hey '), { concurrent: true });
  await frames();
  await waitFor(() => expect(live.text.toJSON()).toContain('<Callout title="Tip">'));
  expect(live.text.toJSON()).toContain('Hey Hello!');
  act(() => {
    title.focus();
    fireEvent.change(title, { target: { value: 'Tips' } });
  });
  act(() => title.blur());
  await waitFor(() => expect(live.text.toJSON()).toContain('<Callout title="Tips">'));
});

test('a prop typed in the side panel is written when the editor closes before the field is left', async () => {
  const live = openLive(BODY);
  await typeInPanel(live, 'Tip');
  live.unmount();
  expect(live.text.toJSON()).toContain('<Callout title="Tip">');
});

test('a prop typed in the side panel is written when the page is closed', async () => {
  const live = openLive(BODY);
  await typeInPanel(live, 'Tip');
  act(() => {
    window.dispatchEvent(new Event('pagehide'));
  });
  expect(live.text.toJSON()).toContain('<Callout title="Tip">');
});

test('a prop typed in the side panel is written when the tab is hidden', async () => {
  const live = openLive(BODY);
  await typeInPanel(live, 'Tip');
  // An own property shadows the document's getter until it is deleted again.
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  try {
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
  } finally {
    Reflect.deleteProperty(document, 'visibilityState');
  }
  expect(live.text.toJSON()).toContain('<Callout title="Tip">');
});

test('a number typed in the side panel is kept when a teammate edits the same block', async () => {
  const live = openLive(BODY);
  await typeInBody(live);
  const count = await waitFor(() => live.getByLabelText('count'));
  act(() => {
    count.focus();
    fireEvent.change(count, { target: { value: '3' } });
  });
  live.teammate((shared) => shared.insert(shared.toJSON().indexOf('Hello'), 'Hey '));
  await frames();
  await waitFor(() => expect(live.text.toJSON()).toContain('<Callout count={3}>'));
  expect(live.text.toJSON()).toContain('Hey Hello!');
});

test('the side panel lets go of a component a teammate replaced with something else', async () => {
  const live = openLive(BODY);
  await typeInPanel(live, '');
  live.teammate((shared) => {
    const end = shared.toJSON().indexOf('</Callout>') + '</Callout>'.length;
    shared.delete(0, end);
    shared.insert(0, 'Gone');
  });
  await frames();
  await waitFor(() => expect(live.container.textContent).toContain('Gone'));
  await waitFor(() => expect(live.queryByLabelText('title')).toBeNull());
});

test('text typed in a table cell is kept when a teammate edits the same table', async () => {
  // Laid out as the editor writes it, so the cell's write changes only the cell.
  const live = openLive('| Name  | Note |\n| ----- | ---- |\n| a     | b    |\n');
  const cell = await waitFor(() => {
    const found = [...live.container.querySelectorAll<HTMLElement>('td')].find((td) => td.textContent === 'a');
    if (!found) throw new Error('no cell');
    return found;
  });
  act(() => {
    fireEvent.click(cell);
  });
  const editable = await waitFor(() => {
    const found = cell.querySelector<HTMLElement>('[contenteditable="true"]');
    if (!found) throw new Error('cell editor not mounted');
    return found;
  });
  const cellEditor = getNearestEditorFromDOMNode(editable);
  if (!cellEditor) throw new Error('no cell editor');
  act(() => {
    editable.focus();
    cellEditor.update(() => $getRoot().selectEnd().insertText('lpha'), { discrete: true });
  });
  live.teammate((shared) => shared.insert(shared.toJSON().lastIndexOf('b    |'), 'B'));
  await frames();
  await waitFor(() => expect(live.text.toJSON()).toContain('alpha'));
  expect(live.text.toJSON()).toContain('Bb');
  await waitFor(() => expect(live.container.textContent).toContain('Bb'));
  expect(live.container.textContent).toContain('alpha');
});

/** Clicks into the table cell showing `a` and types `lpha` at its end, staying in the cell. */
async function typeInCell(live: Live) {
  const cell = await waitFor(() => {
    const found = [...live.container.querySelectorAll<HTMLElement>('td')].find((td) => td.textContent === 'a');
    if (!found) throw new Error('no cell');
    return found;
  });
  act(() => {
    fireEvent.click(cell);
  });
  const editable = await waitFor(() => {
    const found = cell.querySelector<HTMLElement>('[contenteditable="true"]');
    if (!found) throw new Error('cell editor not mounted');
    return found;
  });
  const cellEditor = getNearestEditorFromDOMNode(editable);
  if (!cellEditor) throw new Error('no cell editor');
  act(() => {
    editable.focus();
    cellEditor.update(() => $getRoot().selectEnd().insertText('lpha'), { discrete: true });
  });
  return { cell, editable };
}

test('text typed in a table cell is in the shared text before the cell is left, and the cell stays active', async () => {
  const live = openLive(TABLE);
  const { cell, editable } = await typeInCell(live);
  expect(live.text.toJSON()).toContain('| alpha');
  expect(document.activeElement).toBe(editable);
  expect(cell.dataset.active).toBe('true');
});

test('leaving the page with a table cell still focused keeps its text, written before anything of the leave runs', async () => {
  const live = openLive(TABLE);
  await typeInCell(live);
  // A page unload can end before what its teardown or pagehide writes leaves the editor's frame: it must be out already.
  expect(live.text.toJSON()).toContain('| alpha');
  live.unmount();
  expect(live.text.toJSON()).toContain('| alpha');
});

/** Opens `body` with a handle on the editor's realm, to switch views and type in the Source view as CodeMirror does. */
async function openWithRealm(body: string): Promise<{ live: Live; realm: Realm }> {
  let realm: Realm | undefined;
  const live = openLive(
    body,
    realmPlugin({
      init: (r) => {
        realm = r;
      },
    })(),
  );
  await waitFor(() => expect(live.container.textContent).toContain(body.trim()));
  if (!realm) throw new Error('no realm');
  return { live, realm };
}

/** Waits out the pause after the last key that the Source view's text is written after. */
const sourcePause = () => act(() => Bun.sleep(400));

test('text typed in the Source view is in the shared text once typing pauses', async () => {
  const { live, realm } = await openWithRealm('Hello\n');
  act(() => {
    realm.pub(viewMode$, 'source');
    realm.pub(markdownSourceEditorValue$, 'Hello there');
  });
  await sourcePause();
  expect(live.text.toJSON()).toBe('Hello there\n');
});

test('typing in the Source view of a large page reads the page once typing pauses, not on every key', async () => {
  const { live, realm } = await openWithRealm('Hello\n');
  // About 300 KB: reading it as MDX takes about 200 ms, so thirty keys each read would take seconds.
  const page = `Hello\n\n${'A paragraph of a large page, with enough words in it to count.\n\n'.repeat(4700)}`;
  act(() => realm.pub(viewMode$, 'source'));
  const started = performance.now();
  act(() => {
    for (let typed = 1; typed <= 30; typed++) realm.pub(markdownSourceEditorValue$, `${page}${'x'.repeat(typed)}`);
  });
  expect(performance.now() - started).toBeLessThan(300);
  await sourcePause();
  expect(live.text.toJSON()).toBe(`${page}${'x'.repeat(30)}\n`);
});

test('a teammate edit made while in the Source view shows once back in rich text, with both edits kept', async () => {
  const { live, realm } = await openWithRealm('Hello\n');
  act(() => {
    realm.pub(viewMode$, 'source');
    realm.pub(markdownSourceEditorValue$, 'Hello there');
  });
  await sourcePause();
  live.teammate((shared) => shared.insert(0, 'Intro\n\n'));
  await frames();
  // Shown now, it would rebuild the Source view under the caret.
  expect(realm.getValue(markdownSourceEditorValue$)).toBe('Hello there');
  expect(live.text.toJSON()).toBe('Intro\n\nHello there\n');
  act(() => realm.pub(viewMode$, 'rich-text'));
  await frames();
  await waitFor(() => expect(live.container.textContent).toContain('Intro'));
  expect(live.container.textContent).toContain('Hello there');
  expect(live.text.toJSON()).toBe('Intro\n\nHello there\n');
});

test('text typed in the Source view that does not parse yet is written once it parses, so no teammate gets a page their editor cannot read', async () => {
  const { live, realm } = await openWithRealm('Hello\n');
  act(() => {
    realm.pub(viewMode$, 'source');
    realm.pub(markdownSourceEditorValue$, 'Hello\n\n<Cal');
  });
  await sourcePause();
  expect(live.text.toJSON()).toBe('Hello\n');
  act(() => realm.pub(markdownSourceEditorValue$, 'Hello\n\n<Callout>'));
  await sourcePause();
  expect(live.text.toJSON()).toBe('Hello\n');
  act(() => realm.pub(markdownSourceEditorValue$, 'Hello\n\n<Callout />'));
  await sourcePause();
  expect(live.text.toJSON()).toBe('Hello\n\n<Callout />\n');
});

/** The tab is hidden (switched away from, the window minimised), as the browser says it. */
function hideTab() {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  try {
    document.dispatchEvent(new Event('visibilitychange'));
  } finally {
    Reflect.deleteProperty(document, 'visibilityState');
  }
}

for (const { leave, how } of [
  { leave: 'the switch back to rich text', how: (_live: Live, realm: Realm) => realm.pub(viewMode$, 'rich-text') },
  { leave: 'closing the editor', how: (live: Live) => live.unmount() },
  { leave: 'leaving the page', how: () => window.dispatchEvent(new Event('pagehide')) },
  { leave: 'hiding the tab', how: hideTab },
]) {
  test(`text typed in the Source view that does not parse is written on ${leave}`, async () => {
    const { live, realm } = await openWithRealm('Hello\n');
    act(() => {
      realm.pub(viewMode$, 'source');
      realm.pub(markdownSourceEditorValue$, 'Hello\n\n<Cal');
    });
    act(() => how(live, realm));
    expect(live.text.toJSON()).toBe('Hello\n\n<Cal\n');
  });

  test(`text typed in the Source view that parses is written on ${leave}, without waiting for a pause`, async () => {
    const { live, realm } = await openWithRealm('Hello\n');
    act(() => {
      realm.pub(viewMode$, 'source');
      realm.pub(markdownSourceEditorValue$, 'Hello there');
    });
    act(() => how(live, realm));
    expect(live.text.toJSON()).toBe('Hello there\n');
  });
}

test('switching back to rich text with text that does not parse keeps it, and the Source view stays open to fix it', async () => {
  const { live, realm } = await openWithRealm('Hello\n');
  act(() => {
    realm.pub(viewMode$, 'source');
    realm.pub(markdownSourceEditorValue$, 'Hello\n\n<Cal');
  });
  act(() => realm.pub(viewMode$, 'rich-text'));
  await frames();
  expect(live.text.toJSON()).toBe('Hello\n\n<Cal\n');
  await waitFor(() => expect(live.getByRole('alert').textContent).toContain('needs fixing'));
  expect(realm.getValue(viewMode$)).toBe('source');
  expect(realm.getValue(readOnly$)).toBe(false);
});

test('a teammate text the editor cannot read opens the Source view, editable, so anyone can fix it there', async () => {
  const { live, realm } = await openWithRealm('Hello\n');
  live.teammate((shared) => shared.insert(shared.length, '\n<Cal'));
  await frames();
  await waitFor(() => expect(live.getByRole('alert').textContent).toContain('needs fixing'));
  expect(realm.getValue(viewMode$)).toBe('source');
  expect(realm.getValue(readOnly$)).toBe(false);
  act(() => realm.pub(markdownSourceEditorValue$, 'Hello\n\n<Callout />'));
  await sourcePause();
  expect(live.text.toJSON()).toBe('Hello\n\n<Callout />');
  act(() => realm.pub(viewMode$, 'rich-text'));
  await frames();
  await waitFor(() => expect(live.queryByRole('alert')).toBeNull());
  const root = live.container.querySelector<HTMLElement>('[contenteditable]');
  const editor = root && getNearestEditorFromDOMNode(root);
  if (!editor) throw new Error('no editor');
  act(() => editor.update(() => $getRoot().getFirstChildOrThrow().selectEnd().insertText('!'), { discrete: true }));
  await waitFor(() => expect(live.text.toJSON()).toContain('Hello!'));
});

test('an editor opened on a text it cannot read opens in the Source view, editable', async () => {
  const live = openLive('Hello\n\n<Cal\n', diffSourcePlugin());
  await waitFor(() => expect(live.getByRole('alert').textContent).toContain('needs fixing'));
  const source = await waitFor(() => {
    const found = live.container.querySelector<HTMLElement>('.cm-content');
    if (!found) throw new Error('Source view not shown');
    return found;
  });
  expect(source.textContent).toContain('<Cal');
  expect(source.getAttribute('contenteditable')).toBe('true');
});

test('an editor held from its open on a text it cannot read opens the Source view read-only', async () => {
  const doc = new Y.Doc();
  const text = doc.getText('body');
  text.insert(0, 'Hello\n\n<Cal\n');
  const plugin = markdownLivePlugin({
    text,
    undoScope: [text],
    onSelectionBlock: () => {},
    held: { notice: () => 'Held', content: () => text.toJSON(), subscribe: () => () => {} },
  });
  const { container } = render(<LiveEditor text={text} plugin={plugin} extra={diffSourcePlugin()} />);
  await waitFor(() => {
    const source = container.querySelector<HTMLElement>('.cm-content');
    if (!source) throw new Error('Source view not shown');
    expect(source.textContent).toContain('<Cal');
    expect(source.getAttribute('aria-readonly')).toBe('true');
  });
});

/** Opens `body`, which the editor cannot read, in the Source view with its "needs fixing" alert. */
async function openToFix(body: string): Promise<{ live: Live; realm: Realm }> {
  let realm: Realm | undefined;
  const live = openLive(
    body,
    realmPlugin({
      init: (r) => {
        realm = r;
      },
    })(),
  );
  await waitFor(() => expect(live.getByRole('alert').textContent).toContain('needs fixing'));
  if (!realm) throw new Error('no realm');
  return { live, realm };
}

test('fixing in the Source view with nothing typed yet, a teammate fix shows there, and a fix of the same spot replaces it cleanly', async () => {
  const { live, realm } = await openToFix('Hello\n\n<Cal\n');
  live.teammate((shared) => shared.insert(shared.toJSON().indexOf('<Cal') + 4, 'lout />'));
  await frames();
  await waitFor(() => expect(realm.getValue(markdown$)).toContain('<Callout />'));
  await waitFor(() => expect(live.queryByRole('alert')).toBeNull());
  act(() => realm.pub(markdownSourceEditorValue$, 'Hello\n\n<Callout title="a" />'));
  await sourcePause();
  expect(live.text.toJSON()).toBe('Hello\n\n<Callout title="a" />\n');
});

test('fixing in the Source view with text not written yet, a teammate change is said, the stale fix is never merged into it, and it stays held to copy until copied', async () => {
  const copied: string[] = [];
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (value: string) => void copied.push(value) },
  });
  try {
    const { live, realm } = await openToFix('Hello\n\n<Cal\n');
    act(() => realm.pub(markdownSourceEditorValue$, 'Hello\n\n<Callo'));
    live.teammate((shared) => shared.insert(shared.toJSON().indexOf('<Cal') + 4, 'lout />'));
    await frames();
    await waitFor(() => expect(live.getByRole('alert').textContent).toContain('changed this page'));
    expect(hasHeldWork()).toBe(true);
    act(() => realm.pub(markdownSourceEditorValue$, 'Hello\n\n<Callout title="a" />'));
    await sourcePause();
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(live.text.toJSON()).toBe('Hello\n\n<Callout />\n');
    act(() => realm.pub(viewMode$, 'rich-text'));
    await frames();
    // The teammate's text shows; what this user typed is still held, to copy, and a leave still asks.
    await waitFor(() => expect(realm.getValue(markdown$)).toContain('<Callout />'));
    expect(live.text.toJSON()).toBe('Hello\n\n<Callout />\n');
    expect(live.getByRole('alert').textContent).toContain('changed this page');
    expect(hasHeldWork()).toBe(true);
    await act(async () => {
      fireEvent.click(live.getByRole('button', { name: 'Copy text' }));
    });
    expect(copied).toEqual(['Hello\n\n<Callout title="a" />']);
    await waitFor(() => expect(live.queryByRole('alert')).toBeNull());
    expect(hasHeldWork()).toBe(false);
  } finally {
    Reflect.deleteProperty(navigator, 'clipboard');
  }
});

test('a stale fix held to copy is let go by dismissing it', async () => {
  const { live, realm } = await openToFix('Hello\n\n<Cal\n');
  act(() => realm.pub(markdownSourceEditorValue$, 'Hello\n\n<Callo'));
  live.teammate((shared) => shared.insert(shared.toJSON().indexOf('<Cal') + 4, 'lout />'));
  await frames();
  await waitFor(() => expect(live.getByRole('alert').textContent).toContain('changed this page'));
  expect(hasHeldWork()).toBe(true);
  act(() => {
    fireEvent.click(live.getByRole('button', { name: 'Dismiss' }));
  });
  expect(hasHeldWork()).toBe(false);
  expect(live.queryByText(/changed this page/)).toBeNull();
});

test('the editor counts as co-edited only while it is open', async () => {
  expect(isLiveEditing()).toBe(false);
  const live = openLive('Hello\n');
  await waitFor(() => expect(live.container.textContent).toContain('Hello'));
  expect(isLiveEditing()).toBe(true);
  live.unmount();
  expect(isLiveEditing()).toBe(false);
});

test('an editor a hold made read-only shows no teammate change, so nothing is typed into a held replica', async () => {
  const doc = new Y.Doc();
  const text = doc.getText('body');
  text.insert(0, 'Hello\n');
  let notice: string | null = null;
  const listeners = new Set<() => void>();
  const plugin = markdownLivePlugin({
    text,
    undoScope: [text],
    onSelectionBlock: () => {},
    held: {
      notice: () => notice,
      content: () => text.toJSON(),
      subscribe: (onChange) => {
        listeners.add(onChange);
        return () => {
          listeners.delete(onChange);
        };
      },
    },
  });
  const { container } = render(<LiveEditor text={text} plugin={plugin} />);
  await waitFor(() => expect(container.textContent).toContain('Hello'));
  act(() => {
    notice = 'Held';
    for (const onChange of listeners) onChange();
  });
  const root = container.querySelector<HTMLElement>('[contenteditable]');
  await waitFor(() => expect(root?.getAttribute('contenteditable')).toBe('false'));
  act(() => text.insert(0, 'Intro\n\n'));
  await frames();
  expect(container.textContent).not.toContain('Intro');
  expect(root?.getAttribute('contenteditable')).toBe('false');
});

/**
 * The Callout as a site renders it: the preview comes from the render endpoint, its title is text the author edits in
 * place, and the markup carries the block's place in the page, so a teammate's insert above re-renders it.
 */
function renderedBySite({ inFlightFor }: { inFlightFor?: string } = {}) {
  setMdxComponents([
    { name: 'Callout', kind: 'flow', hasChildren: true, import: { from: 'site' }, props: CALLOUT_PROPS },
  ]);
  const answer = (_url: URL | RequestInfo, init?: RequestInit) => {
    if (typeof init?.body !== 'string') throw new Error('the render request has no JSON body');
    const request: { documentIndex: number; tree: { props: { title?: string }; bodyHtml?: string } } = JSON.parse(
      init.body,
    );
    // The render for this title never answers while the test runs.
    if (inFlightFor !== undefined && request.tree.props.title === inFlightFor) return new Promise<Response>(() => {});
    // A list body comes as its items, which the site's list component wraps; any other body goes into the slot.
    const body = request.tree.bodyHtml ? `<ol>${request.tree.bodyHtml}</ol>` : '<conloca-slot></conloca-slot>';
    return Promise.resolve(
      new Response(`<p>${request.tree.props.title ?? ''}</p><small>block ${request.documentIndex}</small>${body}`),
    );
  };
  // Bun's `typeof fetch` carries `preconnect`; the render never calls it.
  return spyOn(globalThis, 'fetch').mockImplementation(Object.assign(answer, { preconnect: fetch.preconnect }));
}

const TITLED = '<Callout title="Note">\n\nHello\n\n</Callout>\n\nOther\n';

/** The block's inline title field, once the block shows the render for its place `index` in the page. */
async function inlineTitle(live: Live, index: number): Promise<HTMLElement> {
  return waitFor(() => {
    const block = live.container.querySelector<HTMLElement>('.conloca-generic-block');
    const found = block?.querySelector<HTMLElement>('[data-conloca-prop="title"]');
    if (!found || !block?.textContent?.includes(`block ${index}`))
      throw new Error(`no inline title rendered at ${index}`);
    return found;
  });
}

test('a rendered component re-rendered by a teammate insert above keeps the body being typed in, with focus and caret', async () => {
  const site = renderedBySite();
  try {
    const live = openLive(TITLED);
    await inlineTitle(live, 1);
    const { body, nested } = await typeInBody(live);
    live.teammate((shared) => shared.insert(0, 'Intro\n\n'));
    await frames();
    await inlineTitle(live, 2);
    expect(body.isConnected).toBe(true);
    expect(document.activeElement).toBe(body);
    expect(caretOffset(nested)).toBe('Hello!'.length);
    expect(live.text.toJSON()).toContain('Hello!');
  } finally {
    site.mockRestore();
  }
});

test('a prop typed in place keeps its text and focus when a teammate insert above re-renders the component', async () => {
  const site = renderedBySite();
  try {
    const live = openLive(TITLED);
    const title = await inlineTitle(live, 1);
    act(() => {
      title.focus();
      title.textContent = 'Notes';
    });
    live.teammate((shared) => shared.insert(0, 'Intro\n\n'));
    await frames();
    await waitFor(() => expect(live.text.toJSON()).toContain('title="Notes"'));
    const field = await inlineTitle(live, 2);
    expect(field.textContent).toBe('Notes');
    expect(document.activeElement).toBe(field);
  } finally {
    site.mockRestore();
  }
});

test('a prop typed in place is written when a teammate edits the same component', async () => {
  const site = renderedBySite();
  try {
    const live = openLive(TITLED);
    const title = await inlineTitle(live, 1);
    act(() => {
      title.focus();
      title.textContent = 'Notes';
      fireEvent.input(title);
    });
    live.teammate((shared) => shared.insert(shared.toJSON().indexOf('Hello'), 'Hey '));
    await frames();
    await waitFor(() => expect(live.text.toJSON()).toContain('title="Notes"'));
    expect(live.text.toJSON()).toContain('Hey Hello');
  } finally {
    site.mockRestore();
  }
});

test('a prop typed in place keeps its text while the render that shows it is still on its way', async () => {
  // A title no other test renders: the block's render cache lives as long as the module.
  const site = renderedBySite({ inFlightFor: 'Noted' });
  try {
    const live = openLive(TITLED);
    const title = await inlineTitle(live, 1);
    act(() => {
      title.focus();
      title.textContent = 'Noted';
    });
    live.teammate((shared) => shared.insert(0, 'Intro\n\n'));
    await frames();
    const field = await inlineTitle(live, 2);
    expect(field.textContent).toBe('Noted');
    expect(live.text.toJSON()).toContain('title="Noted"');
  } finally {
    site.mockRestore();
  }
});

test('a list item typed in place is written when a teammate edits the same component', async () => {
  const site = renderedBySite();
  try {
    const live = openLive('<Callout title="Note">\n\n- one\n- two\n\n</Callout>\n\nOther\n');
    const item = await waitFor(() => {
      const found = [...live.container.querySelectorAll<HTMLElement>('li')].find((li) => li.textContent === 'one');
      if (!found) throw new Error('no editable list item');
      return found;
    });
    act(() => {
      item.focus();
      item.textContent = 'uno';
    });
    live.teammate((shared) => shared.insert(shared.toJSON().indexOf('two'), 'and '));
    await frames();
    await waitFor(() => expect(live.text.toJSON()).toContain('uno'));
    expect(live.text.toJSON()).toContain('and two');
  } finally {
    site.mockRestore();
  }
});

test('a list item typed in place is written when a teammate insert above re-renders the component, and never written again later', async () => {
  const site = renderedBySite();
  try {
    const live = openLive('<Callout title="Note">\n\n- one\n- two\n\n</Callout>\n\nOther\n');
    const item = (content: string) =>
      waitFor(() => {
        const found = [...live.container.querySelectorAll<HTMLElement>('li[data-conloca-listitem]')].find(
          (li) => li.textContent === content,
        );
        if (!found) throw new Error(`no editable list item ${content}`);
        return found;
      });
    const first = await item('one');
    act(() => {
      first.focus();
      first.textContent = 'uno';
    });
    live.teammate((shared) => shared.insert(0, 'Intro\n\n'));
    await frames();
    await waitFor(() => expect(live.text.toJSON()).toContain('uno'));
    const again = await item('uno');
    act(() => {
      again.focus();
      again.textContent = 'eins';
      again.blur();
    });
    await waitFor(() => expect(live.text.toJSON()).toContain('eins'));
    // Drafts are written when a teammate's change shows and when the editor closes: the first item's must be gone.
    live.teammate((shared) => shared.insert(shared.toJSON().indexOf('Other'), 'Teammate '));
    await frames();
    live.unmount();
    expect(live.text.toJSON()).toContain('eins');
    expect(live.text.toJSON()).not.toContain('uno');
  } finally {
    site.mockRestore();
  }
});

test('a list item that leaves the page without a blur writes nothing afterwards', async () => {
  const site = renderedBySite();
  try {
    const live = openLive('<Callout title="Note">\n\n- one\n- two\n\n</Callout>\n\nOther\n');
    const first = await waitFor(() => {
      const found = [...live.container.querySelectorAll<HTMLElement>('li[data-conloca-listitem]')].find(
        (li) => li.textContent === 'one',
      );
      if (!found) throw new Error('no editable list item');
      return found;
    });
    act(() => {
      first.focus();
      first.textContent = 'uno';
      // Some browsers detach a focused element without a blur.
      first.remove();
    });
    live.teammate((shared) => shared.insert(shared.toJSON().indexOf('Other'), 'Teammate '));
    await frames();
    live.unmount();
    expect(live.text.toJSON()).toContain('Teammate Other');
    expect(live.text.toJSON()).not.toContain('uno');
  } finally {
    site.mockRestore();
  }
});

/** Types `typed` into list item `li` as the browser does: the item's text changes and an input event follows. */
function typeInItem(li: HTMLElement, typed: string) {
  act(() => {
    li.focus();
    li.textContent = typed;
    fireEvent.input(li);
  });
}

test('a list item typed in place writes as it is typed, keeping its item, focus and text, so leaving the page keeps it', async () => {
  const site = renderedBySite();
  try {
    const live = openLive('<Callout title="Note">\n\n- one\n- two\n\n</Callout>\n\nOther\n');
    const item = await waitFor(() => {
      const found = [...live.container.querySelectorAll<HTMLElement>('li[data-conloca-listitem]')].find(
        (li) => li.textContent === 'one',
      );
      if (!found) throw new Error('no editable list item');
      return found;
    });
    for (const typed of ['on', 'o', 'uno']) {
      typeInItem(item, typed);
      expect(live.text.toJSON()).toContain(`* ${typed}\n\n* two`);
      // oxlint-disable-next-line eslint/no-await-in-loop -- each key's render, if any, lands before the next key
      await frames();
      expect(item.isConnected).toBe(true);
      expect(document.activeElement).toBe(item);
      expect(item.textContent).toBe(typed);
    }
    // A reload with focus still in the item: nothing of the leave runs, so the text must be out already.
    live.unmount();
    expect(live.text.toJSON()).toContain('* uno\n\n* two');
  } finally {
    site.mockRestore();
  }
});

test('a list item typed in place keeps a teammate edit to another item, with the keys typed after it', async () => {
  const site = renderedBySite();
  try {
    const live = openLive('<Callout title="Note">\n\n- one\n- two\n\n</Callout>\n\nOther\n');
    const item = (content: string) =>
      waitFor(() => {
        const found = [...live.container.querySelectorAll<HTMLElement>('li[data-conloca-listitem]')].find(
          (li) => li.textContent === content,
        );
        if (!found) throw new Error(`no editable list item ${content}`);
        return found;
      });
    typeInItem(await item('one'), 'uno');
    live.teammate((shared) => shared.insert(shared.toJSON().indexOf('two') + 'two'.length, '!'));
    await frames();
    typeInItem(await item('uno'), 'unos');
    await frames();
    expect(live.text.toJSON()).toContain('* unos\n\n* two!');
  } finally {
    site.mockRestore();
  }
});

test('an object field typed in the side panel is kept when a teammate edits the same block', async () => {
  const live = openLive(BODY);
  await typeInBody(live);
  const note = await waitFor(() => {
    const found = document.querySelector<HTMLInputElement>('fieldset[aria-label="meta"] input');
    if (!found) throw new Error('no object field');
    return found;
  });
  act(() => {
    note.focus();
    fireEvent.change(note, { target: { value: 'kept' } });
  });
  live.teammate((shared) => shared.insert(shared.toJSON().indexOf('Hello'), 'Hey '));
  await frames();
  await waitFor(() => expect(live.text.toJSON()).toContain('kept'));
  expect(live.text.toJSON()).toContain('Hey Hello!');
});

test('a component selected inside a body a teammate rebuilds leaves the side panel instead of staying bound to nothing', async () => {
  const live = openLive('<Callout>\n\nOuter\n\n<Callout title="Inner">\n\nHello\n\n</Callout>\n\n</Callout>\n');
  const { body } = await bodyWith(live.container, 'Hello');
  act(() => {
    fireEvent.mouseDown(body);
  });
  await waitFor(() => expect(live.getByLabelText('title')).toHaveValue('Inner'));
  live.teammate((shared) => shared.insert(shared.toJSON().indexOf('Outer'), 'The '));
  await frames();
  await waitFor(() => expect(live.container.textContent).toContain('The Outer'));
  await waitFor(() => expect(live.queryByLabelText('title')).toBeNull());
});

test('unmounting the editor stops observing the shared text and releases its undo and hold subscriptions', async () => {
  const doc = new Y.Doc();
  const text = doc.getText('body');
  text.insert(0, 'Hello\n');
  const observe = spyOn(text, 'observe');
  const unobserve = spyOn(text, 'unobserve');
  const destroyUndo = spyOn(Y.UndoManager.prototype, 'destroy');
  // The notice watches the hold too; every subscription made is released.
  let subscribed = 0;
  let unsubscribed = 0;
  const plugin = livePlugin({
    text,
    undoScope: [text],
    onSelectionBlock: () => {},
    held: {
      notice: () => null,
      content: () => '',
      subscribe: () => {
        subscribed++;
        return () => {
          unsubscribed++;
        };
      },
    },
  });
  const { unmount } = render(<LiveEditor text={text} plugin={plugin} />);
  await waitFor(() => expect(observe).toHaveBeenCalledTimes(1));
  const [observer] = observe.mock.calls[0];
  const destroyedBefore = destroyUndo.mock.calls.length;

  unmount();

  expect(unobserve).toHaveBeenCalledWith(observer);
  expect(subscribed).toBeGreaterThan(0);
  expect(unsubscribed).toBe(subscribed);
  expect(destroyUndo.mock.calls.length).toBe(destroyedBefore + 1);
  destroyUndo.mockRestore();
});

test('a teammate edit that lands while the editor starts is shown', async () => {
  const doc = new Y.Doc();
  const text = doc.getText('body');
  text.insert(0, 'Hello\n');
  // Set up after the binding's plugin, before the editor mounts: the binding is not observing the text yet.
  const arrives = realmPlugin({ init: () => text.insert(0, 'Intro\n\n') })();
  const plugins = [livePlugin({ text, undoScope: [text], onSelectionBlock: () => {} }), arrives];
  const { container } = render(<MDXEditor markdown={text.toJSON()} plugins={plugins} />);
  await waitFor(() => expect(container.textContent).toContain('Intro'));
});

test('a teammate edit that lands between the host reading the text and the editor starting is shown', async () => {
  const doc = new Y.Doc();
  const text = doc.getText('body');
  text.insert(0, 'Hello\n');
  // The host reads the text and builds the plugin in one render; the editor starts in a later effect.
  const shown = text.toJSON();
  const plugin = livePlugin({ text, undoScope: [text], onSelectionBlock: () => {} });
  text.insert(0, 'Intro\n\n');
  const { container } = render(<LiveEditor text={text} plugin={plugin} markdown={shown} />);
  await waitFor(() => expect(container.textContent).toContain('Intro'));
});

test('under StrictMode the editor still shows teammate edits, writes a local edit once, and leaves no observer', async () => {
  const doc = new Y.Doc();
  const text = doc.getText('body');
  text.insert(0, 'Hello\n');
  const observe = spyOn(text, 'observe');
  const unobserve = spyOn(text, 'unobserve');
  const { container, unmount } = render(
    <StrictMode>
      <LiveEditor text={text} />
    </StrictMode>,
  );
  await waitFor(() => expect(container.textContent).toContain('Hello'));
  await frames(1);
  text.insert(0, 'Intro\n\n');
  await waitFor(() => expect(container.textContent).toContain('Intro'));

  const root = container.querySelector<HTMLElement>('[contenteditable="true"]');
  const editor = root && getNearestEditorFromDOMNode(root);
  if (!editor) throw new Error('no editor');
  let writes = 0;
  doc.on('afterTransaction', (transaction: Y.Transaction) => {
    if (transaction.origin === LOCAL_ORIGIN) writes++;
  });
  act(() => editor.update(() => $getRoot().selectEnd().insertText('!'), { discrete: true }));
  await waitFor(() => expect(text.toJSON()).toContain('Hello!'));
  expect(writes).toBe(1);

  unmount();

  expect(unobserve).toHaveBeenCalledTimes(observe.mock.calls.length);
  for (const [observer] of observe.mock.calls) expect(unobserve).toHaveBeenCalledWith(observer);
});

describe('on a page', () => {
  for (const [name, run] of scenarios) it(name, run);
});

describe('in a fragment, with a save check that passes', () => {
  beforeAll(() => {
    fragmentCheck = () => null;
  });
  afterAll(() => {
    fragmentCheck = undefined;
  });
  for (const [name, run] of scenarios) it(name, run);
});

/**
 * Opens BODY bound with save check `check`; `held` collects what the editor reports held; `realm` is the editor's;
 * `writes` counts the editor's writes to the shared text.
 */
function openChecked(check: (markdown: string) => string | null) {
  const doc = new Y.Doc();
  const text = doc.getText('body');
  text.insert(0, BODY);
  let writes = 0;
  doc.on('afterTransaction', (transaction: Y.Transaction) => {
    if (transaction.origin === LOCAL_ORIGIN) writes++;
  });
  const held: [string | null, string | null][] = [];
  const plugin = markdownLivePlugin({
    text,
    undoScope: [text],
    onSelectionBlock: () => {},
    check,
    onHeld: (notice, markdown) => held.push([notice, markdown]),
  });
  let grabbed: Realm | undefined;
  const extra = realmPlugin({
    init: (r) => {
      grabbed = r;
    },
  })();
  const view = render(<LiveEditor text={text} plugin={plugin} extra={extra} />);
  const realm = () => {
    if (!grabbed) throw new Error('no realm');
    return grabbed;
  };
  return { ...view, text, held, realm, writes: () => writes };
}

/** Types '!' at the end of BODY's component body, which `openChecked`'s check is to refuse. */
async function holdShout(live: { container: HTMLElement }) {
  const { body, nested } = await bodyWith(live.container, 'Hello');
  act(() => {
    body.focus();
    nested.update(() => $getRoot().selectEnd().insertText('!'), { discrete: true });
  });
  await waitFor(() => expect(live.container.textContent).toContain('Not saved: no shouting'));
  return nested;
}

const bogus = (markdown: string) => (markdown.includes('<Bogus731') ? 'unknown component Bogus731' : null);
const refusedSource = '<Callout>\n\nHello\n\n</Callout>\n\n<Bogus731 />\n';

describe('in a fragment, an edit the save check refuses', () => {
  it('typed in a component body is held with its reason, kept in the body with its caret, and sent once it passes', async () => {
    let refuse = true;
    const live = openChecked((markdown) => (refuse && markdown.includes('Hello!') ? 'no shouting' : null));
    const { body, nested } = await bodyWith(live.container, 'Hello');
    act(() => {
      body.focus();
      nested.update(() => $getRoot().selectEnd().insertText('!'), { discrete: true });
    });
    await waitFor(() => expect(live.container.textContent).toContain('Not saved: no shouting'));
    expect(live.text.toJSON()).toBe(BODY);
    expect(live.held.at(-1)?.[1]).toContain('Hello!');
    // A teammate edit waits while held: showing it would rebuild the body and drop the held text.
    live.text.doc?.transact(() => live.text.insert(0, 'Intro\n\n'), REMOTE);
    await frames();
    expect(live.container.textContent).not.toContain('Intro');
    expect(body.textContent).toBe('Hello!');
    expect(document.activeElement).toBe(body);
    expect(caretOffset(nested)).toBe('Hello!'.length);
    refuse = false;
    act(() => nested.update(() => $getRoot().selectEnd().insertText('?'), { discrete: true }));
    await waitFor(() => expect(live.text.toJSON()).toContain('Hello!?'));
    expect(live.text.toJSON()).toContain('Intro');
    expect(live.held.at(-1)).toEqual([null, null]);
    await waitFor(() => expect(live.container.textContent).toContain('Intro'));
    expect(live.container.textContent).not.toContain('Not saved');
  });

  it('a check that throws holds the edit and says so, rather than sending it unchecked', async () => {
    const live = openChecked((markdown) => {
      if (markdown.includes('Hello!')) throw new Error('parser crashed');
      return null;
    });
    const { body, nested } = await bodyWith(live.container, 'Hello');
    act(() => {
      body.focus();
      nested.update(() => $getRoot().selectEnd().insertText('!'), { discrete: true });
    });
    await waitFor(() => expect(live.container.textContent).toContain('Not saved: the check failed'));
    await frames();
    expect(live.text.toJSON()).toBe(BODY);
    expect(live.held.at(-1)).toEqual(['Not saved: the check failed', expect.stringContaining('Hello!')]);
  });

  it('a check that throws on every text, the base too, still holds the edit rather than sending it unchecked', async () => {
    const live = openChecked(() => {
      throw new Error('parser crashed');
    });
    const { body, nested } = await bodyWith(live.container, 'Hello');
    act(() => {
      body.focus();
      nested.update(() => $getRoot().selectEnd().insertText('!'), { discrete: true });
    });
    await waitFor(() => expect(live.container.textContent).toContain('Not saved: the check failed'));
    await frames();
    expect(live.text.toJSON()).toBe(BODY);
  });

  it("held while the Source view is open, a teammate's text is not shown or merged until the hold ends, then shows", async () => {
    let refuse = true;
    const live = openChecked((markdown) => (refuse && markdown.includes('Hello!') ? 'no shouting' : null));
    await holdShout(live);
    const realm = live.realm();
    act(() => realm.pub(viewMode$, 'source'));
    live.text.doc?.transact(() => live.text.insert(0, 'Intro\n\n'), REMOTE);
    await sourcePause();
    // Neither the Source view nor its write takes the teammate's text in, and the held edit is not sent by it.
    expect(realm.getValue(markdownSourceEditorValue$)).not.toContain('Intro');
    expect(live.text.toJSON()).toBe(`Intro\n\n${BODY}`);
    expect(live.getByRole('alert').textContent).toContain('Not saved: no shouting');
    act(() => realm.pub(viewMode$, 'rich-text'));
    await frames();
    expect(live.container.textContent).not.toContain('Intro');
    const { nested } = await bodyWith(live.container, 'Hello!');
    refuse = false;
    act(() => nested.update(() => $getRoot().selectEnd().insertText('?'), { discrete: true }));
    await waitFor(() => expect(live.text.toJSON()).toContain('Hello!?'));
    expect(live.text.toJSON()).toContain('Intro');
    await waitFor(() => expect(live.container.textContent).toContain('Intro'));
    expect(live.queryByRole('alert')).toBeNull();
  });

  it('held when a teammate makes the page unreadable, the edit stays held, then is sent and the Source view opens to fix it', async () => {
    let refuse = true;
    const live = openChecked((markdown) => (refuse && markdown.includes('Hello!') ? 'no shouting' : null));
    const nested = await holdShout(live);
    const realm = live.realm();
    live.text.doc?.transact(() => live.text.insert(live.text.length, '\n<Cal'), REMOTE);
    await frames();
    // One notice at a time: the held edit's, not the fix one.
    expect(live.getAllByRole('alert').map((alert) => alert.textContent)).toEqual([
      expect.stringContaining('Not saved: no shouting'),
    ]);
    expect(realm.getValue(viewMode$)).toBe('rich-text');
    refuse = false;
    act(() => nested.update(() => $getRoot().selectEnd().insertText('?'), { discrete: true }));
    await waitFor(() => expect(live.getByRole('alert').textContent).toContain('needs fixing'));
    expect(realm.getValue(viewMode$)).toBe('source');
    expect(live.text.toJSON()).toContain('Hello!?');
    expect(live.text.toJSON()).toContain('<Cal');
    expect(realm.getValue(markdownSourceEditorValue$)).toContain('Hello!?');
  });

  it('held, text typed in the Source view passes the same check: refused it stays held, passing it is written once', async () => {
    const checked: string[] = [];
    const live = openChecked((markdown) => {
      checked.push(markdown);
      return markdown.includes('Hello!') ? 'no shouting' : null;
    });
    await holdShout(live);
    const realm = live.realm();
    act(() => realm.pub(viewMode$, 'source'));
    act(() => realm.pub(markdownSourceEditorValue$, '<Callout>\n\nHello!!\n\n</Callout>\n\nOther\n'));
    await sourcePause();
    expect(checked.at(-1)).toContain('Hello!!');
    expect(live.writes()).toBe(0);
    expect(live.getByRole('alert').textContent).toContain('Not saved: no shouting');
    act(() => realm.pub(markdownSourceEditorValue$, '<Callout>\n\nHello.\n\n</Callout>\n\nOther\n'));
    await sourcePause();
    expect(live.text.toJSON()).toContain('Hello.');
    expect(live.writes()).toBe(1);
    await waitFor(() => expect(live.queryByRole('alert')).toBeNull());
    act(() => realm.pub(viewMode$, 'rich-text'));
    await frames();
    expect(live.writes()).toBe(1);
    expect(live.held.at(-1)).toEqual([null, null]);
  });

  it('typed in the Source view with nothing held, a refused tag never reaches the shared text and its reason shows', async () => {
    const live = openChecked(bogus);
    await bodyWith(live.container, 'Hello');
    const realm = live.realm();
    act(() => realm.pub(viewMode$, 'source'));
    act(() => realm.pub(markdownSourceEditorValue$, refusedSource));
    await sourcePause();
    expect(live.text.toJSON()).toBe(BODY);
    expect(live.writes()).toBe(0);
    expect(live.getByRole('alert').textContent).toContain('Not saved: unknown component Bogus731');
    expect(live.held.at(-1)).toEqual(['Not saved: unknown component Bogus731', refusedSource]);
  });

  for (const { leave, how } of [
    {
      leave: 'the switch back to rich text',
      how: (_live: RenderResult, realm: Realm) => realm.pub(viewMode$, 'rich-text'),
    },
    { leave: 'closing the editor', how: (live: RenderResult) => live.unmount() },
    { leave: 'leaving the page', how: () => window.dispatchEvent(new Event('pagehide')) },
    { leave: 'hiding the tab', how: hideTab },
  ]) {
    it(`typed in the Source view, a refused tag is held, not written, on ${leave}`, async () => {
      const live = openChecked(bogus);
      await bodyWith(live.container, 'Hello');
      const realm = live.realm();
      act(() => {
        realm.pub(viewMode$, 'source');
        realm.pub(markdownSourceEditorValue$, refusedSource);
      });
      act(() => how(live, realm));
      expect(live.text.toJSON()).toBe(BODY);
      expect(live.writes()).toBe(0);
      expect(live.held.at(-1)).toEqual(['Not saved: unknown component Bogus731', refusedSource]);
    });
  }

  for (const step of ['undo', 'redo'] as const) {
    it(`an ${step} whose text the check refuses is held with its reason, never written`, async () => {
      // Refuses the page once a teammate's Intro is in it without this user's '!': only undoing the '!' fails.
      const live = openChecked((markdown) =>
        markdown.includes('Intro') && !markdown.includes('Hello!') ? 'no quiet intro' : null,
      );
      const { body, nested } = await bodyWith(live.container, 'Hello');
      if (step === 'redo') {
        // Redo re-applies a '!' removal: type '!' and then erase it, undo the erase, then redo it with Intro in.
        act(() => {
          body.focus();
          nested.update(() => $getRoot().selectEnd().insertText('!'), { discrete: true });
        });
        await waitFor(() => expect(live.text.toJSON()).toContain('Hello!'));
        await act(() => Bun.sleep(600));
        act(() =>
          nested.update(() => $getRoot().getAllTextNodes()[0]?.setTextContent('Hello').selectEnd(), { discrete: true }),
        );
        await waitFor(() => expect(live.text.toJSON()).toBe(BODY));
        act(() => void nested.dispatchCommand(UNDO_COMMAND, undefined));
        await waitFor(() => expect(live.text.toJSON()).toContain('Hello!'));
      } else {
        act(() => {
          body.focus();
          nested.update(() => $getRoot().selectEnd().insertText('!'), { discrete: true });
        });
        await waitFor(() => expect(live.text.toJSON()).toContain('Hello!'));
      }
      live.text.doc?.transact(() => live.text.insert(live.text.length, '\nIntro\n'), REMOTE);
      await frames();
      const before = live.text.toJSON();
      let updates = 0;
      live.text.doc?.on('update', () => updates++);
      act(() => void nested.dispatchCommand(step === 'undo' ? UNDO_COMMAND : REDO_COMMAND, undefined));
      await frames();
      // Not even a write put back: no update the provider could send went out.
      expect(updates).toBe(0);
      expect(live.text.toJSON()).toBe(before);
      await waitFor(() => expect(live.container.textContent).toContain('Not saved: no quiet intro'));
      expect(live.held.at(-1)?.[0]).toBe('Not saved: no quiet intro');
    });
  }

  it('an undo that restores erased text the check refuses is held with its reason, never written', async () => {
    // Refuses the page once it has both a teammate's Intro and this user's '!': only restoring the erased '!' fails.
    const live = openChecked((markdown) =>
      markdown.includes('Intro') && markdown.includes('Hello!') ? 'no loud intro' : null,
    );
    const { body, nested } = await bodyWith(live.container, 'Hello');
    act(() => {
      body.focus();
      nested.update(() => $getRoot().selectEnd().insertText('!'), { discrete: true });
    });
    await waitFor(() => expect(live.text.toJSON()).toContain('Hello!'));
    await act(() => Bun.sleep(600));
    act(() =>
      nested.update(() => $getRoot().getAllTextNodes()[0]?.setTextContent('Hello').selectEnd(), { discrete: true }),
    );
    await waitFor(() => expect(live.text.toJSON()).toBe(BODY));
    live.text.doc?.transact(() => live.text.insert(live.text.length, '\nIntro\n'), REMOTE);
    await frames();
    const before = live.text.toJSON();
    let updates = 0;
    live.text.doc?.on('update', () => updates++);
    act(() => void nested.dispatchCommand(UNDO_COMMAND, undefined));
    await frames();
    expect(updates).toBe(0);
    expect(live.text.toJSON()).toBe(before);
    await waitFor(() => expect(live.container.textContent).toContain('Not saved: no loud intro'));
    expect(live.held.at(-1)).toEqual(['Not saved: no loud intro', expect.stringContaining('Hello!')]);
  });
});
