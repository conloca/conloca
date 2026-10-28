import { ContentAPIClient } from '@conloca/content-api-client';
import type { FrameChannel } from './channel.js';
import { clearMediaCache } from './media-cache.js';
import { CONTENT_METHOD_CLASSIFICATION } from './protocol.js';

/** Writes after which loaded media bytes may be stale. */
const MEDIA_WRITES = new Set([
  'uploadAsset',
  'importAssetUrl',
  'deleteAsset',
  'createFolder',
  'updateAssetMetadata',
  'moveAssets',
]);

/** The name/value pairs of an upload form, each File replaced by a copy held in memory. */
function uploadPairs(form: FormData): Promise<[string, FormDataEntryValue][]> {
  return Promise.all(
    [...form.entries()].map(
      async ([name, value]): Promise<[string, FormDataEntryValue]> =>
        typeof value === 'string'
          ? [name, value]
          : [
              name,
              new File([await value.arrayBuffer()], value.name, {
                type: value.type,
                lastModified: value.lastModified,
              }),
            ],
    ),
  );
}

/**
 * The content client of an editor frame: it holds no credentials, so every content method becomes a call the
 * parent frame runs on its own client. All methods cross, writes and reads alike; the parent decides what it refuses.
 */
export class RpcContentClient extends ContentAPIClient {
  constructor(channel: Pick<FrameChannel, 'call'>) {
    super();
    for (const method of Object.keys(CONTENT_METHOD_CLASSIFICATION)) {
      Object.defineProperty(this, method, {
        // oxlint-disable-next-line anti-slop/no-unknown-returns -- it replaces a typed ContentAPIClient method; callers see that method's types.
        value: async (...args: unknown[]): Promise<unknown> => {
          // FormData cannot be cloned onto a port; its name/value pairs can. A picked File is backed by a disk
          // path only this frame's process may read, so each File crosses as an in-memory copy of its bytes.
          const sent = method === 'uploadAsset' && args[0] instanceof FormData ? [await uploadPairs(args[0])] : args;
          const result = await channel.call(method, sent);
          if (MEDIA_WRITES.has(method)) clearMediaCache();
          return result;
        },
        writable: false,
        enumerable: false,
        configurable: false,
      });
    }
  }
}
