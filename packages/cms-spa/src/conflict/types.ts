/**
 * Conflict-resolution session types — the cms-spa side of the
 * boundary contract.
 *
 * These mirror the shape of `ConflictResolutionSession` (and its
 * supporting types) in the hosted service host shell. The host shell
 * fetches the session from the Branch DO via its HostClient and
 * passes it into cms-spa through `UIConfig.conflictBridge`. The
 * shapes here intentionally use TypeScript structural typing — the
 * host shell's types align by structure, not by name, so we never
 * have to import across the host-shell ↔ cms-spa boundary.
 *
 * When the backend ships the Branch DO conflict-resolution document,
 * its wire shape MUST match this set; the host contract's
 * "Marketing-Friendly Conflict Resolution" section is the source of
 * truth. Renaming these locally without updating the spec breaks the
 * host's bridge wiring.
 */

/**
 * One disagreement on a single VXJSON field (structured content).
 * The picker UI renders one row per FieldConflict.
 */
export interface FieldConflict {
  /** Dot-separated path to the conflicted field (e.g. `'hero.title'`). */
  path: string;
  /** Human-friendly field name resolved from the page's schema. */
  label: string;
  /** The two competing values. Type is `unknown` — the schema-driven renderer interprets each side. */
  yours: unknown;
  theirs: unknown;
  /** Display name for the "yours" side label. Falls back to a generic when absent. */
  yoursAuthor?: string;
  theirsAuthor?: string;
}

/**
 * One disagreement on a single MDX block (prose). The picker UI
 * renders one side-by-side diff per BlockConflict.
 */
export interface BlockConflict {
  /** Position in the source MDX block sequence. */
  blockIndex: number;
  /** The two competing serialized strings. Hydrated through the MDX pipeline. */
  yoursMdx: string;
  theirsMdx: string;
  yoursAuthor?: string;
  theirsAuthor?: string;
}

/**
 * One page held back by the Branch DO's semantic merge. Always one
 * of `vxjson` (structured content with field-level conflicts) or
 * `mdx` (prose with block-level conflicts) — mixed pages are
 * deferred per the host contract.
 */
export type ConflictPage =
  | {
      kind: 'vxjson';
      pageId: string;
      locale: string;
      pageLabel: string;
      fields: FieldConflict[];
    }
  | {
      kind: 'mdx';
      pageId: string;
      locale: string;
      pageLabel: string;
      blocks: BlockConflict[];
    };

/**
 * One user resolution for a conflicted field or block.
 *
 * - `accept-yours` / `accept-theirs` — pick one side verbatim.
 * - `custom` — user edited the value (VXJSON) or block prose (MDX).
 *   `value` carries the resolved value so the backend doesn't have
 *   to re-derive it.
 */
export type ResolutionDecision =
  | { kind: 'accept-yours' }
  | { kind: 'accept-theirs' }
  | { kind: 'custom'; value: unknown };

/**
 * In-progress (or completed) decisions for one page. Keys are
 * `FieldConflict.path` (VXJSON) or stringified `BlockConflict.blockIndex`
 * (MDX).
 */
export type ConflictDecisionMap = Record<string, ResolutionDecision>;

/**
 * Full resolution session — one per branch at a time in Phase 1.
 *
 * - `sessionId` — opaque id; submission targets this id.
 * - `pages` — every held-back page in the session. Non-empty when the
 *   session exists; the bridge reports `null` for "no session".
 * - `decisions` — persisted per-page decision maps, keyed by
 *   `<pageId>:<locale>`. The Branch DO holds the canonical copy;
 *   cms-spa syncs on entry and on each decision.
 * - `createdAt` — ISO-8601 timestamp the session opened.
 */
export interface ConflictResolutionSession {
  sessionId: string;
  pages: ConflictPage[];
  decisions: Record<string, ConflictDecisionMap>;
  createdAt: string;
}

/**
 * Bridge cms-spa uses to talk to the host shell about conflict
 * sessions. The host shell installs this via `UIConfig.conflictBridge`
 * before rendering `<CmsSpaApp />`; cms-spa never reaches for the
 * HostClient directly. The bridge is optional in `UIConfig` —
 * absence means "no host wiring," in which case cms-spa renders an
 * "All clear" empty state and disables submit / abandon.
 */
export interface ConflictBridge {
  /** Resolves to the active session, or `null` when nothing is held back. */
  getActiveSession(): Promise<ConflictResolutionSession | null>;
  /**
   * Submit the user's decisions. The host shell forwards to its
   * `HostClient.submitConflictResolution` and on success returns the
   * post-commit status (the resolver UI doesn't need it directly —
   * the host's sync popover surfaces the new state). cms-spa
   * surfaces inline errors when this rejects.
   */
  submit(input: { sessionId: string; decisions: Record<string, ConflictDecisionMap> }): Promise<void>;
  /** Abandon the session — discards in-progress decisions, keeps the held-back set intact. */
  abandon(input: { sessionId: string }): Promise<void>;
}
