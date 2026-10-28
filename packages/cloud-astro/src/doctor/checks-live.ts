import {
  classifyEditorHostResponse,
  classifyFrameHeaders,
  EDITOR_HOST_PROTOCOL,
  EDITOR_PAGE_PATH,
  type EditorPageInfo,
  editorUiOrigin,
  isFromVercel,
  parentRoot,
} from '@conloca/content-api/editor-host';
import { messageOf } from '../message-of.js';
import { resolveBuildSiteId } from '../site-id.js';
import { INTEGRATION_NOT_CALLED, suppliedEndpoint } from './checks-offline.js';
import { type ConfigScan, optionLiteral } from './config-scan.js';
import {
  type CheckId,
  type CheckOutcome,
  type CloudDoctorContext,
  type DoctorDeps,
  outcomeOf,
  skipped,
} from './types.js';

const LIVE_CHECK_IDS: readonly CheckId[] = ['CC11', 'CC12', 'CC13'];

/** Every doctor request is bounded: a hanging host must never hang `conloca doctor` (the CLI seam has no timer of its own). */
const REQUEST_TIMEOUT_MS = 10_000;
/** The server probe's conloca.json cap; a longer answer reads as `invalid` here as there. */
const CONLOCA_JSON_CAP_BYTES = 16 * 1024;
/** CC11 judges everything but the protocol; CC13 holds that against the range the editor publishes. */
const ANY_PROTOCOL = { min: Number.NEGATIVE_INFINITY, max: Number.POSITIVE_INFINITY };

interface LiveInput {
  context: CloudDoctorContext;
  deps: DoctorDeps;
  scan: ConfigScan;
  /** CC9's verdict: `https://<host><base>`, undefined when CC9 failed. */
  address: string | undefined;
  /** What the build writes as `repo`, undefined when it cannot tell. */
  repoUri: string | undefined;
}

const skipAll = (reason: string): CheckOutcome[] => LIVE_CHECK_IDS.map((id) => skipped(id, reason));

/** GET with no credential and no followed redirect: the answer the server's probe would see. */
async function request(fetchFn: DoctorDeps['fetch'], url: string): Promise<Response | Error> {
  try {
    return await fetchFn(url, {
      method: 'GET',
      redirect: 'manual',
      credentials: 'omit',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    return new Error(messageOf(error));
  }
}

/** A 200 body as text when it fits in `CONLOCA_JSON_CAP_BYTES`, else null; reading stops at the cap, as the probe's does. */
async function cappedText(answer: Response): Promise<string | null> {
  if (answer.status !== 200) {
    await answer.body?.cancel().catch(() => {});
    return null;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  // Leaving the loop early cancels the stream.
  for await (const chunk of answer.body ?? []) {
    size += chunk.byteLength;
    if (size > CONLOCA_JSON_CAP_BYTES) return null;
    chunks.push(chunk);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** CC11 — conloca.json at the address, through the server's classifier; the commit is held against local HEAD. */
async function checkEditorPage(
  input: LiveInput,
  address: string,
): Promise<{ outcome: CheckOutcome; info?: EditorPageInfo }> {
  const { context, deps, scan, repoUri } = input;
  if (repoUri === undefined) {
    return {
      outcome: skipped(
        'CC11',
        'repository identity could not be determined — build in a CI environment or Git checkout, or set repoUri',
      ),
    };
  }
  const outcome = outcomeOf('CC11');
  const error = (message: string) => {
    outcome.problems.push({ check: 'CC11', level: 'error', message });
    return { outcome };
  };
  let siteId: string;
  try {
    siteId = resolveBuildSiteId({
      contentRoot: context.contentRoot,
      override: optionLiteral(scan, 'siteId'),
      readFile: (path) => deps.readFile(path),
    });
  } catch (cause) {
    return error(messageOf(cause));
  }
  const url = `${address}${EDITOR_PAGE_PATH.slice(1)}conloca.json`;
  const answer = await request(deps.fetch, url);
  if (answer instanceof Error) return error(`${url} could not be reached (${answer.message})`);
  const body = await cappedText(answer);
  const vercel = isFromVercel(answer.headers);
  const verdict = classifyEditorHostResponse(
    {
      status: answer.status,
      contentType: answer.headers.get('content-type'),
      location: answer.headers.get('location'),
      vercel,
      body,
    },
    { repoUri, siteId, protocols: ANY_PROTOCOL },
  );
  const { info } = verdict;
  switch (verdict.status) {
    case 'ready':
      break;
    case 'unreachable':
      return error(`${url} answers HTTP ${answer.status} — the site is down or limiting requests; try again later`);
    case 'protected':
      return error(
        `${url} asks visitors to sign in${vercel ? ' (Vercel Deployment Protection)' : ''} — put the public production address in sites.json, or let visitors through`,
      );
    case 'not-found':
      return error(`${url} is not deployed — deploy the commit that adds conlocaCloud() to astro.config`);
    case 'wrong-repo':
      // A page built without a git remote names no repository, so no workspace can claim it.
      if (verdict.reason === 'repo-missing') {
        return {
          ...error(
            `${url} names no repository because the build could not read the git remote — set repoUri in conlocaCloud(...)`,
          ),
          info,
        };
      }
      return {
        ...error(`${address} serves the editor page of ${info?.repo}, not ${repoUri} — check domains in sites.json`),
        info,
      };
    case 'wrong-site':
      return {
        ...error(`${address} serves site "${info?.siteId}", not "${siteId}" — check siteId in sites.json`),
        info,
      };
    default:
      return error(
        `${url} is not a conloca.json the editor can read — check that the host serves the built file unchanged`,
      );
  }
  if (info === undefined) return { outcome };
  const local = deps.git(['rev-parse', 'HEAD'], context.projectDir);
  const served = info.commit?.slice(0, 7) ?? 'an unknown commit';
  if (local !== undefined && info.commit !== local) {
    outcome.problems.push({
      check: 'CC11',
      level: 'warn',
      message: `${address} is serving ${served}, your checkout is at ${local.slice(0, 7)} — deploy to see your latest components in the editor`,
    });
  }
  outcome.detail = `${address}${EDITOR_PAGE_PATH.slice(1)} serves site "${siteId}" of ${info.repo} at ${served}`;
  return { outcome, info };
}

/** The sources that govern module scripts, per policy: script-src-elem, else script-src, else default-src. */
function scriptSources(csp: string): string[][] {
  return csp.split(',').flatMap((policy) => {
    const directives = policy.split(';').map((directive) => directive.trim().toLowerCase().split(/\s+/));
    const found = ['script-src-elem', 'script-src', 'default-src']
      .map((wanted) => directives.find(([name]) => name === wanted))
      .find((directive) => directive !== undefined);
    return found === undefined ? [] : [found.slice(1)];
  });
}

const HOST_SOURCE = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*|(?:\*\.)?[a-z0-9.-]+)(?::(\d+|\*))?(\/\S*)?$/;

/**
 * Whether one CSP source expression admits an https `target` (CSP3 "does url match expression"). Keywords, nonces and
 * hashes never admit a cross-origin file here; `'strict-dynamic'` is not modelled.
 */
function sourceAllows(source: string, target: URL): boolean {
  if (source === '*' || source === 'https:' || source === 'http:') return true;
  const match = HOST_SOURCE.exec(source);
  if (match === null) return false;
  const [, scheme, host = '', port, path] = match;
  if (scheme !== undefined && scheme !== 'https' && scheme !== 'http') return false;
  const hostMatches =
    host === '*' || (host.startsWith('*.') ? target.hostname.endsWith(host.slice(1)) : host === target.hostname);
  const portMatches = port === undefined || port === '*' || Number(port) === Number(target.port || 443);
  const pathMatches =
    path === undefined || (path.endsWith('/') ? target.pathname.startsWith(path) : target.pathname === path);
  return hostMatches && portMatches && pathMatches;
}

/** CC12 — the editor page's own headers, through the server's frame classifier, and whether it may load the editor UI. */
async function checkFrameHeaders(
  address: string,
  origin: string | null,
  fetchFn: DoctorDeps['fetch'],
): Promise<CheckOutcome> {
  const editorRoot = origin === null ? null : parentRoot(origin);
  if (origin === null || editorRoot === null) return skipped('CC12', 'no editor UI origin');
  const outcome = outcomeOf('CC12');
  const error = (message: string) => {
    outcome.problems.push({ check: 'CC12', level: 'error', message });
    return outcome;
  };
  const url = `${address}${EDITOR_PAGE_PATH.slice(1)}`;
  const answer = await request(fetchFn, url);
  if (answer instanceof Error) return error(`${url} could not be reached (${answer.message})`);
  await answer.body?.cancel().catch(() => {});
  if (answer.status >= 500 || answer.status === 429) {
    return error(`${url} answers HTTP ${answer.status} — the site is down or limiting requests; try again later`);
  }
  // A 404 or a redirect carries the host's headers, not the page's, so it proves nothing about framing.
  if (!answer.ok) {
    return error(
      `${url} answers HTTP ${answer.status}, not the editor page, so its headers say nothing yet — deploy it first (see CC11)`,
    );
  }
  const headers = {
    xFrameOptions: answer.headers.get('x-frame-options'),
    csp: answer.headers.get('content-security-policy'),
  };
  const ancestor = `https://*.${editorRoot}`;
  const hint = 'run conloca connect again, or exempt /_conloca/editor/ in your host settings';
  if (classifyFrameHeaders(headers, [ancestor]) === 'frame-blocked') {
    const seen = /frame-ancestors/i.test(headers.csp ?? '')
      ? `a Content-Security-Policy whose frame-ancestors excludes ${ancestor}`
      : `X-Frame-Options: ${headers.xFrameOptions}`;
    error(`${url} sends ${seen}, so the workspace editor cannot frame it — ${hint}`);
  }
  // The editor UI modules live under /host/v<protocol>/ on the editor UI origin.
  const editorUi = new URL(`/host/v${EDITOR_HOST_PROTOCOL}/`, origin);
  const blocksEditor = scriptSources(headers.csp ?? '').some(
    (sources) => !sources.some((source) => sourceAllows(source, editorUi)),
  );
  if (blocksEditor) {
    error(
      `${url} sends a Content-Security-Policy whose script-src does not allow ${origin}, so the editor page cannot load the editor — add ${origin} to script-src for /_conloca/editor/`,
    );
  }
  if (outcome.problems.length === 0) outcome.detail = `${url} may be framed by ${ancestor}`;
  return outcome;
}

function isProtocolRange(value: unknown): value is { min: number; max: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'min' in value &&
    'max' in value &&
    Number.isSafeInteger(value.min) &&
    Number.isSafeInteger(value.max)
  );
}

/** CC13 — the page's protocol against the range the editor UI publishes at `<origin>/host/protocols.json`. */
async function checkProtocol(
  info: EditorPageInfo | undefined,
  origin: string | null,
  fetchFn: DoctorDeps['fetch'],
): Promise<CheckOutcome> {
  if (origin === null) return skipped('CC13', 'no editor UI origin');
  if (info === undefined) return skipped('CC13', 'no conloca.json to read (see CC11)');
  const outcome = outcomeOf('CC13');
  const error = (message: string) => {
    outcome.problems.push({ check: 'CC13', level: 'error', message });
    return outcome;
  };
  const url = `${origin}/host/protocols.json`;
  const answer = await request(fetchFn, url);
  if (answer instanceof Error) return error(`${url} could not be reached (${answer.message})`);
  let range: unknown;
  try {
    range = answer.ok ? await answer.json() : undefined;
  } catch {
    range = undefined;
  }
  if (!isProtocolRange(range)) {
    return error(`${url} did not answer the editor's protocol range as JSON (HTTP ${answer.status})`);
  }
  const { protocol } = info;
  const speaks = `the editor page speaks protocol ${protocol} and the editor speaks ${range.min}–${range.max}`;
  if (protocol < range.min) return error(`${speaks} — rebuild with a newer @conloca/cloud-astro and deploy`);
  if (protocol > range.max) return error(`${speaks} — the editor does not speak this version yet`);
  outcome.detail = `protocol ${protocol}, the editor speaks ${range.min}–${range.max}`;
  return outcome;
}

/**
 * CC11–CC13. Networks only under --live, sends no credential, and contacts only the site's own domain and the editor UI's
 * public protocols.json — so it runs anywhere, forks and Dependabot included.
 */
export async function runLiveChecks(input: LiveInput): Promise<CheckOutcome[]> {
  const { context, deps, scan, address } = input;
  if (!context.live) return skipAll('live checks run only with --live');
  if (scan.kind === 'read' && scan.config.conlocaCloud === 'absent') return skipAll(INTEGRATION_NOT_CALLED);
  if (address === undefined) return skipAll('no site domain (see CC9)');
  const origin = editorUiOrigin(suppliedEndpoint(scan, deps.env));
  const [page, frame] = await Promise.all([
    checkEditorPage(input, address),
    checkFrameHeaders(address, origin, deps.fetch),
  ]);
  return [page.outcome, frame, await checkProtocol(page.info, origin, deps.fetch)];
}
