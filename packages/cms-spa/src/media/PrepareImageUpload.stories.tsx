import {
  ContentAPIClient,
  DEFAULT_MAX_FILE_SIZE,
  setContentAPIClient,
  tooLargeRefusal,
} from '@conloca/content-api-client';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { expect, fn, spyOn, userEvent, within } from 'storybook/test';
import '../main.css';
import { UploadModal } from '../components/media/UploadModal.js';
import { prepareImageUpload } from './prepare-image-upload.js';

/**
 * Browser shrinking proven against Chromium's real codecs: canvas decode, EXIF orientation and WebP encode exist
 * only in a browser, so bun:test covers the pure helpers and these play functions cover the pixels.
 */

/** A JPEG `width`×`height`, red on its left half and blue on its right. */
async function photo(width: number, height: number): Promise<Uint8Array<ArrayBuffer>> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2d canvas');
  context.fillStyle = 'rgb(255, 0, 0)';
  context.fillRect(0, 0, width / 2, height);
  context.fillStyle = 'rgb(0, 0, 255)';
  context.fillRect(width / 2, 0, width / 2, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob) throw new Error('the canvas encoded nothing');
  return new Uint8Array(await blob.arrayBuffer());
}

/** `jpeg` with an EXIF block saying "rotate 90° clockwise to display" (orientation 6), as a phone held upright writes. */
function sideways(jpeg: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  // APP1 "Exif", big-endian TIFF, one IFD entry: tag 0x0112 (Orientation), SHORT, count 1, value 6.
  const exif = [
    0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00,
    0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ];
  return new Uint8Array([...jpeg.subarray(0, 2), ...exif, ...jpeg.subarray(2)]);
}

/** The colour of the pixel at `x`,`y` of `file`. */
async function pixel(file: File, x: number, y: number): Promise<number[]> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2d canvas');
  context.drawImage(bitmap, 0, 0);
  return [...context.getImageData(x, y, 1, 1).data.subarray(0, 3)];
}

async function size(file: File): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  return { width: bitmap.width, height: bitmap.height };
}

const sent = fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({}, { status: 201 }));

function UploadModalStory() {
  const [queryClient] = useState(() => {
    setContentAPIClient(new ContentAPIClient({ fetch: Object.assign(sent, { preconnect: fetch.preconnect }) }));
    return new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  });
  return (
    <QueryClientProvider client={queryClient}>
      <UploadModal isOpen onClose={() => {}} folder="/" />
    </QueryClientProvider>
  );
}

const meta = {
  component: UploadModalStory,
} satisfies Meta<typeof UploadModalStory>;

export default meta;
type Story = StoryObj<typeof meta>;

const pure = { render: () => <p>Browser image preparation</p> };

export const ShrinksALargePhotoToWebp: Story = {
  ...pure,
  name: 'a 4000×3000 JPEG becomes a 2560×1920 WebP named .webp',
  play: async () => {
    const prepared = await prepareImageUpload(
      new File([await photo(4000, 3000)], 'team-office.JPG', { type: 'image/jpeg' }),
      DEFAULT_MAX_FILE_SIZE,
    );
    await expect({ name: prepared.name, type: prepared.type }).toEqual({
      name: 'team-office.webp',
      type: 'image/webp',
    });
    await expect(await size(prepared)).toEqual({ width: 2560, height: 1920 });
  },
};

export const StandsASidewaysPhotoUpright: Story = {
  ...pure,
  name: 'a sideways (orientation 6) JPEG comes out upright',
  play: async () => {
    const prepared = await prepareImageUpload(
      new File([sideways(await photo(3000, 1000))], 'portrait.jpg', { type: 'image/jpeg' }),
      DEFAULT_MAX_FILE_SIZE,
    );
    await expect(await size(prepared)).toEqual({ width: 853, height: 2560 });
    // Turned clockwise, the stored left half (red) is the top and the right half (blue) the bottom.
    const [top, bottom] = [await pixel(prepared, 426, 100), await pixel(prepared, 426, 2460)];
    await expect(top[0]).toBeGreaterThan(200);
    await expect(top[2]).toBeLessThan(60);
    await expect(bottom[2]).toBeGreaterThan(200);
    await expect(bottom[0]).toBeLessThan(60);
  },
};

export const FallsBackToJpegWithoutWebp: Story = {
  ...pure,
  name: 'when the canvas returns PNG for WebP (Safari), the photo becomes a .jpg JPEG',
  play: async () => {
    // Safari answers PNG when asked for WebP; every other type is encoded as asked.
    const toBlob = spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      done: BlobCallback,
      type?: string,
    ) {
      void fetch(this.toDataURL(type === 'image/webp' ? 'image/png' : type))
        .then((answer) => answer.blob())
        .then(done);
    });
    try {
      const prepared = await prepareImageUpload(
        new File([await photo(4000, 3000)], 'team-office.jpeg', { type: 'image/jpeg' }),
        DEFAULT_MAX_FILE_SIZE,
      );
      await expect({ name: prepared.name, type: prepared.type }).toEqual({
        name: 'team-office.jpg',
        type: 'image/jpeg',
      });
      await expect(await size(prepared)).toEqual({ width: 2560, height: 1920 });
    } finally {
      toBlob.mockRestore();
    }
  },
};

export const RefusesAProcessedFileOverTheLimit: Story = {
  ...pure,
  name: 'a processed file over the limit is refused before any request',
  play: async () => {
    const requests = fn();
    const realFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(requests, { preconnect: realFetch.preconnect });
    try {
      await expect(
        prepareImageUpload(new File([await photo(4000, 3000)], 'photo.jpg', { type: 'image/jpeg' }), 100),
      ).rejects.toThrow(/^photo\.jpg is 1 MB, over the 1 MB limit for files stored in your site\./);
    } finally {
      globalThis.fetch = realFetch;
    }
    await expect(requests).not.toHaveBeenCalled();
  },
};

export const UploadModalShowsTheRefusal: Story = {
  name: 'UploadModal shows the refusal sentence',
  play: async ({ canvasElement }) => {
    sent.mockClear();
    const input = canvasElement.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('no file input');
    const banner = new File([new Uint8Array(DEFAULT_MAX_FILE_SIZE + 1)], 'banner.gif', { type: 'image/gif' });

    await userEvent.upload(input, banner);
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Upload' }));

    await expect(
      await within(canvasElement).findByText(tooLargeRefusal('banner.gif', banner.size, DEFAULT_MAX_FILE_SIZE)),
    ).toBeVisible();
    await expect(sent).not.toHaveBeenCalled();
  },
};
