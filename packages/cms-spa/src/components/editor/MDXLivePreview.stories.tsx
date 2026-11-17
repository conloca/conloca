import { defineFragmentComponents, evaluateMDXToComponent } from '@conloca/mdx/render';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { type ReactNode, useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import '../../main.css';
import { SANDBOX_L0_CSS } from '../../sandbox-preview-styles.js';
import { setSiteRender } from '../../site-render.js';
import { setSiteStyles } from '../../site-styles.js';
import { configureUI, getUIConfig } from '../../ui-config.js';
import { MDXLivePreview } from './MDXLivePreview.js';

const Callout = ({ children }: { children?: ReactNode }) => <aside className="story-callout">{children}</aside>;

function TypedPreview() {
  const [markdown, setMarkdown] = useState('');
  return (
    <div>
      <textarea aria-label="Source" value={markdown} onChange={(event) => setMarkdown(event.target.value)} />
      <MDXLivePreview markdown={markdown} debounceMs={50} />
    </div>
  );
}

const meta = {
  title: 'Editor/MDXLivePreview',
  component: TypedPreview,
  beforeEach: () => {
    setSiteStyles(['h2 { color: rgb(1, 2, 3) }']);
    setSiteRender({
      evaluate: evaluateMDXToComponent,
      vocabulary: defineFragmentComponents({ components: { Callout } }),
    });
    return () => {
      setSiteStyles([]);
      setSiteRender({});
    };
  },
} satisfies Meta<typeof TypedPreview>;

export default meta;

type Story = StoryObj<typeof meta>;

function previewDocument(canvasElement: HTMLElement): Document | null {
  return canvasElement.querySelector<HTMLIFrameElement>('iframe[title="Fragment preview"]')?.contentDocument ?? null;
}

export const LivePreviewCarriesSiteStyles: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByLabelText('Source'));
    await userEvent.paste('## Hi\n\nBody text\n\n<Callout>hi</Callout>');

    await waitFor(() =>
      expect(previewDocument(canvasElement)?.querySelector('aside.story-callout')?.textContent).toBe('hi'),
    );
    const doc = previewDocument(canvasElement);
    const view = doc?.defaultView;
    if (!doc || !view) throw new Error('the preview frame has no document');
    await expect(doc.querySelector('style[data-conloca-preview-styles]')?.textContent).toContain(SANDBOX_L0_CSS.trim());
    const heading = doc.querySelector('h2');
    const paragraph = [...doc.querySelectorAll('p')].find((p) => p.textContent === 'Body text');
    const root = doc.getElementById('__sandbox_root');
    if (!heading || !paragraph || !root) throw new Error('the preview has no h2, paragraph or floor root');
    await expect(view.getComputedStyle(heading).color).toBe('rgb(1, 2, 3)');
    // The floor applies where the site's CSS is silent: the font, and the root's own padding.
    await expect(view.getComputedStyle(paragraph).fontFamily).toContain('ui-sans-serif');
    await expect(view.getComputedStyle(root).paddingLeft).toBe('24px');
    await expect(canvasElement.querySelector('iframe.conloca-content-sandbox')).toBeNull();

    await userEvent.clear(canvas.getByLabelText('Source'));
    await userEvent.paste("import X from 'x'\n\n# Hi");
    await expect(await canvas.findByText('Preview unavailable')).toBeTruthy();
  },
};

const ArticleFrame = ({ pathname, children }: { pathname: string; children: ReactNode }) => (
  <div className={pathname.startsWith('/blog/') ? 'page-shell' : 'page'}>{children}</div>
);

export const FramedPreview: Story = {
  beforeEach: () => {
    setSiteStyles(['.page-shell h2 { color: rgb(4, 5, 6) }']);
    setSiteRender({ evaluate: evaluateMDXToComponent, frames: { blog: ArticleFrame } });
    // The UI config is module state shared across stories, so put back whatever was installed.
    const previous = getUIConfig();
    configureUI({
      ...previous,
      dataBindings: {
        siteName: 'default',
        locale: 'en',
        routes: {},
        entries: [
          { name: 'pages', collection: 'pages' },
          { name: 'blog', collection: 'blog', frame: 'blog' },
        ],
        fragmentPreviewRoute: '/blog/x',
      },
    });
    return () => configureUI(previous);
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByLabelText('Source'));
    await userEvent.paste('## Framed');

    await waitFor(() =>
      expect(
        previewDocument(canvasElement)?.querySelector('.page-shell > [data-conloca-page-root] h2')?.textContent,
      ).toBe('Framed'),
    );
    const doc = previewDocument(canvasElement);
    const heading = doc?.querySelector('h2');
    if (!doc?.defaultView || !heading) throw new Error('the preview has no heading');
    await expect(doc.defaultView.getComputedStyle(heading).color).toBe('rgb(4, 5, 6)');
  },
};
