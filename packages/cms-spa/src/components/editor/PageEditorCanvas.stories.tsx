import type { LocalizedEntry } from '@conloca/content-api-client';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { type ComponentProps, useEffect, useState } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { expect, waitFor } from 'storybook/test';
import '../../main.css';
import { getSiteStyles, setSiteStyles } from '../../site-styles.js';
import { IframeBridge, PageEditor } from './PageEditor.js';

/**
 * What the page editor's preview canvas looks like.
 *
 * The canvas opts out of Puck's host-style mirror, so the admin stylesheet
 * never reaches it: the only CSS in that iframe is Puck's own plus what
 * `IframeBridge` injects.
 *
 * The site's own font: `IframeBridge` injects the site CSS it is given inside
 * one `conloca-site` cascade layer, and Puck's font token lives in
 * `@layer puck-tokens`. Nothing unlayered may set a font there: an unlayered
 * rule beats every layered one, so it would override whatever font the site
 * sets and show the editor's font on the site's page.
 *
 * Empty drop areas: Puck tints them with its selection colour, which on a new
 * page fills the whole canvas. The editor's rule against that has to reach the
 * canvas without the admin stylesheet.
 *
 * This lives in the browser target because happy-dom ignores layered rules and
 * does not resolve custom properties through Puck's rules, so a bun test could
 * not tell either result from its failure.
 */

/** Puck's canvas token shape: the editor font, declared in a layer. */
const PUCK_TOKEN_CSS = '@layer puck-tokens{:root{--puck-font-family:Inter,sans-serif}}';

const CANVAS_SRCDOC = '<!doctype html><html><head></head><body><p>x</p></body></html>';

/** Mounts the bridge on a bare canvas iframe that carries Puck's font token. */
function CanvasHarness({ siteCss }: { siteCss: string }) {
  const [canvasDoc, setCanvasDoc] = useState<Document>();

  useEffect(() => {
    setSiteStyles([siteCss]);
    return () => setSiteStyles([]);
  }, [siteCss]);

  return (
    <>
      <iframe
        title="Preview canvas"
        srcDoc={CANVAS_SRCDOC}
        onLoad={(event) => {
          const doc = event.currentTarget.contentDocument;
          if (!doc) throw new Error('canvas iframe has no document');
          const token = doc.createElement('style');
          token.textContent = PUCK_TOKEN_CSS;
          doc.head.prepend(token);
          setCanvasDoc(doc);
        }}
      />
      <IframeBridge document={canvasDoc}>{null}</IframeBridge>
    </>
  );
}

/** Waits for the canvas body to render in `font`, then checks the bridge added exactly one tag per stylesheet. */
async function expectCanvasBodyFont(canvasElement: HTMLElement, font: string): Promise<void> {
  const frame = canvasElement.querySelector('iframe');
  if (!frame) throw new Error('canvas iframe never rendered');
  await waitFor(
    () => {
      const body = frame.contentDocument?.body;
      if (!body) throw new Error('canvas iframe has not loaded');
      expect(getComputedStyle(body).fontFamily).toBe(font);
    },
    { timeout: 5000 },
  );
  const injected = frame.contentDocument?.head.querySelectorAll('style[data-conloca-site-styles]') ?? [];
  expect(injected.length).toBe(getSiteStyles().length);
}

const meta = {
  title: 'Editor/PageEditorCanvas',
  parameters: { layout: 'fullscreen' },
  // The page editor harness is shared with other stories files; it is not a story itself.
  excludeStories: ['PageEditorHarness'],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** A site that sets its body font inside a cascade layer sees that font on the canvas. */
export const SiteFontSetInALayerWinsOnTheCanvasBody: Story = {
  render: () => <CanvasHarness siteCss="@layer base{body{font-family:Georgia}}" />,
  play: async ({ canvasElement }) => {
    await expectCanvasBodyFont(canvasElement, 'Georgia');
  },
};

/**
 * A font set on `html` alone reaches the canvas body by inheritance. This is
 * the shape Tailwind v4's preflight uses, so any rule that sets the body font
 * directly would break every Tailwind site.
 */
export const AFontSetOnHtmlAloneReachesTheBody: Story = {
  render: () => <CanvasHarness siteCss="@layer base{html{font-family:Georgia}}" />,
  play: async ({ canvasElement }) => {
    await expectCanvasBodyFont(canvasElement, 'Georgia');
  },
};

/** A page with no blocks yet: the editor shows only its empty root drop area. */
const NEW_PAGE: LocalizedEntry = {
  id: 'new-page',
  type: 'puck',
  kind: 'page',
  site: 'default',
  collection: 'pages',
  localized: {
    locale: 'en',
    pathname: '/new-page',
    etag: 'meta.content',
    created: '2026-09-23T00:00:00.000Z',
    modified: '2026-09-23T00:00:00.000Z',
    meta: { title: 'New page' },
    content: { puckData: { content: [], root: { props: {} } } },
  },
};

/**
 * Mounts the real page editor on `entry`. Its unsaved-changes guard needs a data router, and the router keeps the
 * element it was created with, so the editor only ever sees the first props.
 */
export function PageEditorHarness({
  entry,
  config,
  onOpenMetadata,
}: Pick<ComponentProps<typeof PageEditor>, 'entry' | 'config' | 'onOpenMetadata'>) {
  const [router] = useState(() =>
    createMemoryRouter([
      {
        path: '/',
        element: (
          <PageEditor
            entry={entry}
            config={config}
            availableLocales={['en']}
            onSave={async () => ({ success: true })}
            onBack={() => {}}
            onOpenMetadata={onOpenMetadata}
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

/**
 * On a new page the empty root drop area fills the canvas, so Puck's selection
 * tint there reads as a blue page. It must stay clear, keeping only a grey
 * dashed outline as the cue to drop a block.
 */
export const EmptyDropAreaOnANewPage: Story = {
  name: 'an empty drop area on a new page is clear with a grey dashed outline',
  render: () => <PageEditorHarness entry={NEW_PAGE} config={{ components: {} }} onOpenMetadata={() => {}} />,
  play: async ({ canvasElement }) => {
    const zone = await waitFor(
      () => {
        const found = canvasElement
          .querySelector<HTMLIFrameElement>('iframe#preview-frame')
          ?.contentDocument?.querySelector('[data-puck-dropzone]');
        if (!found) throw new Error('the canvas has not rendered its root drop area yet');
        return found;
      },
      { timeout: 10_000 },
    );
    expect(zone.matches(':empty')).toBe(true);
    const view = zone.ownerDocument.defaultView;
    if (!view) throw new Error('the canvas document has no window');
    await waitFor(
      () => {
        const style = view.getComputedStyle(zone);
        expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)');
        // Puck 0.23's grey-07 (#ababab), resolved from Puck's tokens inside the canvas.
        expect(style.outlineColor).toBe('rgb(171, 171, 171)');
        expect(style.outlineStyle).toBe('dashed');
      },
      { timeout: 5_000 },
    );
  },
};
