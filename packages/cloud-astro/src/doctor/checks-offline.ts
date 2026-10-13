import { BUILD_TOKEN_ENV_VAR } from '../constants.js';
import type { RepositoryEnvironment } from '../repository.js';
import { type ConfigScan, hasOption, optionLiteral, type ReadScan } from './config-scan.js';
import { type CheckOutcome, outcomeOf, skipped } from './types.js';

/** Doctor-only override for an endpoint the config computes (e.g. from an env var). */
export const ENDPOINT_ENV_VAR = 'CONLOCA_ENDPOINT';

/** conlocaCMS options only the local dev editor consumes; `templates` reaches the endpoint's editor through the descriptors channel. */
const INERT_AT_ENDPOINT = ['editorStyles', 'editorCSS'] as const;

/**
 * Mirror of the build-token grammar the endpoint issues, duplicated here
 * rather than depending on the endpoint's own code from the site side.
 */
const BUILD_TOKEN_RE = /^cbt_([A-Za-z0-9:_-]+)\.([A-Za-z0-9_-]{43})$/;

const ABSOLUTE_URL_HINT = 'set it to an absolute URL such as https://cms.example.com';
/** Why CC2, CC3 and the live trio skip when the integration is not wired. */
export const INTEGRATION_NOT_CALLED = 'conlocaCloud(...) is not called in the astro config';

function buildTokenOrgId(token: string): string | null {
  return BUILD_TOKEN_RE.exec(token)?.[1] ?? null;
}

/** The build token as supplied — env first, then the config literal. CC2 judges its shape; CC5 only asks whether one exists. */
export function suppliedBuildToken(scan: ConfigScan, env: RepositoryEnvironment): string | undefined {
  return env[BUILD_TOKEN_ENV_VAR] || optionLiteral(scan, 'buildToken') || undefined;
}

/** The endpoint as supplied — config literal first, then CONLOCA_ENDPOINT. CC3 judges its shape; CC5 only asks whether one exists. */
export function suppliedEndpoint(scan: ConfigScan, env: RepositoryEnvironment): string | undefined {
  return optionLiteral(scan, 'endpoint') || env[ENDPOINT_ENV_VAR] || undefined;
}

function isCi(env: RepositoryEnvironment): boolean {
  const value = env.CI;
  return value !== undefined && value !== '' && value !== '0' && value.toLowerCase() !== 'false';
}

function validUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** CC1 — three states for the conlocaCloud call, and the both-integrations rule for conlocaCMS. */
export function checkWiring(scan: ConfigScan): CheckOutcome {
  const outcome = outcomeOf('CC1');
  if (scan.kind === 'none') return skipped('CC1', 'no astro.config found');
  if (scan.kind === 'unreadable') {
    outcome.problems.push({
      check: 'CC1',
      level: 'warn',
      message: `doctor could not read ${scan.path} — check its file permissions`,
      path: scan.path,
    });
    return outcome;
  }
  const { conlocaCloud, conlocaCMS } = scan.config;
  if (conlocaCMS === 'absent') {
    outcome.problems.push({
      check: 'CC1',
      level: 'error',
      message:
        'conlocaCMS(...) is not called in the astro config — conlocaCloud is an add-on to conlocaCMS, keep both in integrations',
      path: scan.config.path,
    });
  }
  outcome.detail =
    conlocaCloud === 'absent'
      ? '@conloca/cloud-astro is installed but conlocaCloud(...) is not detectably called — fine when it is gated off or conditionally spread'
      : conlocaCloud === 'dynamic'
        ? 'conlocaCloud(...) is called with options doctor cannot read as a plain object literal'
        : 'conlocaCloud(...) is called';
  return outcome;
}

/**
 * CC2 — severity by context: under CI a missing token is an error, locally an
 * info. A token literal in the config is always a warning, even when the env
 * var also carries one: the committed secret is the finding.
 */
export function checkBuildToken(
  scan: ConfigScan,
  env: RepositoryEnvironment,
): { outcome: CheckOutcome; token?: string } {
  // A project that installed the package but never wired it gets no CI error about a missing token (CC1 covers the state).
  if (scan.kind === 'read' && scan.config.conlocaCloud === 'absent')
    return { outcome: skipped('CC2', INTEGRATION_NOT_CALLED) };
  const outcome = outcomeOf('CC2');
  const fromConfig = optionLiteral(scan, 'buildToken');
  if (fromConfig !== undefined) {
    outcome.problems.push({
      check: 'CC2',
      level: 'warn',
      message: `buildToken is written into the astro config — move it to the ${BUILD_TOKEN_ENV_VAR} environment variable so the secret is never committed`,
    });
  }
  const token = suppliedBuildToken(scan, env);
  if (!token) {
    if (isCi(env)) {
      outcome.problems.push({
        check: 'CC2',
        level: 'error',
        message: `no build token — set the ${BUILD_TOKEN_ENV_VAR} secret in CI (the endpoint issues it); without it the build skips registration and the editor at the endpoint never updates`,
      });
    } else {
      outcome.detail = 'no build token — a CI secret, not expected locally';
    }
    return { outcome };
  }
  const orgId = buildTokenOrgId(token);
  if (orgId === null) {
    // The endpoint shows and copies the token as a whole `NAME=value` line; pasted as a secret's value, the token
    // inside it is fine, so a new one would not help.
    const assignment = `${BUILD_TOKEN_ENV_VAR}=`;
    outcome.problems.push({
      check: 'CC2',
      level: 'error',
      message: token.startsWith(assignment)
        ? `the build token value starts with "${assignment}" — the whole NAME=value line went into the value; store only the part after "=", which starts with cbt_`
        : 'the build token is malformed — expected cbt_<id>.<43-character secret>; create a new token at the endpoint',
    });
    return { outcome };
  }
  outcome.detail = `token for ${orgId}`;
  return { outcome, token };
}

/** The endpoint from the config literal or CONLOCA_ENDPOINT, once it parses as a URL; a non-https one is advisory. */
function checkEndpoint(
  scan: ReadScan,
  env: RepositoryEnvironment,
  outcome: CheckOutcome,
  details: string[],
): string | undefined {
  const literal = optionLiteral(scan, 'endpoint');
  const fromEnv = env[ENDPOINT_ENV_VAR];
  let endpoint: string;
  if (literal !== undefined) {
    endpoint = literal;
    details.push(`endpoint ${literal}`);
  } else if (fromEnv) {
    endpoint = fromEnv;
    details.push(`endpoint ${fromEnv} (from ${ENDPOINT_ENV_VAR})`);
  } else {
    outcome.problems.push({
      check: 'CC3',
      level: 'warn',
      message:
        scan.config.conlocaCloud === 'dynamic'
          ? `conlocaCloud(...) options are not a plain object literal — set ${ENDPOINT_ENV_VAR} so doctor can read the endpoint (live checks need it)`
          : `endpoint is not a plain string literal in conlocaCloud(...) — set ${ENDPOINT_ENV_VAR} so doctor can read it (live checks need it)`,
    });
    return undefined;
  }
  const url = validUrl(endpoint);
  if (url === null) {
    outcome.problems.push({
      check: 'CC3',
      level: 'error',
      message: `endpoint "${endpoint}" is not a valid URL — ${ABSOLUTE_URL_HINT}`,
    });
    return undefined;
  }
  // register.ts joins `${endpoint}/api/v1/registrations` verbatim, so a trailing slash requests `//api/...`.
  if (endpoint.endsWith('/')) {
    outcome.problems.push({
      check: 'CC3',
      level: 'error',
      message: `endpoint "${endpoint}" must not end with a slash — the build joins /api/v1/registrations verbatim and the endpoint answers 404, which fails the build; remove the trailing slash`,
    });
    return undefined;
  }
  if (url.protocol !== 'https:') {
    outcome.problems.push({
      check: 'CC3',
      level: 'warn',
      message: `endpoint ${endpoint} is not https — fine for a local backend, wrong for production`,
    });
  }
  return endpoint;
}

/**
 * publicBaseUrl/previewDomain are validated when set. When neither is visible,
 * a missing one is a warning under CI only (CF_PAGES_URL may stand in) — and
 * only when the options are readable: dynamic or spread options may set it
 * where the text does not show, so doctor says "not verified" instead.
 */
function checkPublicBaseUrl(
  scan: ReadScan,
  env: RepositoryEnvironment,
  outcome: CheckOutcome,
  details: string[],
): void {
  const publicBaseUrl = optionLiteral(scan, 'publicBaseUrl');
  const previewDomain = optionLiteral(scan, 'previewDomain');
  if (publicBaseUrl !== undefined && validUrl(publicBaseUrl) === null) {
    outcome.problems.push({
      check: 'CC3',
      level: 'error',
      message: `publicBaseUrl "${publicBaseUrl}" is not a valid URL — ${ABSOLUTE_URL_HINT}`,
    });
  }
  // Mirrors the integration's own resolveDeploymentUrl (a bare hostname is
  // prefixed with https://), so doctor accepts exactly what the build accepts.
  if (
    previewDomain !== undefined &&
    validUrl(previewDomain.includes('://') ? previewDomain : `https://${previewDomain}`) === null
  ) {
    outcome.problems.push({
      check: 'CC3',
      level: 'error',
      message: `previewDomain "${previewDomain}" is not a hostname or URL — set it to a hostname such as preview.acme.com or an absolute URL`,
    });
  }
  if (hasOption(scan, 'publicBaseUrl') || hasOption(scan, 'previewDomain')) {
    if (publicBaseUrl === undefined && previewDomain === undefined) {
      details.push('public base URL is set dynamically — not verified');
    }
    return;
  }
  // 'absent' cannot reach here (checkEndpoints skips it); the string test is the same guard optionLiteral uses.
  const { conlocaCloud } = scan.config;
  const opaque =
    typeof conlocaCloud === 'string'
      ? 'are not a plain object literal'
      : conlocaCloud.spread
        ? 'use a spread'
        : undefined;
  if (opaque !== undefined) {
    details.push(`public base URL not verified — the conlocaCloud options ${opaque}`);
  } else if (!isCi(env)) {
    details.push('publicBaseUrl not set (checked under CI only)');
  } else if (env.CF_PAGES_URL) {
    details.push(`public base URL from CF_PAGES_URL (${env.CF_PAGES_URL})`);
  } else {
    outcome.problems.push({
      check: 'CC3',
      level: 'warn',
      message:
        'no public base URL under CI — set publicBaseUrl or previewDomain (or CF_PAGES_URL); without one the build skips registration',
    });
  }
}

/** CC3 — the endpoint and the public base URL, each in its own helper; skipped when there is nothing to read. */
export function checkEndpoints(
  scan: ConfigScan,
  env: RepositoryEnvironment,
): { outcome: CheckOutcome; endpoint?: string } {
  if (scan.kind !== 'read') {
    return {
      outcome: skipped('CC3', scan.kind === 'none' ? 'no astro.config found' : 'astro config could not be read'),
    };
  }
  // CC1 already calls an absent call "fine when deliberate"; a missing endpoint must not contradict it in the same run.
  if (scan.config.conlocaCloud === 'absent') return { outcome: skipped('CC3', INTEGRATION_NOT_CALLED) };
  const outcome = outcomeOf('CC3');
  const details: string[] = [];
  const endpoint = checkEndpoint(scan, env, outcome, details);
  checkPublicBaseUrl(scan, env, outcome, details);
  if (details.length > 0) outcome.detail = details.join('; ');
  return { outcome, ...(endpoint === undefined ? {} : { endpoint }) };
}

/** CC4 — each option the endpoint's editor ignores, warned when set. */
export function checkInertCmsOptions(scan: ConfigScan): CheckOutcome {
  const outcome = outcomeOf('CC4');
  if (scan.kind !== 'read') {
    return skipped('CC4', scan.kind === 'none' ? 'no astro.config found' : 'astro config could not be read');
  }
  const conlocaCMS = scan.config.conlocaCMS;
  if (conlocaCMS === 'absent') return skipped('CC4', 'conlocaCMS is not called in the astro config');
  if (conlocaCMS === 'dynamic') {
    outcome.detail = 'conlocaCMS options are not a plain object literal — editorStyles/editorCSS not checked';
    return outcome;
  }
  for (const key of INERT_AT_ENDPOINT) {
    if (conlocaCMS.keys.has(key)) {
      outcome.problems.push({
        check: 'CC4',
        level: 'warn',
        message: `${key} has no effect on the editor at the endpoint — it styles the local dev editor only; the endpoint's editor takes its canvas styles from conlocaCloud's siteStyles`,
        path: scan.config.path,
      });
    }
  }
  return outcome;
}
