import type { LocalizedEntry } from '@conloca/content-api-client';
import { type PuckApi, useGetPuck } from '@puckeditor/core';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { type ComponentProps, type ReactNode, useEffect, useState } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { expect, waitFor, within } from 'storybook/test';
import '../../main.css';
import { isOpenEditorDirty } from '../../editor-flush.js';
import { CanvasThemeProvider } from '../../hooks/useCanvasTheme.js';
import { setSiteRender } from '../../site-render.js';
import { getSiteStyles, setSiteStyles } from '../../site-styles.js';
import { configureUI, getUIConfig } from '../../ui-config.js';
import { PUCK_ROOT_DROP_ZONE } from './DrawerItemOverride.js';
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

/** A page with blocks, as the page editor wrapper hands it over: default props merged in and resolved once. */
const PAGE_WITH_BLOCKS: LocalizedEntry = {
  ...NEW_PAGE,
  id: 'page-with-blocks',
  localized: {
    ...NEW_PAGE.localized,
    pathname: '/page-with-blocks',
    meta: { title: 'Page with blocks' },
    content: {
      puckData: {
        root: { props: { title: 'Page with blocks' } },
        content: [
          { type: 'Heading', props: { id: 'Heading-1', text: 'Hello', level: 2 } },
          { type: 'Resolved', props: { id: 'Resolved-1', label: 'Stored' } },
        ],
      },
    },
  },
};

const PAGE_WITH_BLOCKS_CONFIG: ComponentProps<typeof PageEditor>['config'] = {
  root: { fields: { title: { type: 'text' } } },
  components: {
    Heading: {
      fields: { text: { type: 'text' }, level: { type: 'number' } },
      defaultProps: { text: 'Heading', level: 2 },
      render: ({ text }) => <h2>{text}</h2>,
    },
    // Puck runs every resolveData on load; one that answers the props it was given changes nothing.
    Resolved: {
      fields: { label: { type: 'text' } },
      resolveData: async ({ props }) => ({ props }),
      render: ({ label }) => <p>{label}</p>,
    },
  },
};

/**
 * Opening a page is not an edit: the editor's Save stays off and the host reads it clean, so the host's status pill
 * says Saved rather than Unsaved changes on open.
 */
export const OpeningAPageIsNotAnEdit: Story = {
  name: 'opening a page with blocks leaves it clean',
  render: () => (
    <PageEditorHarness entry={PAGE_WITH_BLOCKS} config={PAGE_WITH_BLOCKS_CONFIG} onOpenMetadata={() => {}} />
  ),
  play: async ({ canvasElement }) => {
    await waitFor(
      () => {
        const text =
          canvasElement.querySelector<HTMLIFrameElement>('iframe#preview-frame')?.contentDocument?.body.textContent;
        if (!text?.includes('Hello') || !text.includes('Stored')) throw new Error('the canvas has not rendered yet');
      },
      { timeout: 10_000 },
    );
    // Puck's load-time resolve and any change it reports settle within a few frames; give them time to land.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await expect(isOpenEditorDirty()).toBe(false);
    await expect(within(canvasElement).getByRole('button', { name: 'Save' })).toBeDisabled();
  },
};

/** The routing entries and site frame the editor frame story serves its `blog` page with. */
const BLOG_ENTRY: LocalizedEntry = {
  ...NEW_PAGE,
  id: 'blog-post',
  collection: 'blog',
  localized: { ...NEW_PAGE.localized, pathname: '/blog/a', meta: { title: 'A post' } },
};

/** Puck's API, handed over by the root field below so the play function can dispatch an insert. */
let framedGetPuck: (() => PuckApi) | undefined;

function GetPuckField() {
  const getPuck = useGetPuck();
  useEffect(() => {
    framedGetPuck = getPuck;
  }, [getPuck]);
  return <></>;
}

const BLOG_CONFIG: ComponentProps<typeof PageEditor>['config'] = {
  root: { fields: { api: { type: 'custom', render: GetPuckField } } },
  components: {
    Note: { fields: {}, render: () => <p data-testid="block-note">Note</p> },
  },
};

/**
 * A page whose routing entry declares an editor frame shows inside it on the canvas, around the page-root marker the
 * published page carries; blocks still drop into it, and the site font and the insert marker still apply.
 */
export const EditorFrameWrapsTheCanvas: Story = {
  name: "a page shows inside its routing entry's editor frame on the canvas",
  beforeEach: () => {
    framedGetPuck = undefined;
    setSiteStyles(['@layer base{body{font-family:Georgia}}']);
    setSiteRender({
      frames: { blog: ({ children }: { children: ReactNode }) => <div className="page-shell">{children}</div> },
    });
    // The UI config is module state shared across stories, so put back whatever was installed.
    const previous = getUIConfig();
    configureUI({
      ...previous,
      dataBindings: {
        siteName: 'default',
        locale: 'en',
        routes: {},
        entries: [{ name: 'blog', collection: 'blog', frame: 'blog' }],
      },
    });
    return () => {
      setSiteStyles([]);
      setSiteRender({});
      configureUI(previous);
    };
  },
  render: () => <PageEditorHarness entry={BLOG_ENTRY} config={BLOG_CONFIG} onOpenMetadata={() => {}} />,
  play: async ({ canvasElement }) => {
    const canvas = await waitFor(
      () => {
        const doc = canvasElement.querySelector<HTMLIFrameElement>('iframe#preview-frame')?.contentDocument;
        if (!doc?.querySelector('[data-puck-dropzone]')) throw new Error('the canvas has not rendered yet');
        return doc;
      },
      { timeout: 10_000 },
    );
    await expect(canvas.querySelector('.page-shell [data-conloca-page-root] [data-puck-dropzone]')).not.toBeNull();

    const getPuck = await waitFor(
      () => {
        if (!framedGetPuck) throw new Error('the root field has not handed over the Puck API yet');
        return framedGetPuck;
      },
      { timeout: 5_000 },
    );
    getPuck().dispatch({
      type: 'insert',
      componentType: 'Note',
      destinationZone: PUCK_ROOT_DROP_ZONE,
      destinationIndex: 0,
    });
    await waitFor(
      () =>
        expect(canvas.querySelector('.page-shell [data-conloca-page-root] [data-testid="block-note"]')).not.toBeNull(),
      { timeout: 5_000 },
    );

    const view = canvas.defaultView;
    if (!view) throw new Error('the canvas document has no window');
    await waitFor(() => expect(view.getComputedStyle(canvas.body).fontFamily).toBe('Georgia'), { timeout: 5_000 });
    await expect(canvas.documentElement.hasAttribute('data-conloca-can-insert')).toBe(true);
  },
};

/** The page editor reading the canvas theme the user picked. */
function ThemedPageEditor() {
  return (
    <CanvasThemeProvider>
      <PageEditorHarness entry={PAGE_WITH_BLOCKS} config={PAGE_WITH_BLOCKS_CONFIG} onOpenMetadata={() => {}} />
    </CanvasThemeProvider>
  );
}

/** The admin theme as theme.ts applies it, on the document root, with `canvasTheme` stored before the editor reads it. */
function adminWithCanvas(adminTheme: 'light' | 'dark', canvasTheme: 'light' | 'dark'): () => () => void {
  return () => {
    const root = document.documentElement;
    root.classList.toggle('dark', adminTheme === 'dark');
    root.style.colorScheme = adminTheme;
    localStorage.setItem('conloca-canvas-theme', canvasTheme);
    return () => {
      root.classList.remove('dark');
      root.style.colorScheme = '';
      localStorage.removeItem('conloca-canvas-theme');
    };
  };
}

/**
 * The surface behind the site's page (Puck's canvas root, which shows through a canvas document without its own
 * background) and the canvas document's colour scheme. Computed, so it holds whatever backdrop the browser paints.
 */
async function expectCanvasSurface(canvasElement: HTMLElement, background: string, colorScheme: string): Promise<void> {
  await waitFor(
    async () => {
      const frame = canvasElement.querySelector<HTMLIFrameElement>('iframe#preview-frame');
      const html = frame?.contentDocument?.documentElement;
      const root = frame?.closest('[class*="PuckCanvas-root"]');
      if (!html || !root) throw new Error('the canvas has not loaded yet');
      await expect(getComputedStyle(root).backgroundColor).toBe(background);
      await expect(getComputedStyle(html).colorScheme).toBe(colorScheme);
    },
    { timeout: 10_000 },
  );
}

/** The admin theme never reaches the site's page: a light canvas in a dark admin sits on white, not the admin's dark. */
export const LightCanvasInADarkAdmin: Story = {
  name: 'a light canvas in a dark admin sits on white',
  beforeEach: adminWithCanvas('dark', 'light'),
  render: () => <ThemedPageEditor />,
  play: ({ canvasElement }) => expectCanvasSurface(canvasElement, 'rgb(255, 255, 255)', 'light'),
};

/** Only the canvas toggle makes the surface behind the site dark. */
export const DarkCanvasInADarkAdmin: Story = {
  name: 'a dark canvas sits on the dark surface',
  beforeEach: adminWithCanvas('dark', 'dark'),
  render: () => <ThemedPageEditor />,
  play: ({ canvasElement }) => expectCanvasSurface(canvasElement, 'rgb(24, 24, 24)', 'dark'),
};

/** The canvas toggle alone decides the surface: a dark canvas in a light admin is dark too. */
export const DarkCanvasInALightAdmin: Story = {
  name: 'a dark canvas in a light admin sits on the dark surface',
  beforeEach: adminWithCanvas('light', 'dark'),
  render: () => <ThemedPageEditor />,
  play: ({ canvasElement }) => expectCanvasSurface(canvasElement, 'rgb(24, 24, 24)', 'dark'),
};

/** `adminWithCanvas` for a site whose stylesheet is `siteCss`. */
function siteInAdminWithCanvas(
  siteCss: string,
  adminTheme: 'light' | 'dark',
  canvasTheme: 'light' | 'dark',
): () => () => void {
  return () => {
    setSiteStyles([siteCss]);
    const restoreThemes = adminWithCanvas(adminTheme, canvasTheme)();
    return () => {
      restoreThemes();
      setSiteStyles([]);
    };
  };
}

/** The site's colours on the canvas: the page's paper and the ink of the blocks on it. */
async function expectSiteColors(
  canvasElement: HTMLElement,
  expected: { paper: string; heading: string; paragraph: string },
): Promise<void> {
  await waitFor(
    async () => {
      const doc = canvasElement.querySelector<HTMLIFrameElement>('iframe#preview-frame')?.contentDocument;
      const heading = doc?.querySelector('h2');
      const paragraph = doc?.querySelector('p');
      if (!doc || !heading || !paragraph) throw new Error('the canvas has not rendered the blocks yet');
      await expect({
        paper: getComputedStyle(doc.body).backgroundColor,
        heading: getComputedStyle(heading).color,
        paragraph: getComputedStyle(paragraph).color,
      }).toEqual(expected);
    },
    { timeout: 10_000 },
  );
}

/** A site with no dark mode, like conloca.com: its colours on `:root` and nothing else. */
const LIGHT_ONLY_SITE =
  ':root{color:rgb(28, 25, 23);background:rgb(255, 255, 255)}body{background:inherit}p{color:rgb(41, 37, 36)}';
const LIGHT_SITE_COLORS = { paper: 'rgb(255, 255, 255)', heading: 'rgb(28, 25, 23)', paragraph: 'rgb(41, 37, 36)' };

/** A site with a dark mode keyed off the `dark` class, Tailwind's convention. */
const DARK_CAPABLE_SITE = `${LIGHT_ONLY_SITE}:root.dark{color:rgb(250, 250, 249);background:rgb(12, 10, 9)}.dark p{color:rgb(214, 211, 209)}`;
const DARK_SITE_COLORS = { paper: 'rgb(12, 10, 9)', heading: 'rgb(250, 250, 249)', paragraph: 'rgb(214, 211, 209)' };

/** The admin's dark theme never reaches a light-only site: the canvas shows its published colours. */
export const LightOnlySiteInADarkAdmin: Story = {
  name: 'a light-only site in a dark admin shows its published colours',
  beforeEach: siteInAdminWithCanvas(LIGHT_ONLY_SITE, 'dark', 'light'),
  render: () => <ThemedPageEditor />,
  play: ({ canvasElement }) => expectSiteColors(canvasElement, LIGHT_SITE_COLORS),
};

/** A site with no dark mode has nothing to switch: a dark canvas still shows its published colours. */
export const LightOnlySiteOnADarkCanvas: Story = {
  name: 'a light-only site on a dark canvas shows its published colours',
  beforeEach: siteInAdminWithCanvas(LIGHT_ONLY_SITE, 'dark', 'dark'),
  render: () => <ThemedPageEditor />,
  play: ({ canvasElement }) => expectSiteColors(canvasElement, LIGHT_SITE_COLORS),
};

/** A site with a dark mode follows the canvas toggle, not the admin theme. */
export const DarkCapableSiteOnALightCanvasInADarkAdmin: Story = {
  name: 'a dark-capable site is light on a light canvas in a dark admin',
  beforeEach: siteInAdminWithCanvas(DARK_CAPABLE_SITE, 'dark', 'light'),
  render: () => <ThemedPageEditor />,
  play: ({ canvasElement }) => expectSiteColors(canvasElement, LIGHT_SITE_COLORS),
};

export const DarkCapableSiteOnADarkCanvas: Story = {
  name: 'a dark-capable site is dark on a dark canvas',
  beforeEach: siteInAdminWithCanvas(DARK_CAPABLE_SITE, 'dark', 'dark'),
  render: () => <ThemedPageEditor />,
  play: ({ canvasElement }) => expectSiteColors(canvasElement, DARK_SITE_COLORS),
};
