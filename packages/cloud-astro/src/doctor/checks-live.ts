import { resolveBuildRef, resolveRepositoryUri } from '../git.js';
import { messageOf } from '../message-of.js';
import { resolveBuildSiteId } from '../site-id.js';
import { ENDPOINT_ENV_VAR, INTEGRATION_NOT_CALLED, suppliedBuildToken, suppliedEndpoint } from './checks-offline.js';
import { type ConfigScan, optionLiteral } from './config-scan.js';
import {
  type CheckId,
  type CheckOutcome,
  type CloudDoctorContext,
  type DoctorDeps,
  outcomeOf,
  skipped,
} from './types.js';

const LIVE_CHECK_IDS: readonly CheckId[] = ['CC5', 'CC6', 'CC7'];

/** Every doctor request is bounded: a hanging host must never hang `conloca doctor` (the CLI seam has no timer of its own). */
const REQUEST_TIMEOUT_MS = 10_000;

/** One row of the endpoint's status route (`GET /api/v1/registrations/status`). */
interface StatusRegistration {
  /**
   * Absent on the wire for active rows; true for an older row with no site id yet, which becomes active the next
   * time the editor opens.
   */
  parked?: boolean;
  branch: string;
  siteId: string | null;
  gitSha: string;
  registeredAt: number;
  editorBundleUrl: string;
}

interface StatusResponse {
  defaultBranch: string | null;
  registrations: StatusRegistration[];
}

interface LiveInput {
  context: CloudDoctorContext;
  deps: DoctorDeps;
  scan: ConfigScan;
  /** CC2's verdict: the token once it parses; undefined when missing or malformed. */
  token: string | undefined;
  /** CC3's verdict: the endpoint once it parses as a URL. */
  endpoint: string | undefined;
}

const skipAll = (reason: string): CheckOutcome[] => LIVE_CHECK_IDS.map((id) => skipped(id, reason));

function isStatusRegistration(value: unknown): value is StatusRegistration {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.branch === 'string' &&
    typeof row.gitSha === 'string' &&
    typeof row.editorBundleUrl === 'string' &&
    typeof row.registeredAt === 'number' &&
    (row.siteId === null || typeof row.siteId === 'string') &&
    (row.parked === undefined || typeof row.parked === 'boolean')
  );
}

/** Every field the checks read, so an endpoint drift fails CC5 loudly instead of surfacing as a broken CC6/CC7. */
function isStatusResponse(value: unknown): value is StatusResponse {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as Record<string, unknown>;
  return (
    (body.defaultBranch === null || typeof body.defaultBranch === 'string') &&
    Array.isArray(body.registrations) &&
    body.registrations.every(isStatusRegistration)
  );
}

type StatusProbe = { outcome: CheckOutcome } & ({ body: StatusResponse } | { skipReason: string });

interface StatusTarget {
  token: string;
  endpoint: string;
  repoUri: string;
}

function statusFailed(outcome: CheckOutcome, message: string, skipReason: string): StatusProbe {
  outcome.problems.push({ check: 'CC5', level: 'error', message });
  return { outcome, skipReason };
}

/**
 * CC5 — GET the status route with the token, joining the path exactly as the
 * build does (register.ts) so --live reproduces the build's own request. 200
 * and 401 both prove reachability; only 200 yields rows.
 */
async function probeStatus(fetchFn: DoctorDeps['fetch'], target: StatusTarget): Promise<StatusProbe> {
  const outcome = outcomeOf('CC5');
  const url = `${target.endpoint}/api/v1/registrations/status?repoUri=${encodeURIComponent(target.repoUri)}`;
  let response: Response;
  try {
    response = await fetchFn(url, {
      headers: { authorization: `Bearer ${target.token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    return statusFailed(
      outcome,
      `endpoint ${target.endpoint} is unreachable (${messageOf(error)}) — check the endpoint option and network access from this machine`,
      'the endpoint is unreachable',
    );
  }
  if (response.status === 401) {
    return statusFailed(
      outcome,
      'the build token is rejected by the endpoint — most likely rotated (a new token invalidates the old one); create a new token and update the CI secret — or the endpoint predates the registration status route, in which case update the endpoint first',
      'the endpoint rejected the build token',
    );
  }
  if (response.status === 403) {
    return statusFailed(
      outcome,
      `the token does not cover ${target.repoUri} — give the endpoint access to that repository or fix repoUri`,
      'the repository is not covered by the token',
    );
  }
  if (!response.ok) {
    return statusFailed(
      outcome,
      `endpoint answered HTTP ${response.status} for the registration status — the endpoint may predate this check; update it or retry`,
      `the status route answered HTTP ${response.status}`,
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return statusFailed(
      outcome,
      'the endpoint answered 200 but not with JSON — does endpoint point at the site itself instead of the editor endpoint?',
      'the endpoint did not answer with JSON',
    );
  }
  if (!isStatusResponse(body)) {
    return statusFailed(
      outcome,
      'the registration status response has an unexpected shape — update the endpoint or this package',
      'the status response was unreadable',
    );
  }
  outcome.detail = `${target.endpoint} reachable — ${body.registrations.length} registration(s) for ${target.repoUri}`;
  return { outcome, body };
}

/** CC6 — own row → probe; default-branch row → warn + probe; neither → error. Returns the row the editor would load. */
function diagnoseRegistrations(
  body: StatusResponse,
  branch: string | undefined,
  siteId: string,
): { outcome: CheckOutcome; row: StatusRegistration | undefined } {
  const outcome = outcomeOf('CC6');
  if (!branch) {
    outcome.problems.push({
      check: 'CC6',
      level: 'warn',
      message:
        'could not determine the current branch (detached HEAD?) — set CF_PAGES_BRANCH or GITHUB_REF_NAME, or check out a branch',
    });
    return { outcome, row: undefined };
  }
  // Newest first, whatever order the route returned: the editor loads the newest row.
  const live = body.registrations.filter((row) => row.parked !== true).sort((a, b) => b.registeredAt - a.registeredAt);
  // Activation is branch-scoped, so only rows parked for THIS branch say anything about it. They carry no siteId:
  // the site stays undetermined until the editor's next open reads the branch's tree.
  const parkedHere = body.registrations.filter((row) => row.parked === true && row.branch === branch);
  // A branch without its own row is served by the default branch's row for that site — the editor's own lookup
  // rule, which reads an empty default branch as none (the route relays the repository record as is).
  const defaultBranch = body.defaultBranch === '' ? null : body.defaultBranch;
  const inheritable = defaultBranch !== null && defaultBranch !== branch;
  const own = live.find((row) => row.branch === branch && row.siteId === siteId);
  const inherited =
    own === undefined && inheritable
      ? live.find((row) => row.branch === defaultBranch && row.siteId === siteId)
      : undefined;
  const details: string[] = [];
  if (own) {
    details.push(`site "${siteId}": own registration ${own.gitSha}`);
  } else if (inherited) {
    outcome.problems.push({
      check: 'CC6',
      level: 'warn',
      message: `site "${siteId}": no registration for branch ${branch} — the editor inherits the default branch's (${defaultBranch}) registration; it works, preview is degraded. Build ${branch} with the token to register it`,
    });
  } else if (parkedHere.length > 0) {
    // The next editor open activates these rows, so the editor does load. It only fails when the branch has since
    // grown a second site, which the doctor cannot foresee: resolveBuildSiteId answers with one id, never a count.
    outcome.problems.push({
      check: 'CC6',
      level: 'warn',
      message: `site "${siteId}": no active registration serves branch ${branch} — ${parkedHere.length} older registration(s) for it become active the next time the editor opens, unless this branch now declares more than one site (the editor answers 409 then). Build ${branch} with CONLOCA_BUILD_TOKEN set to replace them`,
    });
  } else {
    const fallback = inheritable ? ` (nor the default branch ${defaultBranch})` : '';
    outcome.problems.push({
      check: 'CC6',
      level: 'error',
      message: `site "${siteId}": no registration serves branch ${branch}${fallback} — the editor will not load; build ${branch} with CONLOCA_BUILD_TOKEN set`,
    });
  }
  // Only a footnote when something already serves the branch; the parked-only warning above carries the count itself.
  if (parkedHere.length > 0 && (own ?? inherited)) {
    details.push(
      `${parkedHere.length} older registration(s) not active yet — they become active the next time the editor opens`,
    );
  }
  if (details.length > 0) outcome.detail = details.join('; ');
  return { outcome, row: own ?? inherited };
}

/** HEAD the URL; a host that refuses HEAD (405/501) gets a GET. */
async function reachable(
  fetchFn: DoctorDeps['fetch'],
  url: string,
): Promise<{ ok: true } | { ok: false; answer: string }> {
  try {
    let response = await fetchFn(url, { method: 'HEAD', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (response.status === 405 || response.status === 501) {
      // A one-byte range keeps the probe from downloading the whole bundle; the 206 it earns is `ok`.
      response = await fetchFn(url, {
        method: 'GET',
        headers: { range: 'bytes=0-0' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    }
    return response.ok ? { ok: true } : { ok: false, answer: `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, answer: `unreachable (${messageOf(error)})` };
  }
}

/** CC7 — the bundle a registration names must still be deployed: the row serving this branch needs its bytes. */
async function probeBundle(
  siteId: string,
  row: StatusRegistration | undefined,
  localSha: string | undefined,
  fetchFn: DoctorDeps['fetch'],
): Promise<CheckOutcome> {
  if (row === undefined) return skipped('CC7', 'no registration to probe');
  const outcome = outcomeOf('CC7');
  const result = await reachable(fetchFn, row.editorBundleUrl);
  if (!result.ok) {
    outcome.problems.push({
      check: 'CC7',
      level: 'error',
      message: `site "${siteId}": the registration for ${row.branch} points at deleted editor assets — ${row.editorBundleUrl} answers ${result.answer} (a later deploy replaced them); rebuild and deploy from ${row.branch}`,
    });
  } else if (localSha && localSha !== row.gitSha) {
    outcome.detail = `site "${siteId}": registered ${row.gitSha.slice(0, 7)}, local HEAD ${localSha.slice(0, 7)} — the editor at the endpoint lags this checkout`;
  } else {
    outcome.detail = `site "${siteId}": ${row.editorBundleUrl} reachable`;
  }
  return outcome;
}

/** CC5–CC7. Networks only under --live, and the token goes ONLY to the configured endpoint. */
export async function runLiveChecks(input: LiveInput): Promise<CheckOutcome[]> {
  const { context, deps, scan, token, endpoint } = input;
  if (!context.live) return skipAll('live checks run only with --live');
  // The live trio diagnoses this integration: an unwired one is the reason, exactly as CC2/CC3 say.
  if (scan.kind === 'read' && scan.config.conlocaCloud === 'absent') return skipAll(INTEGRATION_NOT_CALLED);
  if (token === undefined) {
    // CC2 already said why a supplied token is unusable; only a missing one gets the how-to here.
    return skipAll(
      suppliedBuildToken(scan, deps.env) === undefined
        ? 'no build token — set CONLOCA_BUILD_TOKEN'
        : 'no usable build token (see CC2)',
    );
  }
  if (endpoint === undefined) {
    // Likewise CC3 already said why a supplied endpoint is unusable.
    return skipAll(
      suppliedEndpoint(scan, deps.env) === undefined
        ? `endpoint could not be determined — set ${ENDPOINT_ENV_VAR}`
        : 'no usable endpoint (see CC3)',
    );
  }
  // The doctor diagnoses the project it was handed, not whatever checkout the CLI happens to be standing in:
  // `conloca doctor ./site` from a wrapper repo would otherwise read that repo's branch and call the site broken.
  const git = (args: string[]) => deps.git(args, context.projectDir);
  const repoUri = resolveRepositoryUri(optionLiteral(scan, 'repoUri'), deps.env, git);
  if (repoUri === undefined) {
    return skipAll(
      'repository identity could not be determined — build in a CI environment or Git checkout, or set repoUri',
    );
  }

  const status = await probeStatus(deps.fetch, { token, endpoint, repoUri });
  if (!('body' in status)) {
    return [status.outcome, skipped('CC6', status.skipReason), skipped('CC7', status.skipReason)];
  }

  let siteId: string;
  try {
    siteId = resolveBuildSiteId({
      contentRoot: context.contentRoot,
      override: optionLiteral(scan, 'siteId'),
      readFile: deps.readFile,
    });
  } catch (error) {
    const outcome = outcomeOf('CC6');
    outcome.problems.push({ check: 'CC6', level: 'error', message: messageOf(error) });
    return [status.outcome, outcome, skipped('CC7', 'the site id could not be resolved')];
  }
  const ref = resolveBuildRef(deps.env, git);
  const diagnosis = diagnoseRegistrations(status.body, ref.branch, siteId);
  return [status.outcome, diagnosis.outcome, await probeBundle(siteId, diagnosis.row, ref.gitSha, deps.fetch)];
}
