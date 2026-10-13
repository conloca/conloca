import { afterEach, describe, expect, it } from 'bun:test';
import { ContentAPIClient } from '@conloca/content-api-client';
import { configureUI, setEditorReadOnly } from './ui-config.js';
import { CONTENT_METHOD_CLASSIFICATION, ContentWriteRefusedError, guardContentWrites } from './write-access.js';

const REFUSAL = {
  reason: 'Editing is paused for this workspace. Ask an admin to restore write access.',
};

/** Method names the gate claims to cover as writes. */
const WRITE_METHODS = Object.entries(CONTENT_METHOD_CLASSIFICATION)
  .filter(([, access]) => access === 'write')
  .map(([method]) => method);

interface Transport {
  readonly calls: string[];
  readonly fetch: typeof fetch;
}

/** A client whose transport records every URL it is asked for and answers `{}`. */
function stubbedClient(): { client: ContentAPIClient; transport: Transport } {
  const calls: string[] = [];
  const record = async (input: RequestInfo | URL): Promise<Response> => {
    calls.push(String(input));
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  // Bun's `typeof fetch` carries `preconnect`; the client never calls it, but
  // the shape has to be honest rather than asserted past.
  const transport: Transport = { calls, fetch: Object.assign(record, { preconnect: fetch.preconnect }) };
  return { client: new ContentAPIClient({ baseUrl: '/api', fetch: transport.fetch }), transport };
}

afterEach(() => {
  // The config is a process-wide global; clear the refusal explicitly rather
  // than relying on `configureUI`, which now carries `readOnly` across.
  setEditorReadOnly(null);
  configureUI({});
});

describe('the read-only seam', () => {
  it('refuses every classified write with the host’s reason while the account is read-only', async () => {
    // Guards the loop below: a classification that collected nothing would let
    // every assertion in this case pass without exercising anything. The count
    // is exact so that adding a content-API write forces a look at this file.
    expect(WRITE_METHODS.length).toBe(15);

    const { client, transport } = stubbedClient();
    const guarded = guardContentWrites(client);
    setEditorReadOnly(REFUSAL);

    const refused: string[] = [];
    for (const method of WRITE_METHODS) {
      const call = Reflect.get(guarded, method);
      if (typeof call !== 'function') throw new Error(`${method} is not a method on the guarded client`);
      // Every write is overridden, so none of them reaches its arguments.
      const error: unknown = await call.call(guarded).then(
        () => null,
        (reason: unknown) => reason,
      );
      expect(error).toBeInstanceOf(ContentWriteRefusedError);
      if (!(error instanceof ContentWriteRefusedError)) throw error;
      expect(error.method).toBe(method);
      expect(error.message).toBe(REFUSAL.reason);
      expect(error.refusal).toEqual(REFUSAL);
      refused.push(method);
    }

    expect(refused).toEqual(WRITE_METHODS);
    // The refusal is local: nothing was sent, so nothing can have landed.
    expect(transport.calls).toEqual([]);
  });

  it('leaves reads alone, so a read-only editor still renders its content', async () => {
    const { client, transport } = stubbedClient();
    const guarded = guardContentWrites(client);
    setEditorReadOnly(REFUSAL);

    await guarded.getContent('page-1');
    await guarded.listAssets();
    await guarded.getSitesConfig();

    expect(transport.calls).toEqual(['/api/content/page-1', '/api/assets', '/api/sites']);
  });

  it('hands writes straight back when the host clears the refusal, with no remount', async () => {
    const { client, transport } = stubbedClient();
    const guarded = guardContentWrites(client);

    setEditorReadOnly(REFUSAL);
    await expect(guarded.createFolder('/blog')).rejects.toBeInstanceOf(ContentWriteRefusedError);

    setEditorReadOnly(null);
    await guarded.createFolder('/blog');
    expect(transport.calls).toEqual(['/api/assets/folders']);
  });

  it('does not re-grant writes when a workspace switch reinstalls the config', async () => {
    const { client } = stubbedClient();
    const guarded = guardContentWrites(client);
    setEditorReadOnly(REFUSAL);

    // What a branch switch does: a whole new `configureUI` payload that says
    // nothing about write access. The account is still read-only.
    configureUI({ basename: '/branches/other/edit', apiBaseUrl: '/other', hosted: true });

    await expect(guarded.deleteContent('page-1', 'etag')).rejects.toBeInstanceOf(ContentWriteRefusedError);
  });

  it('clears when the caller states an absent refusal explicitly', async () => {
    const { client, transport } = stubbedClient();
    const guarded = guardContentWrites(client);
    setEditorReadOnly(REFUSAL);

    configureUI({ basename: '/__cms', readOnly: undefined });

    await guarded.createFolder('/blog');
    expect(transport.calls).toEqual(['/api/assets/folders']);
  });

  it('stays the content client every consumer already holds', () => {
    const { client } = stubbedClient();
    expect(guardContentWrites(client)).toBeInstanceOf(ContentAPIClient);
  });

  it('mounts against a host client narrower than the full surface, and still gates what it has', async () => {
    // Hosts supply their own `UIConfig.contentClient`, and test doubles in
    // particular implement only the methods under test. Refusing to wrap one
    // would throw inside the editor's mount `useMemo` and take the whole
    // editor away — for a method nobody could have called anyway.
    const { client, transport } = stubbedClient();
    const narrow: ContentAPIClient = Object.create(client);
    Object.defineProperty(narrow, 'createContent', { value: undefined });

    const guarded = guardContentWrites(narrow);
    setEditorReadOnly(REFUSAL);

    await expect(guarded.deleteAsset('hero.png')).rejects.toBeInstanceOf(ContentWriteRefusedError);
    await guarded.getContent('page-1');
    expect(transport.calls).toEqual(['/api/content/page-1']);
  });
});
