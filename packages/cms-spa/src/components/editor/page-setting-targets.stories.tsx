import type { LocalizedEntry } from '@conloca/content-api-client';
import type { Config } from '@puckeditor/core';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import '../../main.css';
import { pageSettingAttributes } from '../../page-setting-attributes.js';
import { PageEditorHarness } from './PageEditorCanvas.stories.js';
import { PageSettingTargetsProvider } from './page-setting-targets.js';

/**
 * A part of a block that shows one of the page's settings, on the page
 * editor's canvas: clicking it opens Page settings at that field.
 *
 * This lives in the browser target because the behaviour is Puck's canvas
 * itself (its pointer-events rule on block contents, its overlay portals and
 * its click handling), which the bun lane replaces with a mock.
 */

/** A block that prints the page's title as a heading, marked as the `title` setting, above text of its own. */
const PROBE_CONFIG: Config = {
  components: {
    Probe: {
      render: ({ puck }) => (
        <section>
          <h1 {...pageSettingAttributes(puck, 'title')}>From settings</h1>
          <p>Block text</p>
        </section>
      ),
    },
  },
};

const PROBE_PAGE: LocalizedEntry = {
  id: 'probe',
  type: 'puck',
  kind: 'page',
  site: 'default',
  collection: 'pages',
  localized: {
    locale: 'en',
    pathname: '/probe',
    etag: 'meta.content',
    created: '2026-09-24T00:00:00.000Z',
    modified: '2026-09-24T00:00:00.000Z',
    meta: { title: 'From settings' },
    content: { puckData: { content: [{ type: 'Probe', props: { id: 'Probe-1' } }], root: { props: {} } } },
  },
};

const openPageSettings = fn<(field?: string) => void>();

/** The canvas document, once Puck's preview iframe has one. */
function canvasDocument(canvasElement: HTMLElement): Document {
  const frameDoc = canvasElement.querySelector<HTMLIFrameElement>('iframe#preview-frame')?.contentDocument;
  if (!frameDoc) throw new Error('the canvas iframe has not loaded');
  return frameDoc;
}

/** Clicks whatever the canvas puts under the centre of `element`, as a pointer would hit it. */
function clickCentreOf(element: Element): Element {
  const box = element.getBoundingClientRect();
  const hit = element.ownerDocument.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  if (!hit) throw new Error('nothing on the canvas is under that point');
  (hit as HTMLElement).click();
  return hit;
}

/** Presses Puck's preview-mode hotkey and waits for the canvas to show `mode`. */
async function togglePreviewMode(canvasElement: HTMLElement, mode: 'edit' | 'interactive'): Promise<void> {
  await userEvent.keyboard('{Control>}i{/Control}');
  await waitFor(() =>
    expect(
      canvasDocument(canvasElement).querySelector('[data-puck-entry]')?.getAttribute('data-puck-preview-mode'),
    ).toBe(mode),
  );
}

const HINT = /come from Page settings/;

/**
 * Waits long enough for a click's change of selection to reach the sidebar, which takes a few renders. Used to
 * check that a selection did not change; a slower change would let the check pass, never fail it.
 */
const afterASelectionChange = () => new Promise((resolve) => setTimeout(resolve, 250));

const meta = {
  title: 'Editor/PageSettingTargets',
  component: PageSettingTargetsProvider,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof PageSettingTargetsProvider>;

export default meta;
// No args: the story renders its own harness.
type Story = StoryObj;

export const APageSettingOnTheCanvasOpensPageSettingsAtItsField: Story = {
  name: 'a part of a block marked as a page setting opens Page settings at that field, and only in edit mode',
  render: () => <PageEditorHarness entry={PROBE_PAGE} config={PROBE_CONFIG} onOpenMetadata={openPageSettings} />,
  play: async ({ canvasElement }) => {
    openPageSettings.mockClear();
    const title = await waitFor(
      () => {
        const found = canvasDocument(canvasElement).querySelector('[data-conloca-page-setting="title"]');
        if (!found) throw new Error('the canvas has not rendered the marked title yet');
        return found;
      },
      { timeout: 10_000 },
    );
    const view = title.ownerDocument.defaultView;
    if (!view) throw new Error('the canvas document has no window');

    // Puck makes everything inside a block ignore the pointer; the marked title must take it.
    await waitFor(() => {
      const style = view.getComputedStyle(title);
      expect(style.pointerEvents).toBe('auto');
      expect(style.cursor).toBe('pointer');
    });

    // Text the block owns selects the block, and its sidebar says where the rest comes from.
    expect(within(canvasElement).queryByText(HINT)).toBeNull();
    const text = canvasDocument(canvasElement).querySelector('[data-puck-component="Probe-1"] p');
    if (!text) throw new Error('the block text is missing');
    clickCentreOf(text);
    expect(await within(canvasElement).findAllByText(HINT)).not.toHaveLength(0);
    expect(openPageSettings).not.toHaveBeenCalled();

    // The marked title opens Page settings at its field, and the block stays selected.
    expect(title.contains(clickCentreOf(title))).toBe(true);
    expect(openPageSettings).toHaveBeenCalledTimes(1);
    expect(openPageSettings).toHaveBeenCalledWith('title');
    await afterASelectionChange();
    expect(within(canvasElement).queryAllByText(HINT)).not.toHaveLength(0);

    // Interactive preview renders the published page: nothing is marked and a click opens nothing.
    await togglePreviewMode(canvasElement, 'interactive');
    try {
      await waitFor(() =>
        expect(canvasDocument(canvasElement).querySelector('[data-conloca-page-setting]')).toBeNull(),
      );
      const heading = canvasDocument(canvasElement).querySelector('h1');
      if (!heading) throw new Error('the interactive preview shows no heading');
      (heading as HTMLElement).click();
      expect(openPageSettings).toHaveBeenCalledTimes(1);
    } finally {
      await togglePreviewMode(canvasElement, 'edit');
    }
  },
};
