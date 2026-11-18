import { defineFragmentComponents } from '@conloca/mdx/render';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { expect, waitFor } from 'storybook/test';
import '../../main.css';
import { ThemeProvider, useTheme } from '../../hooks/useTheme.js';
import { type MdxComponents, setMdxComponents } from '../../mdx-components.js';
import { setSiteRender } from '../../site-render.js';
import { THEME_STORAGE_KEY } from '../../theme.js';
import { configureUI, getUIConfig } from '../../ui-config.js';
import { CMSMDXEditor } from './CMSMDXEditor.js';

/**
 * The fragment editor shows a fragment in the site's own colours, whatever theme the editor's chrome is in: a site
 * with no dark mode looks exactly like its published (light) page in a dark editor, and a site with a dark mode
 * follows the editor into it. Measured against the published page itself, rendered beside the editor.
 */

const Group = ({ children }: { children?: ReactNode }) => <div className="site-group">{children}</div>;
// A paragraph with a class of its own, as conloca.com's eyebrow is: the probe samples `p` by tag.
const Eyebrow = ({ children }: { children?: ReactNode }) => <p className="site-eyebrow">{children}</p>;
const TextTable = ({ items }: { items?: { title: string; text: string }[] }) => (
  <dl className="site-table">
    {items?.map((row) => (
      <div key={row.title}>
        <dt>{row.title}</dt>
        <dd>{row.text}</dd>
      </div>
    ))}
  </dl>
);

// A heading with a class of its own, as conloca.com's quiet title is.
const QuietTitle = ({ children }: { children?: ReactNode }) => <h2 className="site-quiet">{children}</h2>;

const vocabulary = defineFragmentComponents({ components: { Group, Eyebrow, QuietTitle, TextTable } });
const descriptors: MdxComponents = [
  { name: 'Group', kind: 'flow', hasChildren: true },
  { name: 'Eyebrow', kind: 'flow', hasChildren: true },
  { name: 'QuietTitle', kind: 'flow', hasChildren: true },
  { name: 'TextTable', kind: 'flow', hasChildren: false },
];

const FRAGMENT = `<Group>
Paragraph text in a group.
</Group>

<Group>
<Eyebrow>01 — Eyebrow</Eyebrow>

## Heading
</Group>

<Group>
<QuietTitle>Quiet title</QuietTitle>
</Group>

<TextTable items={[{"title": "Row title", "text": "Row text."}]} />
`;

/** The published page's markup for `FRAGMENT`, inside the site's prose wrapper. */
const PUBLISHED_BODY = `<main><div class="site-prose">
<div class="site-group"><p>Paragraph text in a group.</p></div>
<div class="site-group"><p class="site-eyebrow">01 — Eyebrow</p><h2>Heading</h2></div>
<div class="site-group"><h2 class="site-quiet">Quiet title</h2></div>
<dl class="site-table"><div><dt>Row title</dt><dd>Row text.</dd></div></dl>
</div></main>`;

/**
 * Light-only, the way conloca.com is: its page colours on `:root`, each prose element's ink set under its prose wrapper,
 * no dark rules and no colour scheme of its own.
 */
const LIGHT_ONLY_CSS = `
:root { color: rgb(28, 25, 23); background: rgb(255, 255, 255); font-family: sans-serif; }
.site-prose p { color: rgb(41, 37, 36); }
.site-prose .site-eyebrow { color: rgb(120, 113, 108); }
.site-prose h2 { color: rgb(28, 25, 23); }
.site-table dd { color: rgb(87, 83, 78); }
`;

/** A site with a dark mode keyed off `data-theme`, as Starlight's is, declaring the colour scheme of each. */
const DARK_CAPABLE_CSS = `
:root { --ink: rgb(41, 37, 36); --muted: rgb(120, 113, 108); --heading: rgb(28, 25, 23); --soft: rgb(87, 83, 78);
  color: rgb(28, 25, 23); background: rgb(255, 255, 255); color-scheme: light; font-family: sans-serif; }
:root[data-theme="dark"] { --ink: rgb(214, 211, 209); --muted: rgb(168, 162, 158); --heading: rgb(250, 250, 249);
  --soft: rgb(231, 229, 228); color: rgb(250, 250, 249); background: rgb(12, 10, 9); color-scheme: dark; }
.site-prose p { color: var(--ink); }
.site-prose .site-eyebrow { color: var(--muted); }
.site-prose h2 { color: var(--heading); }
.site-table dd { color: var(--soft); }
`;

/** Ink on every paragraph by tag, and on the eyebrow paragraph by its class. */
const CLASS_OVER_TAG_CSS = `
:root { color: rgb(28, 25, 23); background: rgb(255, 255, 255); font-family: sans-serif; }
p { color: #292524; }
.site-eyebrow { color: #78716c; }
.site-table dd { color: rgb(87, 83, 78); }
`;

/** Typography on every paragraph and heading by tag, and on the eyebrow and the quiet title by their classes. */
const CLASS_OVER_TAG_TYPOGRAPHY_CSS = `
:root { color: rgb(28, 25, 23); background: rgb(255, 255, 255); font-family: sans-serif; }
p { font: 16px serif; }
.site-eyebrow { font: 12px monospace; text-transform: uppercase; }
h2 { font: 700 24px/1.2 sans-serif; letter-spacing: -1px; }
.site-quiet { font-weight: 600; letter-spacing: -0.5px; }
`;

function pageUrl(css: string, theme?: 'light' | 'dark'): string {
  // A visitor in `theme`: the site's own switch, and the scheme a browser set to it uses.
  const attrs = theme ? ` data-theme="${theme}" style="color-scheme: ${theme}"` : '';
  const html = `<!doctype html><html${attrs}><head><meta charset="utf-8"><style>${css}</style></head><body>${PUBLISHED_BODY}</body></html>`;
  return URL.createObjectURL(new Blob([html], { type: 'text/html' }));
}

const queryClient = new QueryClient();

/**
 * The fragment editor inside the workspace frame, where the probe's load of the published page styles it, with its
 * content surround themed the way `FragmentEditor` themes it. `published` is the page as a visitor sees it.
 */
function FramedFragmentEditor({ css, siteFollowsTheme }: { css: string; siteFollowsTheme: boolean }) {
  const { resolvedTheme } = useTheme();
  const [urls, setUrls] = useState<{ probe: string; published: string }>();
  useEffect(() => {
    const previous = getUIConfig();
    configureUI({ ...previous, memoryRouter: { initialPath: '/', onNavigate() {}, subscribe: () => () => {} } });
    const probe = pageUrl(css);
    const published = siteFollowsTheme ? pageUrl(css, resolvedTheme) : probe;
    setUrls({ probe, published });
    return () => {
      configureUI(previous);
      URL.revokeObjectURL(probe);
      URL.revokeObjectURL(published);
    };
  }, [css, siteFollowsTheme, resolvedTheme]);
  if (!urls) return null;
  return (
    <QueryClientProvider client={queryClient}>
      <iframe title="published" src={urls.published} style={{ width: 800, height: 260 }} />
      <div
        className={`conloca-mdx-editor-surround${resolvedTheme === 'dark' ? ' dark' : ''}`}
        data-theme={resolvedTheme}
        style={{ width: 800 }}
      >
        <CMSMDXEditor
          value={FRAGMENT}
          onChange={() => {}}
          previewRouteUrl={urls.probe}
          fragment
          className={resolvedTheme === 'dark' ? 'dark-theme' : undefined}
        />
      </div>
    </QueryClientProvider>
  );
}

type Args = { css: string; siteFollowsTheme: boolean };

const meta = {
  title: 'Editor/FragmentEditorSiteScheme',
  render: (args: Args) => (
    <ThemeProvider>
      <FramedFragmentEditor {...args} />
    </ThemeProvider>
  ),
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The editor chrome's theme, stored before `ThemeProvider` reads it, and the site's vocabulary. */
function editorIn(theme: 'light' | 'dark'): () => () => void {
  return () => {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    setSiteRender({ vocabulary });
    setMdxComponents(descriptors);
    return () => {
      localStorage.removeItem(THEME_STORAGE_KEY);
      const root = document.documentElement;
      root.classList.remove('dark');
      root.removeAttribute('data-theme');
      root.style.colorScheme = '';
      setSiteRender({});
      setMdxComponents([]);
    };
  };
}

/** Each sample's name and the selector that finds it on the published page and in the editor alike. */
const SAMPLES = [
  ['paragraph', '.site-group p'],
  ['eyebrow', '.site-eyebrow'],
  ['heading', 'h2'],
  ['table', '.site-table dd'],
] as const;

type Look = { color: string; background: string; colorScheme: string };

/** The first painted background at or above `el`: what the text actually sits on. */
function paintedBackground(el: Element): string {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const background = getComputedStyle(node).backgroundColor;
    if (background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent') return background;
  }
  return 'rgba(0, 0, 0, 0)';
}

/**
 * The element the sample's first words are drawn in: what a reader sees. In the editor that is inside the component's
 * nested editor, not the component's own element, so measuring the component alone would miss what covers it.
 */
function textElement(root: ParentNode, selector: string): Element {
  const el = root.querySelector(selector);
  if (!el) throw new Error(`no ${selector}`);
  const walker = (el.ownerDocument ?? document).createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent?.trim() && node.parentElement) return node.parentElement;
  }
  throw new Error(`no text in ${selector}`);
}

function look(root: ParentNode, selector: string): Look {
  const el = textElement(root, selector);
  const style = getComputedStyle(el);
  return { color: style.color, background: paintedBackground(el), colorScheme: style.colorScheme };
}

function looks(root: ParentNode): Record<string, Look> {
  return Object.fromEntries(SAMPLES.map(([name, selector]) => [name, look(root, selector)]));
}

const FONT_SAMPLES = [
  ['paragraph', '.site-group p'],
  ['eyebrow', '.site-eyebrow'],
  ['heading', 'h2'],
  ['quiet title', '.site-quiet'],
] as const;
const FONT_PROPS = ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-transform'];

/** Each font sample's typography under `root`. */
function fonts(root: ParentNode): Record<string, Record<string, string>> {
  return Object.fromEntries(
    FONT_SAMPLES.map(([name, selector]) => {
      const style = getComputedStyle(textElement(root, selector));
      return [name, Object.fromEntries(FONT_PROPS.map((prop) => [prop, style.getPropertyValue(prop)]))];
    }),
  );
}

/** The editor's paragraphs, eyebrow and headings carry the published page's typography. */
async function fontsMatchPublished(canvasElement: HTMLElement): Promise<void> {
  await waitFor(
    async () => {
      const doc = canvasElement.querySelector<HTMLIFrameElement>('iframe[title="published"]')?.contentDocument;
      const editable = canvasElement.querySelector<HTMLElement>('.conloca-prose--editor');
      if (doc?.readyState !== 'complete' || !editable?.querySelector('.site-quiet')) throw new Error('not rendered');
      const published = fonts(doc);
      await expect(published.eyebrow).toMatchObject({
        'font-family': 'monospace',
        'font-size': '12px',
        'text-transform': 'uppercase',
      });
      await expect(published.paragraph).toMatchObject({ 'font-family': 'serif', 'font-size': '16px' });
      await expect(fonts(editable)).toEqual(published);
    },
    { timeout: 9000 },
  );
}

/** WCAG relative luminance of an opaque `rgb(…)` colour. */
function luminance(color: string): number {
  const match = color.match(/rgba?\(([^)]+)\)/);
  if (!match?.[1]) throw new Error(`not an rgb colour: ${color}`);
  const [r = 0, g = 0, b = 0] = match[1].split(',').map((part) => {
    const c = Number.parseFloat(part) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two opaque `rgb(…)` colours. */
function contrast({ color, background }: Look): number {
  const ink = luminance(color);
  const paper = luminance(background);
  return (Math.max(ink, paper) + 0.05) / (Math.min(ink, paper) + 0.05);
}

/** Every sample in the editor looks as it does on the published page: same ink, same paper, same colour scheme. */
async function matchesPublished(canvasElement: HTMLElement, expectedPaper: string): Promise<void> {
  const published = await waitFor(
    () => {
      const doc = canvasElement.querySelector<HTMLIFrameElement>('iframe[title="published"]')?.contentDocument;
      if (doc?.readyState !== 'complete' || !doc.querySelector('.site-table')) throw new Error('published page');
      return doc;
    },
    { timeout: 4000 },
  );
  await waitFor(
    async () => {
      const editable = canvasElement.querySelector<HTMLElement>('.conloca-prose--editor');
      if (!editable?.querySelector('.site-table dd')) throw new Error('the fragment has not rendered');
      const expected = looks(published);
      await expect(expected.paragraph?.background).toBe(expectedPaper);
      const actual = looks(editable);
      await expect(actual).toEqual(expected);
      await expect(Math.min(...Object.values(actual).map(contrast))).toBeGreaterThan(3);
    },
    { timeout: 9000 },
  );
}

/** The bug: a light-only site in a dark editor shows its dark ink on the editor's dark grey. */
export const LightOnlySiteInADarkEditor: Story = {
  name: 'a light-only site in a dark editor looks like its published page',
  args: { css: LIGHT_ONLY_CSS, siteFollowsTheme: false },
  beforeEach: editorIn('dark'),
  play: ({ canvasElement }) => matchesPublished(canvasElement, 'rgb(255, 255, 255)'),
};

export const LightOnlySiteInALightEditor: Story = {
  name: 'a light-only site in a light editor looks like its published page',
  args: { css: LIGHT_ONLY_CSS, siteFollowsTheme: false },
  beforeEach: editorIn('light'),
  play: ({ canvasElement }) => matchesPublished(canvasElement, 'rgb(255, 255, 255)'),
};

/** A site with a dark mode follows the editor into it: its own dark colours, not the editor's. */
export const DarkCapableSiteInADarkEditor: Story = {
  name: 'a dark-capable site in a dark editor looks like its published dark page',
  args: { css: DARK_CAPABLE_CSS, siteFollowsTheme: true },
  beforeEach: editorIn('dark'),
  play: ({ canvasElement }) => matchesPublished(canvasElement, 'rgb(12, 10, 9)'),
};

export const DarkCapableSiteInALightEditor: Story = {
  name: 'a dark-capable site in a light editor looks like its published light page',
  args: { css: DARK_CAPABLE_CSS, siteFollowsTheme: true },
  beforeEach: editorIn('light'),
  play: ({ canvasElement }) => matchesPublished(canvasElement, 'rgb(255, 255, 255)'),
};

/** A site that follows the visitor's scheme with `color-scheme: light dark` and `light-dark()`, and no class switch. */
const LIGHT_DARK_CSS = `
:root { color-scheme: light dark; color: light-dark(rgb(28, 25, 23), rgb(250, 250, 249));
  background: light-dark(rgb(255, 255, 255), rgb(12, 10, 9)); font-family: sans-serif; }
.site-prose p { color: light-dark(rgb(41, 37, 36), rgb(214, 211, 209)); }
.site-prose .site-eyebrow { color: light-dark(rgb(120, 113, 108), rgb(168, 162, 158)); }
.site-prose h2 { color: light-dark(rgb(28, 25, 23), rgb(250, 250, 249)); }
.site-table dd { color: light-dark(rgb(87, 83, 78), rgb(231, 229, 228)); }
`;

/** A site that follows the visitor's scheme follows the editor into dark, with its own dark colours. */
export const LightDarkSiteInADarkEditor: Story = {
  name: 'a light-dark() site in a dark editor looks like its published dark page',
  args: { css: LIGHT_DARK_CSS, siteFollowsTheme: true },
  beforeEach: editorIn('dark'),
  play: ({ canvasElement }) => matchesPublished(canvasElement, 'rgb(12, 10, 9)'),
};

export const LightDarkSiteInALightEditor: Story = {
  name: 'a light-dark() site in a light editor looks like its published light page',
  args: { css: LIGHT_DARK_CSS, siteFollowsTheme: true },
  beforeEach: editorIn('light'),
  play: ({ canvasElement }) => matchesPublished(canvasElement, 'rgb(255, 255, 255)'),
};

/** A dark-only site, `color-scheme: dark` with no light mode, stays dark in a light editor, as its published page is. */
export const DarkOnlySiteInALightEditor: Story = {
  name: 'a dark-only site in a light editor looks like its published dark page',
  args: { css: LIGHT_DARK_CSS.replace('color-scheme: light dark', 'color-scheme: dark'), siteFollowsTheme: false },
  beforeEach: editorIn('light'),
  play: ({ canvasElement }) => matchesPublished(canvasElement, 'rgb(12, 10, 9)'),
};

/** The site's class colour on a paragraph beats its tag colour, as on the published page, in either editor theme. */
export const ClassColourOverTagColourInALightEditor: Story = {
  name: "a paragraph's class colour beats the site's paragraph colour in a light editor",
  args: { css: CLASS_OVER_TAG_CSS, siteFollowsTheme: false },
  beforeEach: editorIn('light'),
  play: async ({ canvasElement }) => {
    await matchesPublished(canvasElement, 'rgb(255, 255, 255)');
    const eyebrow = canvasElement.querySelector('.conloca-prose--editor .site-eyebrow');
    await expect(eyebrow && getComputedStyle(eyebrow).color).toBe('rgb(120, 113, 108)');
  },
};

export const ClassColourOverTagColourInADarkEditor: Story = {
  name: "a paragraph's class colour beats the site's paragraph colour in a dark editor",
  args: { css: CLASS_OVER_TAG_CSS, siteFollowsTheme: false },
  beforeEach: editorIn('dark'),
  play: async ({ canvasElement }) => {
    await matchesPublished(canvasElement, 'rgb(255, 255, 255)');
    const eyebrow = canvasElement.querySelector('.conloca-prose--editor .site-eyebrow');
    await expect(eyebrow && getComputedStyle(eyebrow).color).toBe('rgb(120, 113, 108)');
  },
};

/** The site's class typography on a paragraph and a heading beats its tag typography, as on the published page. */
export const ClassTypographyOverTagTypographyInALightEditor: Story = {
  name: "a paragraph's and a heading's class typography beat the site's tag typography in a light editor",
  args: { css: CLASS_OVER_TAG_TYPOGRAPHY_CSS, siteFollowsTheme: false },
  beforeEach: editorIn('light'),
  play: ({ canvasElement }) => fontsMatchPublished(canvasElement),
};

export const ClassTypographyOverTagTypographyInADarkEditor: Story = {
  name: "a paragraph's and a heading's class typography beat the site's tag typography in a dark editor",
  args: { css: CLASS_OVER_TAG_TYPOGRAPHY_CSS, siteFollowsTheme: false },
  beforeEach: editorIn('dark'),
  play: ({ canvasElement }) => fontsMatchPublished(canvasElement),
};
