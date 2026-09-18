import { PACKAGE_NAME } from './constants.js';

/**
 * Registration request (`POST {endpoint}/api/v1/registrations`). Auth is the
 * build token (`cbt_<id>.<secret>`) the endpoint issued; the body carries build
 * metadata only.
 */
export interface RegistrationInput {
  /** Editor endpoint, e.g. 'https://cms.example.com'. */
  endpoint: string;
  /** Build token sent as `Authorization: Bearer <token>`. */
  buildToken: string;
  /** Auto-detected `owner/repo` identity of the build checkout. */
  repoUri: string;
  gitSha: string;
  branch: string;
  /** Deployable-site id (top-level siteId in the content root's
   *  sites.json, or the implicit 'default' for a zero-config repo). Resolved at
   *  build via resolveBuildSiteId — registration attaches, never defines. */
  siteId: string;
  /** Absolute URL the editor fetches the bundle from. */
  editorBundleUrl: string;
  /** Full sha-256 hex of the bundle bytes; the editor refuses non-matching bytes. */
  bundleHash: string;
  /** Absolute URL of the companion canvas stylesheet; absent when the config graph has no styles. */
  stylesheetUrl?: string;
  /** Full sha-256 hex of the stylesheet bytes; the editor skips non-matching bytes (fail-soft). */
  stylesheetHash?: string;
  /**
   * Discovered content-wrapper shape of the fragmentPreviewRoute — inline
   * because it is well under 1 KB; a URL+hash would add a
   * fetch and a verification for nothing.
   */
  hostWrappers?: { content: { tagName: string; className: string } | null; codeBlock: unknown };
  /** Absolute URL of the discovery route's collected CSS; same artifact pattern as stylesheetUrl. */
  routeCssUrl?: string;
  /** Full sha-256 hex of the route-CSS bytes; the editor skips non-matching bytes (fail-soft). */
  routeCssHash?: string;
  /** Absolute URL of the build's component manifest; same artifact pattern as stylesheetUrl. */
  componentManifestUrl?: string;
  /** Full sha-256 hex of the manifest bytes; a reader refuses non-matching bytes. */
  componentManifestHash?: string;
  deploymentUrl?: string;
  deploymentProvider?: string;
  /**
   * The commit the artifact was actually built from; differs from gitSha only when CI hands over the branch's
   * latest commit.
   */
  buildId?: string;
  /**
   * The `@conloca/cloud-astro` version that produced this build, so the endpoint and the doctor can say which
   * package version built the editor bundle.
   */
  clientVersion?: string;
}

export interface RegistrationResult {
  /** Per-branch preview secret consumed by the recursive preview build. */
  previewSecret: string;
}

/**
 * The minimal fetch surface this module relies on. A narrow seam (matching
 * `PreviewBuildSpawn` in preview-build.ts) lets tests pass a tiny fake
 * without reconstructing the full `fetch` typing.
 */
export type RegistrationFetch = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string },
) => Promise<Response>;

const INITIAL_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;
const RETRY_BUDGET_MS = 180_000;

/**
 * Backoff before each retry; length + 1 = total attempts. Starts at 1 s,
 * doubles to a 30 s ceiling and stops before the waits alone exceed the
 * budget: an endpoint that has just been set up can answer 503 for a while,
 * and a budget of about a second gives up long before it settles.
 */
export function _registrationRetryDelays(): number[] {
  const delays: number[] = [];
  let next = INITIAL_RETRY_MS;
  let total = 0;
  while (total + next <= RETRY_BUDGET_MS) {
    delays.push(next);
    total += next;
    next = Math.min(next * 2, MAX_RETRY_MS);
  }
  return delays;
}

const DEFAULT_RETRY_DELAYS_MS: readonly number[] = _registrationRetryDelays();

/**
 * POSTs the registration to the endpoint and returns the per-branch preview
 * secret. Network errors and 5xx responses are retried with exponential
 * backoff (1 s doubling to 30 s, ten attempts within a three-minute wait
 * budget); 4xx responses throw immediately with the response body so
 * the caller can surface the exact rejection reason (e.g. an invalid token).
 */
export async function postRegistration(input: RegistrationInput): Promise<RegistrationResult> {
  return _postRegistrationWith((url, init) => fetch(url, init), input);
}

/**
 * Internal seam that takes the fetch function (and retry backoff) as
 * parameters so tests can substitute fakes. Public callers should use
 * {@link postRegistration}.
 *
 * Exported with a leading underscore to signal that this is an internal API
 * and not part of the package's public surface.
 */
export async function _postRegistrationWith(
  fetchFn: RegistrationFetch,
  input: RegistrationInput,
  retryDelaysMs: readonly number[] = DEFAULT_RETRY_DELAYS_MS,
): Promise<RegistrationResult> {
  const url = `${input.endpoint}/api/v1/registrations`;
  const init = {
    method: 'POST' as const,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${input.buildToken}`,
    },
    // JSON.stringify drops undefined optional fields, matching the endpoint's
    // "optional means absent" reading of the body.
    body: JSON.stringify({
      repoUri: input.repoUri,
      gitSha: input.gitSha,
      branch: input.branch,
      siteId: input.siteId,
      editorBundleUrl: input.editorBundleUrl,
      bundleHash: input.bundleHash,
      stylesheetUrl: input.stylesheetUrl,
      stylesheetHash: input.stylesheetHash,
      hostWrappers: input.hostWrappers,
      routeCssUrl: input.routeCssUrl,
      routeCssHash: input.routeCssHash,
      componentManifestUrl: input.componentManifestUrl,
      componentManifestHash: input.componentManifestHash,
      deploymentUrl: input.deploymentUrl,
      deploymentProvider: input.deploymentProvider,
      buildId: input.buildId,
      clientVersion: input.clientVersion,
    }),
  };

  const attempts = retryDelaysMs.length + 1;
  let lastFailure = '';
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0 && retryDelaysMs[attempt - 1] > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt - 1]));
    }
    let response: Response;
    try {
      response = await fetchFn(url, init);
    } catch (error) {
      // Network-level failure (endpoint unreachable, DNS, reset) — retry.
      lastFailure = error instanceof Error ? error.message : String(error);
      continue;
    }
    if (response.ok) {
      const payload = (await response.json().catch(() => null)) as { previewSecret?: unknown } | null;
      if (typeof payload?.previewSecret !== 'string' || payload.previewSecret === '') {
        throw new Error(`${PACKAGE_NAME}: registration response is missing previewSecret`);
      }
      return { previewSecret: payload.previewSecret };
    }
    const text = await response.text().catch(() => '');
    if (response.status < 500) {
      // 4xx is deterministic (bad token, repo not covered, malformed body) —
      // retrying cannot help, and the body carries the exact reason.
      throw new Error(`${PACKAGE_NAME}: registration rejected: HTTP ${response.status} ${text}`);
    }
    lastFailure = `HTTP ${response.status} ${text}`;
  }
  throw new Error(`${PACKAGE_NAME}: registration failed after ${attempts} attempts: ${lastFailure}`);
}
