/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, jest, mock, spyOn, test } from 'bun:test';
import type { MDXEditorMethods } from '@mdxeditor/editor';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createRef, type Ref } from 'react';
import { CMSMDXEditor } from '../src/components/editor/CMSMDXEditor.js';
import { DRAFT_IMAGE_WAIT_MS, draftImageData } from '../src/components/editor/draft-media-config.js';
import { ContentSandbox } from '../src/components/sandbox/ContentSandbox.js';
import { clearMediaCache } from '../src/frame/media-cache.js';
import type { MediaLoadInput } from '../src/frame/protocol.js';
import { configureUI } from '../src/ui-config.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
let loads: MediaLoadInput[];
const loadMedia = mock(async (input: MediaLoadInput) => {
  loads.push(input);
  return new Blob([PNG], { type: 'image/png' });
});

/** An `Image` that loads every src: the editor shows an image only once its probe `Image` loads, which the test DOM never does. */
class LoadingImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_src: string) {
    queueMicrotask(() => this.onload?.());
  }
}
const realImage = Object.getOwnPropertyDescriptor(globalThis, 'Image');

beforeEach(() => {
  loads = [];
  spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(async () => new Response('', { status: 404 }), { preconnect: fetch.preconnect }),
  );
  Object.defineProperty(globalThis, 'Image', { value: LoadingImage, configurable: true, writable: true });
});

afterEach(() => {
  cleanup();
  mock.restore();
  if (realImage) Object.defineProperty(globalThis, 'Image', realImage);
  clearMediaCache();
  // configureUI merges, so the loader is cleared explicitly.
  configureUI({ loadMedia: undefined });
});

function renderEditor(markdown: string, ref?: Ref<MDXEditorMethods>) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <CMSMDXEditor ref={ref} value={markdown} onChange={() => {}} previewRouteUrl="/" />
    </QueryClientProvider>,
  );
}

describe('a draft image in the MDX editor canvas', () => {
  test('shows the bytes the page loads through UIConfig.loadMedia, while the markdown keeps its /assets src', async () => {
    configureUI({ loadMedia });
    const ref = createRef<MDXEditorMethods>();
    const { container } = renderEditor('![Hero](/assets/media/hero.png)', ref);
    await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toStartWith('blob:'));
    expect(loads).toEqual([{ route: 'draft', path: 'media/hero.png' }]);
    expect(ref.current?.getMarkdown()).toContain('](/assets/media/hero.png)');
  });

  test('keeps its canonical src without a loader', async () => {
    const { container } = renderEditor('![Hero](/assets/media/hero.png)');
    await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toBe('/assets/media/hero.png'));
    expect(loads).toEqual([]);
  });
});

/** The render messages `ContentSandbox` posts into its frame once the frame reports loaded. */
async function renderMessages(content: string) {
  const { container } = render(<ContentSandbox mode="mdx" content={content} />);
  const iframe = container.querySelector('iframe');
  const frameWindow = iframe?.contentWindow;
  if (!iframe || !frameWindow) throw new Error('the sandbox frame did not mount');
  const post = spyOn(frameWindow, 'postMessage').mockImplementation(() => {});
  fireEvent.load(iframe);
  await waitFor(() => expect(post).toHaveBeenCalled());
  return post.mock.calls.map(([message]: unknown[]) => message);
}

// A compiled MDX body names its image sources as string literals.
const COMPILED = 'return {default: () => _jsx("img", {src: "/assets/hero.png", alt: "Hero"})};';

describe('a draft image in the sandboxed MDX preview', () => {
  test('crosses as a data URL, since the opaque-origin frame cannot read the page blob URLs', async () => {
    configureUI({ loadMedia });
    const messages = await renderMessages(COMPILED);
    for (const message of messages) {
      expect(message).toMatchObject({
        payload: COMPILED,
        images: { '/assets/hero.png': 'data:image/png;base64,iVBORw==' },
      });
    }
    expect(loads).toEqual([{ route: 'draft', path: 'hero.png' }]);
  });

  test('crosses unchanged without a loader', async () => {
    const messages = await renderMessages(COMPILED);
    for (const message of messages) expect(message).not.toHaveProperty('images');
    expect(loads).toEqual([]);
  });
});

describe('the draft image data of a preview update', () => {
  const BOTH = 'return [_jsx("img", {src: "/assets/hero.png"}), _jsx("img", {src: "/assets/other.png"})];';

  afterEach(() => {
    jest.useRealTimers();
  });

  test(`leaves out an image still loading after ${DRAFT_IMAGE_WAIT_MS} ms`, async () => {
    configureUI({
      loadMedia: (input) => (input.path === 'other.png' ? new Promise<Blob>(() => {}) : loadMedia(input)),
    });
    // The first read warms the cache, so under fake timers only the stalled image is outstanding.
    await draftImageData(COMPILED);
    jest.useFakeTimers();
    const pending = draftImageData(BOTH);
    // Fake timers hold Bun.sleep too, so microtask turns let the cached image settle before the wait runs out.
    for (let turn = 0; turn < 20; turn++) {
      // oxlint-disable-next-line no-await-in-loop -- each turn must settle before the next.
      await Promise.resolve();
    }
    jest.advanceTimersByTime(DRAFT_IMAGE_WAIT_MS);
    expect(await pending).toEqual({ '/assets/hero.png': 'data:image/png;base64,iVBORw==' });
  });

  test('encodes each loaded image once across updates', async () => {
    configureUI({ loadMedia });
    const read = spyOn(FileReader.prototype, 'readAsDataURL');
    await draftImageData(COMPILED);
    expect(await draftImageData(COMPILED)).toEqual({ '/assets/hero.png': 'data:image/png;base64,iVBORw==' });
    expect(read).toHaveBeenCalledTimes(1);
  });

  test('leaves out only the image whose bytes cannot be read', async () => {
    configureUI({ loadMedia: async (input) => new Blob([PNG], { type: `image/${input.path}` }) });
    // A reader that fails only on the bytes of other.png.
    spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader, blob: Blob) {
      const failed = blob.type === 'image/other.png';
      if (!failed) Object.defineProperty(this, 'result', { value: 'data:image/png;base64,iVBORw==' });
      queueMicrotask(() => this.dispatchEvent(new ProgressEvent(failed ? 'error' : 'load')));
    });
    expect(await draftImageData(BOTH)).toEqual({ '/assets/hero.png': 'data:image/png;base64,iVBORw==' });
  });
});
