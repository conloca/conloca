import type { LocalizedEntry } from '@conloca/content-api-client';
import type { Config } from '@puckeditor/core';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import '../../main.css';
import { PUCK_ROOT_DROP_ZONE } from './DrawerItemOverride.js';
import { PageEditorHarness } from './PageEditorCanvas.stories.js';

/**
 * Adding a block to a page by dragging it out of the block list.
 *
 * Puck starts a drag only from a press that lands on its own drawer item or on a part of it that is not an
 * interactive element (a button, link or input). So whatever the editor puts inside a drawer item must stay
 * non-interactive, or every drag from the list silently does nothing: no block is added and no error is shown.
 *
 * The drag here is a press on the list item, a pause, and a move across the screen, sent as the pointer events a mouse
 * sends: Puck captures the pointer on the page body once a drag starts, so the moves and the release go there. The
 * real Puck drag-and-drop code decides whether the drag starts. Only `setPointerCapture` is stubbed: it rejects a
 * pointer that is not a real device pointer, and a story cannot move the real mouse.
 *
 * An added block is also a step of the editor's history, whichever way it was added: Undo takes it off the page and
 * Redo puts it back.
 */

/** Two blocks and a root `title` field: the shape of a site's Puck config. */
const SITE_CONFIG: Config = {
  root: { fields: { title: { type: 'text' } } },
  components: {
    Hero: {
      fields: { heading: { type: 'text' } },
      defaultProps: { heading: 'Welcome' },
      render: ({ heading }) => <section data-testid="block-hero">{heading}</section>,
    },
    Services: {
      fields: { heading: { type: 'text' } },
      defaultProps: { heading: 'Our services' },
      render: ({ heading }) => <section data-testid="block-services">{heading}</section>,
    },
  },
};

function pageWith(content: unknown[]): LocalizedEntry {
  return {
    id: 'drop-page',
    type: 'puck',
    kind: 'page',
    site: 'default',
    collection: 'pages',
    localized: {
      locale: 'en',
      pathname: '/test',
      etag: 'meta.content',
      created: '2026-10-21T00:00:00.000Z',
      modified: '2026-10-21T00:00:00.000Z',
      meta: { title: 'test' },
      content: { puckData: { root: { props: { title: 'test' } }, content, zones: {} } },
    },
  };
}

const meta = {
  title: 'Editor/PageEditor drag and drop',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
// No args: every story renders its own harness.
type Story = StoryObj;

interface Point {
  x: number;
  y: number;
}

function pause(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(() => resolve(), ms);
  return promise;
}

function centreOf(element: Element): Point {
  const box = element.getBoundingClientRect();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function canvasFrame(canvasElement: HTMLElement): HTMLIFrameElement {
  const frame = canvasElement.querySelector<HTMLIFrameElement>('iframe#preview-frame');
  if (!frame) throw new Error('the page editor has no canvas');
  return frame;
}

/** The canvas document, once Puck's preview iframe has rendered. */
async function canvasDocument(canvasElement: HTMLElement): Promise<Document> {
  return waitFor(
    () => {
      const doc = canvasFrame(canvasElement).contentDocument;
      if (!doc?.querySelector('[data-puck-dropzone]')) throw new Error('the canvas has not rendered its drop area yet');
      return doc;
    },
    { timeout: 10_000 },
  );
}

/** Puck draws each drawer item twice: a still backdrop and the draggable copy on top, tagged `drawer-item:<name>`. */
function drawerItem(canvasElement: HTMLElement, name: string): HTMLElement {
  const draggable = within(canvasElement).getByTestId(`drawer-item:${name}`);
  return within(draggable).getByTestId(`drawer-item-${name}`);
}

function pointer(type: string, at: Point, target: EventTarget): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      clientX: at.x,
      clientY: at.y,
    }),
  );
}

/** Puck arms a drag only after a press has been held for 200 ms, then lets it follow the pointer. */
const HOLD_BEFORE_MOVE_MS = 250;
const MOVE_STEPS = 12;
const MOVE_STEP_MS = 30;
/** Puck waits 100 ms after the pointer enters an area before it treats that area as the target, then refreshes. */
const SETTLE_BEFORE_RELEASE_MS = 500;

/**
 * Presses where `item` is on screen, holds long enough for Puck's drag to arm, moves across the screen to `to` and
 * releases. The press goes to whatever element is under the pointer there, as a real one does, not to `item` itself.
 */
async function dragTo(item: HTMLElement, to: Point): Promise<void> {
  const from = centreOf(item);
  const body = item.ownerDocument.body;
  // Puck captures the pointer on the body when a drag starts, and the browser refuses that for a pointer id it has no device for.
  body.setPointerCapture = () => {};
  try {
    pointer('pointerdown', from, item.ownerDocument.elementFromPoint(from.x, from.y) ?? item);
    await pause(HOLD_BEFORE_MOVE_MS);
    for (let step = 1; step <= MOVE_STEPS; step++) {
      const at = {
        x: from.x + ((to.x - from.x) * step) / MOVE_STEPS,
        y: from.y + ((to.y - from.y) * step) / MOVE_STEPS,
      };
      setTimeout(() => pointer('pointermove', at, body), step * MOVE_STEP_MS);
    }
    await pause(MOVE_STEPS * MOVE_STEP_MS + SETTLE_BEFORE_RELEASE_MS);
    pointer('pointerup', to, body);
  } finally {
    // The own property shadows the prototype's method: dropping it restores the browser's.
    Reflect.deleteProperty(body, 'setPointerCapture');
  }
}

/** The blocks of one kind on the canvas: `hero` is the one the stories here add, `services` one a page starts with. */
function blocksOnCanvas(canvas: Document, block: 'hero' | 'services'): NodeListOf<Element> {
  return canvas.querySelectorAll(`[data-testid="block-${block}"]`);
}

/** Waits for the canvas to show exactly `count` heroes. */
async function waitForHeroes(canvas: Document, count: number): Promise<void> {
  await waitFor(() => expect(blocksOnCanvas(canvas, 'hero')).toHaveLength(count), { timeout: 5_000 });
}

/**
 * Presses Puck's header Undo or Redo (labelled `undo` and `redo`) once it is enabled. Puck records an edit in its
 * history 250 ms after it is made, so Undo only enables after that, as it does for an author.
 */
async function pressHistoryButton(canvasElement: HTMLElement, label: 'undo' | 'redo'): Promise<void> {
  const button = await waitFor(
    async () => {
      const found = within(canvasElement).getByRole('button', { name: label });
      await expect(found).toBeEnabled();
      return found;
    },
    { timeout: 5_000 },
  );
  await userEvent.click(button);
}

/** How far down a block a drop falls, as a fraction of its height: in the lower half, where Puck inserts after it. */
const DROP_DEPTH_IN_BLOCK = 0.9;

/** The screen point just below the lower half of the block the page already has. */
async function pointBelowTheExistingBlock(canvasElement: HTMLElement): Promise<Point> {
  const canvas = await canvasDocument(canvasElement);
  const existing = await waitFor(
    () => {
      const found = blocksOnCanvas(canvas, 'services')[0];
      if (!found) throw new Error('the existing block has not rendered yet');
      return found;
    },
    { timeout: 10_000 },
  );
  const box = existing.getBoundingClientRect();
  const frame = canvasFrame(canvasElement);
  const frameBox = frame.getBoundingClientRect();
  const scale = frameBox.width / frame.offsetWidth;
  return {
    x: frameBox.x + (box.x + box.width / 2) * scale,
    y: frameBox.y + (box.y + box.height * DROP_DEPTH_IN_BLOCK) * scale,
  };
}

/** A page with no blocks yet takes a block dragged from the list onto its canvas. */
export const DraggingABlockOntoAnEmptyPage: Story = {
  name: 'dragging a block from the list onto an empty page adds it',
  render: () => <PageEditorHarness entry={pageWith([])} config={SITE_CONFIG} onOpenMetadata={() => {}} />,
  play: async ({ canvasElement }) => {
    const canvas = await canvasDocument(canvasElement);
    const frame = canvasFrame(canvasElement);

    await dragTo(drawerItem(canvasElement, 'Hero'), centreOf(frame));

    await waitFor(() => expect(canvas.querySelectorAll('[data-testid="block-hero"]')).toHaveLength(1), {
      timeout: 5_000,
    });
  },
};

/** A page that already has a block takes another one dragged onto it. */
export const DraggingABlockOntoAPageWithBlocks: Story = {
  name: 'dragging a block from the list onto a page that has blocks adds it',
  render: () => (
    <PageEditorHarness
      entry={pageWith([{ type: 'Services', props: { id: 'Services-existing' } }])}
      config={SITE_CONFIG}
      onOpenMetadata={() => {}}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = await canvasDocument(canvasElement);
    const to = await pointBelowTheExistingBlock(canvasElement);

    await dragTo(drawerItem(canvasElement, 'Hero'), to);

    await waitForHeroes(canvas, 1);
    await expect(blocksOnCanvas(canvas, 'services')).toHaveLength(1);
  },
};

/** Undo takes a block dragged onto an empty page off it again, and Redo puts it back. */
export const UndoingABlockDraggedOntoAnEmptyPage: Story = {
  name: 'undo removes a block dragged onto an empty page and redo brings it back',
  render: () => <PageEditorHarness entry={pageWith([])} config={SITE_CONFIG} onOpenMetadata={() => {}} />,
  play: async ({ canvasElement }) => {
    const canvas = await canvasDocument(canvasElement);

    await dragTo(drawerItem(canvasElement, 'Hero'), centreOf(canvasFrame(canvasElement)));
    await waitForHeroes(canvas, 1);

    await pressHistoryButton(canvasElement, 'undo');
    await waitForHeroes(canvas, 0);

    await pressHistoryButton(canvasElement, 'redo');
    await waitForHeroes(canvas, 1);
  },
};

/** The same holds for a block added by double-clicking it in the list. */
export const UndoingADoubleClickedBlockOnAnEmptyPage: Story = {
  name: 'undo removes a block added by double-click and redo brings it back',
  render: () => <PageEditorHarness entry={pageWith([])} config={SITE_CONFIG} onOpenMetadata={() => {}} />,
  play: async ({ canvasElement }) => {
    const canvas = await canvasDocument(canvasElement);

    await userEvent.dblClick(drawerItem(canvasElement, 'Hero'));
    await waitForHeroes(canvas, 1);

    await pressHistoryButton(canvasElement, 'undo');
    await waitForHeroes(canvas, 0);

    await pressHistoryButton(canvasElement, 'redo');
    await waitForHeroes(canvas, 1);
  },
};

/** Undo takes back only the block that was dragged in: the one the page had when it was opened stays. */
export const UndoingABlockDraggedOntoAPageWithBlocks: Story = {
  name: 'undo removes only the block dragged onto a page that has blocks, and redo brings it back',
  render: () => (
    <PageEditorHarness
      entry={pageWith([{ type: 'Services', props: { id: 'Services-existing' } }])}
      config={SITE_CONFIG}
      onOpenMetadata={() => {}}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = await canvasDocument(canvasElement);
    const to = await pointBelowTheExistingBlock(canvasElement);

    await dragTo(drawerItem(canvasElement, 'Hero'), to);
    await waitForHeroes(canvas, 1);

    await pressHistoryButton(canvasElement, 'undo');
    await waitForHeroes(canvas, 0);
    await expect(blocksOnCanvas(canvas, 'services')).toHaveLength(1);

    await pressHistoryButton(canvasElement, 'redo');
    await waitForHeroes(canvas, 1);
    await expect(blocksOnCanvas(canvas, 'services')).toHaveLength(1);
  },
};

/** An empty page tells the author what to do: drag a block in, or double-click one in the list. */
export const AnEmptyPageSaysHowToAddABlock: Story = {
  name: 'an empty page tells the author how to add a block, and stops once it has one',
  render: () => <PageEditorHarness entry={pageWith([])} config={SITE_CONFIG} onOpenMetadata={() => {}} />,
  play: async ({ canvasElement }) => {
    const canvas = await canvasDocument(canvasElement);
    const view = canvas.defaultView;
    if (!view) throw new Error('the canvas document has no window');
    const rootZone = () => {
      const zone = canvas.querySelector(`[data-puck-dropzone="${PUCK_ROOT_DROP_ZONE}"]`);
      if (!zone) throw new Error('the canvas has no root drop area');
      return zone;
    };

    await waitFor(() => expect(view.getComputedStyle(rootZone(), '::before').content).toMatch(/drag a block here/i), {
      timeout: 5_000,
    });
    await expect(view.getComputedStyle(rootZone(), '::before').content).toMatch(/double-click/i);

    drawerItem(canvasElement, 'Hero').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await waitFor(() => expect(canvas.querySelectorAll('[data-testid="block-hero"]')).toHaveLength(1), {
      timeout: 5_000,
    });
    await expect(view.getComputedStyle(rootZone(), '::before').content).not.toMatch(/drag a block here/i);
  },
};

/** The hint's text, or `none` when the root drop area shows no hint, once the editor's rules are on the canvas. */
async function hintOnEmptyPage(canvasElement: HTMLElement): Promise<string> {
  const canvas = await canvasDocument(canvasElement);
  const view = canvas.defaultView;
  if (!view) throw new Error('the canvas document has no window');
  await waitFor(() => expect(canvas.querySelector('style[data-conloca-empty-drop-area]')).not.toBeNull(), {
    timeout: 5_000,
  });
  const zone = await waitFor(
    () => {
      const found = canvas.querySelector(`[data-puck-dropzone="${PUCK_ROOT_DROP_ZONE}"]`);
      if (!found) throw new Error('the canvas has no root drop area');
      return found;
    },
    { timeout: 5_000 },
  );
  // The editor decides whether to show the hint after Puck's first renders; give that time to settle.
  await pause(SETTLE_BEFORE_RELEASE_MS);
  return view.getComputedStyle(zone, '::before').content;
}

/** A page where no block may be inserted cannot be added to either way the hint names. */
export const AnEmptyPageWhereNoBlockCanBeAddedShowsNoHint: Story = {
  name: 'an empty page where no block may be inserted shows no hint',
  render: () => (
    <PageEditorHarness
      entry={pageWith([])}
      config={{
        ...SITE_CONFIG,
        components: {
          Hero: { fields: {}, permissions: { insert: false }, render: () => <section>Hero</section> },
          Services: { fields: {}, permissions: { insert: false }, render: () => <section>Services</section> },
        },
      }}
      onOpenMetadata={() => {}}
    />
  ),
  play: async ({ canvasElement }) => {
    await expect(await hintOnEmptyPage(canvasElement)).toBe('none');
  },
};

/** A site that registers no blocks has nothing to drag or double-click. */
export const AnEmptyPageWithoutBlocksShowsNoHint: Story = {
  name: 'an empty page of a site with no blocks shows no hint',
  render: () => (
    <PageEditorHarness
      entry={pageWith([])}
      config={{ root: SITE_CONFIG.root, components: {} }}
      onOpenMetadata={() => {}}
    />
  ),
  play: async ({ canvasElement }) => {
    await expect(await hintOnEmptyPage(canvasElement)).toBe('none');
  },
};

/** Interactive preview renders the published page, so the editing hint has no place in it. */
export const AnEmptyPageInInteractivePreviewShowsNoHint: Story = {
  name: 'an empty page in interactive preview shows no hint',
  render: () => <PageEditorHarness entry={pageWith([])} config={SITE_CONFIG} onOpenMetadata={() => {}} />,
  play: async ({ canvasElement }) => {
    const canvas = await canvasDocument(canvasElement);
    const view = canvas.defaultView;
    if (!view) throw new Error('the canvas document has no window');
    const entry = () => canvas.querySelector('[data-puck-entry]');
    // Guards the check below: the hint is there in edit mode, so its absence in the preview is the mode's doing.
    await waitFor(
      async () => {
        const zone = canvas.querySelector(`[data-puck-dropzone="${PUCK_ROOT_DROP_ZONE}"]`);
        await expect(zone ? view.getComputedStyle(zone, '::before').content : 'none').toMatch(/drag a block here/i);
      },
      { timeout: 5_000 },
    );

    await userEvent.keyboard('{Control>}i{/Control}');
    try {
      await waitFor(() => expect(entry()?.getAttribute('data-puck-preview-mode')).toBe('interactive'));
      const zone = canvas.querySelector(`[data-puck-dropzone="${PUCK_ROOT_DROP_ZONE}"]`);
      await expect(zone ? view.getComputedStyle(zone, '::before').content : 'none').toBe('none');
    } finally {
      await userEvent.keyboard('{Control>}i{/Control}');
      await waitFor(() => expect(entry()?.getAttribute('data-puck-preview-mode')).toBe('edit'));
    }
  },
};
