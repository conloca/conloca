import { separateRefusal } from '../preview-build.js';
import type { RepositoryEnvironment } from '../repository.js';
import {
  type ConfigScan,
  hasOption,
  optionLiteral,
  previewBuildSetting,
  previewServeSetting,
  separateRefused,
} from './config-scan.js';
import { type CheckOutcome, outcomeOf, skipped } from './types.js';

/** Doctor-only override for an endpoint the config computes (e.g. from an env var). */
export const ENDPOINT_ENV_VAR = 'CONLOCA_ENDPOINT';

/** Why the address, framing and live checks skip when the integration is not wired. */
export const INTEGRATION_NOT_CALLED = 'conlocaCloud(...) is not called in the astro config';

/** The endpoint as supplied — config literal first, then CONLOCA_ENDPOINT; undefined means the default editor. */
export function suppliedEndpoint(scan: ConfigScan, env: RepositoryEnvironment): string | undefined {
  return optionLiteral(scan, 'endpoint') || env[ENDPOINT_ENV_VAR] || undefined;
}

/**
 * CC1 — three states for the conlocaCloud call, and the both-integrations rule for conlocaCMS. A wired call also notes
 * that the deployed conloca.json names the repository (`repoUri`: what the build will write, when known).
 */
export function checkWiring(scan: ConfigScan, repoUri: string | undefined): CheckOutcome {
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
  if (conlocaCloud === 'absent') {
    outcome.detail =
      '@conloca/cloud-astro is installed but conlocaCloud(...) is not detectably called — fine when it is gated off or conditionally spread';
    return outcome;
  }
  const call =
    conlocaCloud === 'dynamic'
      ? 'conlocaCloud(...) is called with options doctor cannot read as a plain object literal'
      : 'conlocaCloud(...) is called';
  const name = repoUri === undefined ? "the repository's name" : `the repository name ${repoUri}`;
  outcome.detail = `${call}; /_conloca/editor/conloca.json publishes ${name} and the build branch; if the repository is not public, its name becomes public on deploy`;
  return outcome;
}

const SERVE_DETAIL = {
  d8: "drafts render in the site's own build, through its adapter (d8)",
  d3: 'the preview server runs next to the static site on Cloudflare Workers (D3)',
  d4: "a separate preview deploy (D4): its address goes in sites.json's previewUrl",
  unknown: 'not verified — doctor cannot read previewBuild, output or the adapter from the config text',
} as const;

/** The build turns preview off for previewBuild.adapter; CC8 and CC26 name it. */
export const PREVIEW_BUILD_ADAPTER = 'remove previewBuild.adapter; put the adapter in astro.config';

/** CC8 — how the preview build serves drafts, read from the config text. */
export function checkPreviewBuildAdapter(scan: ConfigScan): CheckOutcome {
  if (scan.kind !== 'read') {
    return skipped('CC8', scan.kind === 'none' ? 'no astro.config found' : 'astro config could not be read');
  }
  if (scan.config.conlocaCloud === 'absent') return skipped('CC8', INTEGRATION_NOT_CALLED);
  const outcome = outcomeOf('CC8');
  const mode = previewServeSetting(scan);
  const refused = separateRefused(scan);
  if (mode === 'off') {
    outcome.detail = hasOption(scan, 'previewBuild')
      ? 'previewBuild: false — no preview build runs'
      : 'previewBuild is not set — no preview build runs';
  } else if (previewBuildSetting(scan) === 'adapter') outcome.detail = PREVIEW_BUILD_ADAPTER;
  else if (refused !== undefined) outcome.detail = separateRefusal(refused);
  else outcome.detail = SERVE_DETAIL[mode];
  return outcome;
}
