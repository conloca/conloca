/// <reference lib="dom" />
import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { defineFragmentComponents, evaluateMDXToComponent } from '@conloca/mdx/render';
import { cleanup, render, waitFor } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import * as inlinePreviewFrame from '../src/components/editor/InlinePreviewFrame.js';
import { MDXLivePreview } from '../src/components/editor/MDXLivePreview.js';
import { setSiteRender } from '../src/site-render.js';
import { setDataBindings } from '../src/ui-config.js';

const originalInlinePreviewFrame = { ...inlinePreviewFrame };

// Happy DOM loads only the first srcdoc frame of a file, so the frame renders inline here; the Chromium story
// FramedPreview covers the real frame document.
await mock.module('../src/components/editor/InlinePreviewFrame.js', () => ({
  ...originalInlinePreviewFrame,
  InlinePreviewFrame: ({ children }: { children: ReactNode }) => <div data-testid="preview">{children}</div>,
}));

// mock.module is process-wide: put the real frame back for later files.
afterAll(async () => {
  await mock.module('../src/components/editor/InlinePreviewFrame.js', () => originalInlinePreviewFrame);
});

const ENTRIES = [
  { name: 'pages', collection: 'pages' },
  { name: 'blog', collection: 'blog', frame: 'blog' },
];

const BlogFrame = ({ pathname, children }: { pathname: string; children: ReactNode }) => (
  <div className={pathname.startsWith('/blog/') ? 'page-shell' : 'page'}>{children}</div>
);

const Eyebrow = (props: ComponentProps<'h2'>) => <h2 data-eyebrow="" {...props} />;

const Broken = (): never => {
  throw new Error('frame blew up');
};

async function renderPreview(markdown: string) {
  const { findByTestId } = render(<MDXLivePreview markdown={markdown} debounceMs={0} />);
  const preview = await findByTestId('preview');
  await waitFor(() => expect(preview.querySelector('#__sandbox_root h2')).toBeTruthy());
  return preview;
}

describe('the fragment live preview in the editor frame', () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, '__SITE_RENDER_STATE__');
    setSiteRender({ evaluate: evaluateMDXToComponent, frames: { blog: BlogFrame } });
    setDataBindings({
      siteName: 'default',
      locale: 'en',
      routes: {},
      entries: ENTRIES,
      fragmentPreviewRoute: '/blog/x',
    });
  });
  afterEach(() => {
    cleanup();
    setDataBindings(undefined);
    Reflect.deleteProperty(window, '__SITE_RENDER_STATE__');
  });

  test('renders the fragment inside the first framed entry, at the fragment preview route', async () => {
    const doc = await renderPreview('## Hello');
    const root = doc.querySelector('.page-shell > [data-conloca-page-root] > #__sandbox_root');
    expect(root?.querySelector('h2')?.textContent).toBe('Hello');
  });

  test('shows element overrides from the vocabulary', async () => {
    setSiteRender({
      evaluate: evaluateMDXToComponent,
      frames: { blog: BlogFrame },
      vocabulary: defineFragmentComponents({ elements: { h2: Eyebrow } }),
    });
    const doc = await renderPreview('## Hello');
    expect(doc.querySelector('h2')?.hasAttribute('data-eyebrow')).toBe(true);
  });

  test('renders bare when no entry declares a frame', async () => {
    setDataBindings({ siteName: 'default', locale: 'en', routes: {}, entries: ENTRIES.slice(0, 1) });
    const doc = await renderPreview('## Hello');
    expect(doc.querySelector('[data-conloca-page-root]')).toBeNull();
  });

  test('a frame that throws leaves the preview bare and logs once', async () => {
    const error = spyOn(console, 'error').mockImplementation(() => {});
    setSiteRender({ evaluate: evaluateMDXToComponent, frames: { blog: Broken } });
    try {
      const doc = await renderPreview('## Hello');
      expect(doc.querySelector('[data-conloca-page-root]')).toBeNull();
      expect(doc.querySelector('#__sandbox_root h2')?.textContent).toBe('Hello');
      expect(error.mock.calls.filter((call) => String(call[0]).includes('editor frame of route')).length).toBe(1);
    } finally {
      error.mockRestore();
    }
  });
});
