import { describe, expect, it, mock } from 'bun:test';
import { d8ImageEndpoint } from '../d8-build.js';

// The image config Astro serves as `astro:assets`, as a site allowing one remote host sets it.
mock.module('astro:assets', () => ({
  imageConfig: { domains: [], remotePatterns: [{ protocol: 'https', hostname: 'img.example' }] },
}));
// Imported after the mock: `astro:assets` exists only inside an Astro build.
const { GET } = await import('../preview-image-endpoint.js');

const ENDPOINT = 'https://site.example/_conloca/preview/_image';

async function get(href: string): Promise<Response> {
  const url = new URL(`${ENDPOINT}?href=${encodeURIComponent(href)}`);
  return GET({ url });
}

describe('the preview image endpoint', () => {
  it.each(['/_astro/a.png', 'https://img.example/a.png'])('redirects %s, never fetching', async (href) => {
    const response = await get(href);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(href);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it.each([
    'https://evil.example/a.png',
    '//evil.example/a.png',
    '/\\evil.example/a.png',
    'javascript:x',
    '/_conloca/preview/_image?href=x',
    '',
    '/_conloca/preview/%5Fimage?href=x',
  ])('refuses %s', async (href) => {
    const response = await get(href);
    expect(response.status).toBe(403);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it.each(['/a.png\r\nset-cookie: x=1', 'https://img.example/a.png\r\nset-cookie: x=1'])(
    'never puts CR or LF in Location for %j',
    async (href) => {
      const response = await get(href);
      expect(response.status).not.toBe(500);
      expect(response.headers.get('location') ?? '').not.toMatch(/[\r\n]/u);
      expect(response.headers.get('set-cookie')).toBeNull();
    },
  );

  it("is Cloudflare's passthrough endpoint on Cloudflare, ours elsewhere", () => {
    expect(d8ImageEndpoint('@astrojs/cloudflare')).toBe('@astrojs/cloudflare/image-passthrough-endpoint');
    expect(d8ImageEndpoint('@astrojs/netlify')).toBe('@conloca/cloud-astro/preview-image-endpoint');
  });
});
