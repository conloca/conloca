import type { ContentAPIClient } from '@conloca/content-api-client';
import { type EditorWriteAccess, type EditorWriteRefusal, getUIConfig, type UIConfig } from './ui-config.js';

/** Does a content-API method observe the workspace, or change it? */
export type ContentMethodAccess = 'read' | 'write';

/**
 * Every public method of `ContentAPIClient`, classified.
 *
 * The `satisfies` is the load-bearing part. `Record<keyof ContentAPIClient,
 * ContentMethodAccess>` is TOTAL, so the day the content API grows a method,
 * this object stops compiling until somebody says which kind it is. Without
 * that, a new write would join the client and slip past the gate in silence
 * — and a silently-ungated write against a refused account is precisely the
 * bug this module exists to make impossible.
 * Removed client methods must also be removed from this classification;
 * browser-side helpers are not part of the content API's access boundary.
 *
 * `compileMDX` is a POST and still a read: it renders a preview of content
 * the caller already holds and persists nothing.
 *
 * `pullChanges` is a write. It rewrites the workspace tree from the remote;
 * that it destroys rather than creates does not make it an observation.
 */
const CONTENT_METHOD_ACCESS = {
  getContent: 'read',
  getLocalized: 'read',
  createContent: 'write',
  updateLocalized: 'write',
  deleteContent: 'write',
  deleteLocalized: 'write',
  getSitePages: 'read',
  getPageByPathname: 'read',
  isPathnameAvailable: 'read',
  movePage: 'write',
  getFragments: 'read',
  getFragmentByName: 'read',
  compileMDX: 'read',
  getData: 'read',
  getDataByName: 'read',
  isDataNameAvailable: 'read',
  getDataCollections: 'read',
  listAllContent: 'read',
  findUntranslatedContent: 'read',
  getSitesConfig: 'read',
  batchUpdate: 'write',
  getGitStatus: 'read',
  commitChanges: 'write',
  pushChanges: 'write',
  pullChanges: 'write',
  listAssets: 'read',
  getAsset: 'read',
  uploadAsset: 'write',
  importAssetUrl: 'write',
  deleteAsset: 'write',
  listFolder: 'read',
  createFolder: 'write',
  updateAssetMetadata: 'write',
  getAssetUsage: 'read',
  moveAssets: 'write',
  getFolderTree: 'read',
  getCurrentUser: 'read',
} as const satisfies Record<keyof ContentAPIClient, ContentMethodAccess>;

/** The classification above, for anything that needs to enumerate it (the tests do). */
export const CONTENT_METHOD_CLASSIFICATION: Readonly<Record<string, ContentMethodAccess>> = CONTENT_METHOD_ACCESS;

/**
 * A write the editor refused because the account may not write right now.
 *
 * Carries the refusal rather than a bare string so a surface that catches it
 * can show the reader the same sentence the host wrote, instead of inventing
 * its own guess at what went wrong.
 */
export class ContentWriteRefusedError extends Error {
  /** The content-API method that was refused, for logs. */
  readonly method: string;
  readonly refusal: EditorWriteRefusal;

  constructor(method: string, refusal: EditorWriteRefusal) {
    super(refusal.reason);
    this.name = 'ContentWriteRefusedError';
    this.method = method;
    this.refusal = refusal;
  }
}

const WRITABLE: EditorWriteAccess = Object.freeze({ writable: true });

/**
 * What the editor may do to content right now.
 *
 * Absence of {@link UIConfig.readOnly} is the ONLY writable answer, so a host
 * that never learned about this seam gets today's behaviour exactly, and a
 * host that sets it cannot set it without a reason.
 */
export function editorWriteAccess(config: UIConfig = getUIConfig()): EditorWriteAccess {
  const refusal = config.readOnly;
  return refusal === undefined ? WRITABLE : { writable: false, refusal };
}

/**
 * Wrap the content client so every write consults {@link editorWriteAccess}
 * and every read goes straight through.
 *
 * This is the whole enforcement, in one place. The alternative — teaching
 * each of the dozen mutating surfaces to check first — leaves the next
 * surface someone writes ungated by default, and a gate you have to remember
 * is not a gate. Editing surfaces still MOUNT and still render their content:
 * the person editing still sees everything they would get back by regaining
 * write access, and the published site is unaffected by any of this.
 *
 * The access is read at CALL time, not at wrap time: the host app's answer
 * can land over the network long after the editor mounts, and a write
 * attempted one second after the account was restricted must be refused, not
 * waved through by a stale snapshot.
 *
 * The wrapper delegates through the prototype chain, so it stays an
 * `instanceof ContentAPIClient` and reads cost one extra property lookup.
 */
export function guardContentWrites(client: ContentAPIClient): ContentAPIClient {
  const guarded: ContentAPIClient = Object.create(client);
  for (const [method, classification] of Object.entries(CONTENT_METHOD_ACCESS)) {
    if (classification !== 'write') continue;
    const original: unknown = Reflect.get(client, method);
    // A method the client does not have cannot be called, so there is nothing
    // to refuse — this is a total answer, not a tolerated gap. Hosts hand in
    // their own `contentClient` (`UIConfig.contentClient`), and a narrower one
    // than the full surface is ordinary: crashing the editor mount over a
    // method nobody can reach would take the whole editor away from the
    // reader this gate exists to keep reading. The exhaustive
    // classification above is what guarantees no REACHABLE write is
    // unclassified.
    if (typeof original !== 'function') continue;
    Object.defineProperty(guarded, method, {
      value: (...args: unknown[]): unknown => {
        const access = editorWriteAccess();
        if (access.writable) return original.apply(client, args);
        return Promise.reject(new ContentWriteRefusedError(method, access.refusal));
      },
      writable: false,
      enumerable: false,
      configurable: false,
    });
  }
  return guarded;
}
