import type { DataContext, LocalizedEntry } from '@conloca/content-api-client';
import { type Config, type Data, Puck } from '@puckeditor/core';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { createContext, useContext, useState } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import '../../main.css';
import { PageEditor } from './PageEditor.js';
import { PuckWithUntouchedMetadata } from './PuckWithUntouchedMetadata.js';

/**
 * What a block on the page editor's canvas reads from `puck.metadata`: the
 * page data the editor was given, exactly as resolveData and the published
 * page read it. Dates stay Date objects, and page data named like one of the
 * block's own fields stays data.
 *
 * The canary stories render Puck itself, with nothing from the CMS in
 * between, and pin the two Puck bugs the editor works around.
 *
 * This lives in the browser target because the bugs live in Puck's canvas
 * render, which the bun lane replaces with a mock.
 */

const PUBLISHED = new Date('2026-09-01T10:00:00.000Z');
const MOVED = new Date('2027-02-03T04:05:06.000Z');

/** The page data blocks read on the canvas; the page's title sits under `page`, next to a block field of the same name. */
const PROBE_CONTEXT: DataContext = {
  page: {
    id: 'probe',
    pathname: '/blog/probe',
    title: 'Probe page',
    collection: 'pages',
    meta: { title: 'Probe page' },
    timestamps: { created: PUBLISHED },
  },
  collections: {},
  locale: 'en',
  siteName: 'default',
};

const MOVED_CONTEXT: DataContext = {
  ...PROBE_CONTEXT,
  page: { ...PROBE_CONTEXT.page, timestamps: { created: MOVED } },
};

/** A block that prints what it read from `puck.metadata`; it has a `title` field of its own, edited in place. */
const PROBE_CONFIG: Config = {
  components: {
    Probe: {
      fields: { title: { type: 'text', contentEditable: true } },
      defaultProps: { title: 'Block title' },
      metadata: { siteName: 'block site' },
      render: ({ title, puck }) => {
        const { page, siteName } = puck.metadata as DataContext;
        const created = page.timestamps?.created;
        return (
          <section>
            <h2 data-probe="block-title">{title}</h2>
            {/* A real block calls toISOString() outright; the guard prints what arrived instead of crashing the canvas. */}
            <time data-probe="created">
              {created instanceof Date ? created.toISOString() : `not a Date: ${JSON.stringify(created)}`}
            </time>
            <p data-probe="page-title">{page.title}</p>
            <p data-probe="page-title-kind">{typeof page.title}</p>
            <p data-probe="site">{siteName}</p>
          </section>
        );
      },
    },
    Section: {
      fields: { items: { type: 'slot' } },
      render: ({ items: Items }) => (
        <div>
          <Items />
        </div>
      ),
    },
  },
};

const PROBE_DATA: Data = {
  root: { props: {} },
  content: [
    { type: 'Probe', props: { id: 'Probe-1', title: 'Block title' } },
    {
      type: 'Section',
      props: { id: 'Section-1', items: [{ type: 'Probe', props: { id: 'Probe-2', title: 'Nested title' } }] },
    },
  ],
};

const PROBE_PAGE: LocalizedEntry = {
  id: 'probe',
  type: 'puck',
  kind: 'page',
  site: 'default',
  collection: 'pages',
  localized: {
    locale: 'en',
    pathname: '/blog/probe',
    etag: 'meta.content',
    created: '2026-09-01T10:00:00.000Z',
    modified: '2026-09-01T10:00:00.000Z',
    meta: { title: 'Probe page' },
    content: { puckData: PROBE_DATA },
  },
};

/** The router keeps the element it was created with, so the editor reads the current page data through this. */
const ProbeMetadata = createContext<DataContext>(PROBE_CONTEXT);

function RoutedProbeEditor() {
  const metadata = useContext(ProbeMetadata);
  return (
    <PageEditor
      entry={PROBE_PAGE}
      config={PROBE_CONFIG}
      metadata={metadata}
      availableLocales={['en']}
      onSave={async () => ({ success: true })}
      onBack={() => {}}
      onOpenMetadata={() => {}}
    />
  );
}

/** The real page editor on the probe page. The button stands in for a Page settings save; the unsaved-changes guard needs a data router. */
function ProbePageEditor() {
  const [metadata, setMetadata] = useState(PROBE_CONTEXT);
  const [router] = useState(() => createMemoryRouter([{ path: '/', element: <RoutedProbeEditor /> }]));
  return (
    <ProbeMetadata.Provider value={metadata}>
      <button type="button" onClick={() => setMetadata(MOVED_CONTEXT)}>
        Move the page's date
      </button>
      <div style={{ height: '800px' }}>
        <RouterProvider router={router} />
      </div>
    </ProbeMetadata.Provider>
  );
}

/** Puck with nothing from cms-spa in between. */
function BarePuck() {
  return (
    <div style={{ height: '800px' }}>
      <Puck config={PROBE_CONFIG} data={PROBE_DATA} metadata={PROBE_CONTEXT} />
    </div>
  );
}

/** Waits for one probe line of a block to render on the canvas, and returns it. */
async function canvasPart(canvasElement: HTMLElement, blockId: string, part: string): Promise<Element> {
  return waitFor(
    () => {
      const found = canvasElement
        .querySelector<HTMLIFrameElement>('iframe#preview-frame')
        ?.contentDocument?.querySelector(`[data-puck-component="${blockId}"] [data-probe="${part}"]`);
      if (!found) throw new Error(`the canvas has not rendered ${part} of ${blockId} yet`);
      return found;
    },
    { timeout: 10_000 },
  );
}

const meta = {
  title: 'Editor/PuckWithUntouchedMetadata',
  component: PuckWithUntouchedMetadata,
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
// No args: every story renders its own harness.
type Story = StoryObj;

export const BlocksGetThePagesDatesOnTheCanvas: Story = {
  name: "blocks on the canvas get the page's dates as Date objects, and a changed date reaches them",
  render: () => <ProbePageEditor />,
  play: async ({ canvasElement }) => {
    const created = [
      await canvasPart(canvasElement, 'Probe-1', 'created'),
      await canvasPart(canvasElement, 'Probe-2', 'created'),
    ];
    for (const date of created) await waitFor(() => expect(date.textContent).toBe(PUBLISHED.toISOString()));

    await userEvent.click(within(canvasElement).getByRole('button', { name: "Move the page's date" }));

    // The elements found before the change: a block that remounted on it would leave them detached.
    for (const date of created) {
      await waitFor(() => expect(date.textContent).toBe(MOVED.toISOString()), { timeout: 5_000 });
    }
  },
};

export const PageDataNamedLikeABlockFieldStaysData: Story = {
  name: "page data named like one of a block's fields reaches the block as data; only the block's own field is edited in place",
  render: () => <ProbePageEditor />,
  play: async ({ canvasElement }) => {
    for (const [blockId, ownTitle] of [
      ['Probe-1', 'Block title'],
      ['Probe-2', 'Nested title'],
    ]) {
      expect((await canvasPart(canvasElement, blockId, 'page-title-kind')).textContent).toBe('string');
      expect((await canvasPart(canvasElement, blockId, 'page-title')).textContent).toBe('Probe page');
      const blockTitle = await canvasPart(canvasElement, blockId, 'block-title');
      await waitFor(() => expect(blockTitle.querySelector('[data-puck-overlay-portal]')?.textContent).toBe(ownTitle), {
        timeout: 5_000,
      });
      expect((await canvasPart(canvasElement, blockId, 'site')).textContent).toBe('block site');
    }
    const nested = await canvasPart(canvasElement, 'Probe-2', 'created');
    expect(nested.closest('[data-puck-component="Section-1"] [data-puck-dropzone]')).not.toBeNull();
  },
};

export const PuckStillHandsBlocksNoDateFromMetadata: Story = {
  name: 'canary: Puck itself still hands a block no Date for a Date in metadata (puckeditor/puck#1326); when this fails, read the note in PuckWithUntouchedMetadata.tsx',
  render: () => <BarePuck />,
  play: async ({ canvasElement }) => {
    expect((await canvasPart(canvasElement, 'Probe-1', 'created')).textContent).toMatch(/^not a Date/);
  },
};

export const PuckStillTransformsBlockMetadataNamedLikeAField: Story = {
  name: 'canary: Puck itself still hands a block page data named like one of its fields as something other than that data (puckeditor/puck#1560); when this fails, read the note in PuckWithUntouchedMetadata.tsx',
  render: () => <BarePuck />,
  play: async ({ canvasElement }) => {
    expect((await canvasPart(canvasElement, 'Probe-1', 'page-title-kind')).textContent).not.toBe('string');
  },
};

export const HandsBlocksTheMetadataAsGiven: Story = {
  name: "PuckWithUntouchedMetadata hands a block the page's Date and title as given",
  render: () => (
    <div style={{ height: '800px' }}>
      <PuckWithUntouchedMetadata config={PROBE_CONFIG} data={PROBE_DATA} metadata={PROBE_CONTEXT} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    expect((await canvasPart(canvasElement, 'Probe-1', 'created')).textContent).toBe(PUBLISHED.toISOString());
    expect((await canvasPart(canvasElement, 'Probe-1', 'page-title-kind')).textContent).toBe('string');
  },
};
