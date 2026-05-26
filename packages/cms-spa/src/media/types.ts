/**
 * Lifecycle scope of a media asset in a hosted-mode (branch-aware)
 * context. cms-spa's renderer-neutral `AssetEntry` (in
 * `content-api/asset-types.ts`) doesn't model this — branch vs
 * published is meaningful only when an asset lives in a working
 * tree separate from the published default branch.
 *
 * The hosted shell surfaces the distinction through
 * `UIConfig.mediaBridge.getAssetScope`. cms-spa's media surfaces
 * (AssetCard, AssetDetailSidebar) paint a "Branch only" /
 * "Published" pill based on the bridge's reply. When no bridge is
 * installed (local Astro dev, astro-cms standalone), the pill is
 * hidden — surfaces render exactly as they did before.
 *
 * - `branch` — exists only on this branch's working tree. Needs
 *   promotion before the published site can see it.
 * - `published` — promoted into the org's default branch and
 *   visible from every branch.
 */
export type AssetScope = 'branch' | 'published';

/**
 * Standing media issue surfaced by the host shell alongside the
 * `AssetScope` pill. Distinct from a per-call promote outcome:
 * an issue here is a property OF the asset that persists until
 * the customer resolves it.
 *
 * cms-spa's renderer-neutral asset model doesn't carry these
 * fields because the local-Astro case has no notion of upload
 * limits or media scanning — they're hosted-mode state the
 * host exposes through `UIConfig.mediaBridge.getMediaIssue`.
 *
 * - `oversized` — file exceeds the inline-blob limit. The asset
 *   is still served, just slower than it should be. Surface
 *   paints an amber warning with "move to media storage"
 *   guidance.
 * - `blocked` — content is held back by the passthrough scanner
 *   (malware, EXIF leak, policy violation). Preview falls back
 *   to a placeholder; publishing is hard-blocked until resolved.
 *   Surface paints a red error with the scanner's reason.
 *
 * Both variants carry `filename` so flat lists are self-joinable
 * to the user's dirty page set without a second lookup.
 */
export type MediaIssue =
  | { kind: 'oversized'; filename: string; sizeBytes: number; limitBytes: number }
  | { kind: 'blocked'; filename: string; reason: string };

/**
 * Bridge cms-spa uses to read host-shell-supplied metadata about
 * media assets that cms-spa's renderer-neutral model doesn't carry.
 * Installed by the host shell via `UIConfig.mediaBridge` before
 * rendering `<CmsSpaApp />`; cms-spa never reaches for the
 * HostClient directly.
 *
 * The bridge is optional in `UIConfig` — absence means "no host
 * wiring," in which case cms-spa surfaces degrade cleanly (no
 * scope pill, no host-side hooks fire). Mirrors the
 * `ConflictBridge` pattern used for the conflict-resolution
 * session.
 */
export interface MediaBridge {
  /**
   * Resolve the lifecycle scope of a single asset. Called by
   * AssetCard / AssetDetailSidebar whenever they need to render
   * the scope pill. Returns `null` when the host has no opinion
   * (asset unknown to the host, pre-bootstrap state, or a
   * non-hosted mount); the surface treats `null` the same as
   * "no bridge" — pill hidden.
   *
   * The host is responsible for caching: cms-spa calls this
   * synchronously-from-the-surface's-POV via TanStack so
   * repeated renders don't refetch. The bridge implementation
   * (in the host shell) wraps its client's `getAssetScope`
   * call in a `useQuery` so the resolved scope is memoised.
   */
  getAssetScope(input: { filename: string }): Promise<AssetScope | null>;
  /**
   * Resolve the standing media issue for a single asset, or `null`
   * when the asset is healthy. Called by AssetCard /
   * AssetDetailSidebar whenever they paint the per-asset
   * error/warning badge.
   *
   * Returns `null` for the same reasons as `getAssetScope`: host
   * has no opinion (asset unknown, pre-bootstrap state, non-hosted
   * mount). Surfaces treat `null` the same as "no bridge" — badge
   * hidden, `AssetEntry` rendered unchanged.
   *
   * The host caches the lookup so cms-spa's `useMediaIssue` wrapper
   * doesn't have to think about per-asset cache windows.
   */
  getMediaIssue(input: { filename: string }): Promise<MediaIssue | null>;
}
