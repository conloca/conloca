import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ContentAPIClient } from '@conloca/content-api-client';
import { configureUI } from '../ui-config.js';
import { CONTENT_METHOD_CLASSIFICATION, ContentWriteRefusedError, guardContentWrites } from '../write-access.js';
import { RpcError } from './channel.js';
import { clearMediaCache, mediaObjectUrl } from './media-cache.js';
import { RpcContentClient } from './rpc-content-client.js';

let calls: [string, unknown[]][] = [];
let failing = new Map<string, Error>();
let client: RpcContentClient;

beforeEach(() => {
  calls = [];
  failing = new Map();
  client = new RpcContentClient({
    call: async (method, args = []) => {
      calls.push([method, args]);
      const error = failing.get(method);
      if (error) throw error;
      return { answered: method };
    },
  });
});

afterEach(() => {
  clearMediaCache();
  // An explicit `readOnly: undefined` clears the refusal; `configureUI({})` would carry it into the next test.
  configureUI({ readOnly: undefined });
});

/** Loads one media URL into the cache and returns it. */
async function loadedUrl(): Promise<string> {
  configureUI({ loadMedia: async () => new Blob(['png']) });
  mediaObjectUrl('serve', 'hero.png');
  await Bun.sleep(0);
  const url = mediaObjectUrl('serve', 'hero.png');
  if (!url) throw new Error('the media URL did not load');
  return url;
}

describe('the content client inside an editor frame', () => {
  test('every content method becomes one call with the same name and arguments', async () => {
    const methods = Object.keys(CONTENT_METHOD_CLASSIFICATION).filter((method) => method !== 'uploadAsset');
    expect(methods.length).toBe(36);
    for (const method of methods) {
      expect(Object.hasOwn(client, method)).toBe(true);
      const call: unknown = Reflect.get(client, method);
      if (typeof call !== 'function') throw new Error(`${method} is not a method`);
      // oxlint-disable-next-line no-await-in-loop -- each call is checked against the call log right after it.
      expect(await call.call(client, 'a', 2)).toEqual({ answered: method });
      expect(calls.at(-1)).toEqual([method, ['a', 2]]);
    }
    expect(calls.length).toBe(36);
  });

  test('it is still a ContentAPIClient, so the write guard wraps it', async () => {
    expect(client).toBeInstanceOf(ContentAPIClient);
    configureUI({ readOnly: { reason: 'Read only' } });
    const input: Parameters<ContentAPIClient['createContent']>[0] = {
      kind: 'data',
      collection: 'authors',
      type: 'json',
      locales: { en: { content: { data: {} } } },
    };
    await Promise.resolve(
      expect(guardContentWrites(client).createContent(input)).rejects.toBeInstanceOf(ContentWriteRefusedError),
    );
    expect(calls).toEqual([]);
  });

  test('an upload crosses as name/value pairs with an in-memory copy of each File', async () => {
    const file = new File(['png'], 'hero.png', { type: 'image/png', lastModified: 1234 });
    const form = new FormData();
    form.append('file', file);
    form.append('alt', 'Hero');
    form.append('folder', 'uploads');
    await client.uploadAsset(form);
    const [method, args] = calls.at(-1) ?? [];
    expect(method).toBe('uploadAsset');
    const pairs = args?.[0];
    if (!Array.isArray(pairs) || !Array.isArray(pairs[0])) throw new Error('the upload did not cross as pairs');
    expect(pairs.slice(1)).toEqual([
      ['alt', 'Hero'],
      ['folder', 'uploads'],
    ]);
    const [name, sent]: unknown[] = pairs[0];
    expect(name).toBe('file');
    if (!(sent instanceof File)) throw new Error('the file did not cross as a File');
    // A picked File is backed by a disk path only the frame's process may read; the parent gets the bytes.
    expect(sent).not.toBe(file);
    expect(sent.name).toBe('hero.png');
    expect(sent.type).toBe('image/png');
    expect(sent.lastModified).toBe(1234);
    expect(await sent.text()).toBe('png');
  });

  test('a successful media write drops the media cache; a failed one keeps it', async () => {
    const kept = await loadedUrl();
    failing.set('moveAssets', new Error('Move failed'));
    await Promise.resolve(expect(client.moveAssets(['hero.png'], '', 'old')).rejects.toThrow('Move failed'));
    expect(mediaObjectUrl('serve', 'hero.png')).toBe(kept);

    await client.deleteAsset('hero.png');
    expect(mediaObjectUrl('serve', 'hero.png')).toBeUndefined();

    failing.clear();
    for (const [method, args] of [
      ['uploadAsset', [new FormData()]],
      ['importAssetUrl', ['https://example.com/a.png']],
      ['createFolder', ['new']],
      ['updateAssetMetadata', ['hero.png', {}]],
      ['moveAssets', [['hero.png'], '', 'new']],
    ] as const) {
      // oxlint-disable-next-line no-await-in-loop -- each write must clear a cache the previous step filled.
      const url = await loadedUrl();
      const call: unknown = Reflect.get(client, method);
      if (typeof call !== 'function') throw new Error(`${method} is not a method`);
      // oxlint-disable-next-line no-await-in-loop -- same sequence as above.
      await call.apply(client, args);
      expect(mediaObjectUrl('serve', 'hero.png')).not.toBe(url);
    }
  });

  test('a refusal from the parent arrives as the call error', async () => {
    const refusal = new RpcError('Method not allowed: getGitStatus', 'method_not_allowed');
    failing.set('getGitStatus', refusal);
    await Promise.resolve(expect(client.getGitStatus()).rejects.toBe(refusal));
  });
});
