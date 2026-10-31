import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { ContentAPIClient, IMAGE_EXTENSION_MIME, setContentAPIClient, videoRefusal } from '@conloca/content-api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { ACCEPTED_TYPES, useUploadFlow } from './useUploadFlow.js';

/**
 * `ACCEPTED_TYPES` is the `accept` attribute the media pickers hand to the
 * browser's file dialog. It has to stay in step with `IMAGE_EXTENSION_MIME`,
 * the allowlist the upload backends actually enforce: a separately maintained
 * copy drifts, and anything missing here is greyed out in the dialog even
 * though the upload behind it would have succeeded.
 */
describe('ACCEPTED_TYPES', () => {
  const offered = ACCEPTED_TYPES.split(',');

  it('offers every content type the upload allowlist accepts', () => {
    expect(new Set(offered)).toEqual(new Set(Object.values(IMAGE_EXTENSION_MIME)));
  });

  it('offers icons, which both upload backends accept', () => {
    expect(offered).toContain('image/x-icon');
  });

  it('names each content type once, so extensions sharing one do not repeat it', () => {
    // `jpg` and `jpeg` both map to `image/jpeg`.
    expect(offered).toHaveLength(new Set(offered).size);
  });

  it('never offers HEIC in the file dialog', () => {
    expect(ACCEPTED_TYPES).not.toMatch(/heic|heif/i);
  });
});

function renderFlow() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return renderHook(() => useUploadFlow({ folder: '/' }), { wrapper });
}

function files(...picked: File[]): FileList {
  const transfer = new DataTransfer();
  for (const file of picked) transfer.items.add(file);
  return transfer.files;
}

describe('useUploadFlow', () => {
  const sent = mock(async (_url: RequestInfo | URL, _init?: RequestInit) =>
    Response.json(
      {
        filename: 'spinner.gif',
        originalName: 'spinner.gif',
        mimeType: 'image/gif',
        size: 6,
        uploadedAt: '',
        folder: '/',
      },
      { status: 201 },
    ),
  );

  beforeEach(() => {
    sent.mockClear();
    setContentAPIClient(
      new ContentAPIClient({ baseUrl: '/__cms/api', fetch: Object.assign(sent, { preconnect: fetch.preconnect }) }),
    );
  });

  afterEach(() => {
    setContentAPIClient(new ContentAPIClient());
  });

  it('shows the refusal for a video and sends nothing', async () => {
    const { result } = renderFlow();
    act(() => result.current.handleFiles(files(new File([], 'clip.mp4', { type: 'video/mp4' }))));

    await act(() => result.current.handleUpload());

    expect(result.current.error?.message).toBe(videoRefusal('clip.mp4'));
    expect(sent).not.toHaveBeenCalled();
  });

  it('forgets the refusal when the author clears the file', async () => {
    const { result } = renderFlow();
    act(() => result.current.handleFiles(files(new File([], 'clip.mp4'))));
    await act(() => result.current.handleUpload());

    act(() => result.current.handleCancel());

    expect(result.current.error).toBeNull();
  });

  it('counts a refused file in a batch as failed and shows its refusal', async () => {
    const { result } = renderFlow();

    act(() => result.current.handleFiles(files(new File([], 'clip.mov'), new File(['GIF89a'], 'spinner.gif'))));

    await waitFor(() => expect(result.current.uploadProgress?.inProgress).toBe(false));
    expect(result.current.uploadProgress).toMatchObject({ total: 2, completed: 1, failed: 1 });
    expect(result.current.error?.message).toBe(videoRefusal('clip.mov'));
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it('stays busy while a photo is prepared, so a second click sends nothing more', async () => {
    const decoded = Promise.withResolvers<ImageBitmap>();
    const original = globalThis.createImageBitmap;
    globalThis.createImageBitmap = () => decoded.promise;
    try {
      const { result } = renderFlow();
      act(() => result.current.handleFiles(files(new File(['jpeg'], 'photo.jpg', { type: 'image/jpeg' }))));

      let first: Promise<void> = Promise.resolve();
      act(() => {
        first = result.current.handleUpload();
      });
      expect(result.current.isUploading).toBe(true);
      await act(() => result.current.handleUpload());

      decoded.resolve({ width: 100, height: 100, close: () => {} });
      await act(() => first);
      await waitFor(() => expect(sent).toHaveBeenCalledTimes(1));
    } finally {
      globalThis.createImageBitmap = original;
    }
  });
});
