/** Test seams for the doc shape; never set outside tests. */
export interface YdocHooks {
  /** Replaces `HYDRATION_VERSION` in the hydration clientID. */
  hydrationVersion?: number;
  /** Rewrites the digest input of a hydrated item id (`listPath\nindex\nsalt`), to force collisions. */
  itemDigestInput?: (input: string) => string;
  /** Rewrites the digest input of a list ref (`name\nsalt`), to force collisions. */
  refDigestInput?: (input: string) => string;
  /** Replaces one random item-id draw. */
  randomId?: () => string;
}

/** The hooks the doc shape reads; not exported from the package. */
export const ydocHooks: YdocHooks = {};
