/**
 * Lifecycle scope of a media asset when a host app works on
 * branches. cms-spa's renderer-neutral `AssetEntry` (in
 * `content-api/asset-types.ts`) doesn't model this — branch vs
 * published is meaningful only when an asset lives in a working
 * tree separate from the published default branch.
 *
 * A host app surfaces the distinction through
 * `UIConfig.mediaBridge.getAssetScope`. cms-spa's media surfaces
 * (AssetCard, AssetDetailSidebar) paint a "Branch only" /
 * "Published" pill based on the bridge's reply. When no bridge is
 * installed (local Astro dev, astro-cms standalone), the pill is
 * hidden — surfaces render exactly as they did before.
 *
 * - `branch` — exists only on this branch's working tree. The
 *   published site cannot see it until it is published.
 * - `published` — on the site's default branch and visible from
 *   every branch.
 */
export type AssetScope = 'branch' | 'published';

/**
 * Standing media issue a host app reports alongside the
 * `AssetScope` pill. Distinct from the outcome of a single call:
 * an issue here is a property OF the asset that persists until
 * the user resolves it.
 *
 * cms-spa's renderer-neutral asset model doesn't carry these
 * fields because astro-cms on its own has no notion of them —
 * they're host state a host app exposes through
 * `UIConfig.mediaBridge.getMediaIssue`.
 *
 * - `oversized` — the host says the file is over its size limit.
 *   The asset is still served. Surface paints an amber warning.
 * - `blocked` — the host is holding the content back, for the
 *   given `reason`. Surface paints a red error with that reason.
 *
 * Both variants carry `filename` so flat lists are self-joinable
 * to the user's dirty page set without a second lookup.
 */
export type MediaIssue =
  | { kind: 'oversized'; filename: string; sizeBytes: number; limitBytes: number }
  | { kind: 'blocked'; filename: string; reason: string };

/**
 * Bridge cms-spa uses to read host-supplied metadata about media
 * assets that cms-spa's renderer-neutral model doesn't carry.
 * Installed by a host app via `UIConfig.mediaBridge` before
 * rendering `<CmsSpaApp />`; cms-spa never reaches into the host
 * app's own client directly.
 *
 * The bridge is optional in `UIConfig` — absence means "no host
 * wiring," in which case cms-spa surfaces degrade cleanly (no
 * scope pill, no host-side hooks fire).
 */
export interface MediaBridge {
  /**
   * Resolve the lifecycle scope of a single asset. Called by
   * AssetCard / AssetDetailSidebar whenever they need to render
   * the scope pill. Returns `null` when the host has no opinion
   * (asset unknown to the host, pre-bootstrap state, or no host
   * app at all); the surface treats `null` the same as
   * "no bridge" — pill hidden.
   *
   * `folder` tells same-named assets in different folders apart, so
   * a subfolder asset never borrows a root asset's scope. Optional
   * for backward compatibility (absent ⇒ root); consumers pass the
   * asset's own folder.
   *
   * The host is responsible for caching: cms-spa calls this
   * synchronously-from-the-surface's-POV via TanStack so
   * repeated renders don't refetch. A host app typically wraps
   * its own lookup in a cached query so the resolved scope is
   * memoised.
   */
  getAssetScope(input: { filename: string; folder?: string }): Promise<AssetScope | null>;
  /**
   * Resolve the standing media issue for a single asset, or `null`
   * when the asset is healthy. Called by AssetCard /
   * AssetDetailSidebar whenever they paint the per-asset
   * error/warning badge.
   *
   * `folder` tells same-named assets apart the same way
   * `getAssetScope` does, so an issue with `uploads/hero.jpg`
   * never badges a root `hero.jpg`. Optional (absent ⇒ root).
   *
   * Returns `null` for the same reasons as `getAssetScope`: host
   * has no opinion (asset unknown, pre-bootstrap state, no host
   * app). Surfaces treat `null` the same as "no bridge" — badge
   * hidden, `AssetEntry` rendered unchanged.
   *
   * The host caches the lookup so cms-spa's `useMediaIssue` wrapper
   * doesn't have to think about per-asset cache windows.
   */
  getMediaIssue(input: { filename: string; folder?: string }): Promise<MediaIssue | null>;
}
