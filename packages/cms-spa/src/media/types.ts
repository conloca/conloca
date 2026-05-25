/**
 * Lifecycle scope of a media asset in a hosted hosted branch service
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
 * Bridge cms-spa uses to read host-shell-supplied metadata about
 * media assets that cms-spa's renderer-neutral model doesn't carry.
 * Installed by the host shell via `UIConfig.mediaBridge` before
 * rendering `<CmsSpaApp />`; cms-spa never reaches for the
 * HostClient directly.
 *
 * The bridge is optional in `UIConfig` — absence means "no host
 * wiring," in which case cms-spa surfaces degrade cleanly (no
 * scope pill, no host-side hooks fire). Mirrors the
 * `ConflictBridge` pattern that GL-208 established for the
 * conflict-resolution session.
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
   * (in the host shell) wraps the HostClient's `getAssetScope`
   * call in a `useQuery` so the resolved scope is memoised.
   */
  getAssetScope(input: { filename: string }): Promise<AssetScope | null>;
}
