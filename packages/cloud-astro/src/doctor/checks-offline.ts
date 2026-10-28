import type { RepositoryEnvironment } from '../repository.js';
import { type ConfigScan, hasOption, optionLiteral, previewBuildSetting } from './config-scan.js';
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

/**
 * CC8 — only a previewBuild given as an object starts the preview build, which needs an SSR adapter: the project's own
 * or previewBuild.adapter. A static project with neither fails astro build at config time. Only what the config text
 * shows is judged.
 */
export function checkPreviewBuildAdapter(scan: ConfigScan): CheckOutcome {
  if (scan.kind !== 'read') {
    return skipped('CC8', scan.kind === 'none' ? 'no astro.config found' : 'astro config could not be read');
  }
  if (scan.config.conlocaCloud === 'absent') return skipped('CC8', INTEGRATION_NOT_CALLED);
  const outcome = outcomeOf('CC8');
  const previewBuild = previewBuildSetting(scan);
  const { output, adapter } = scan.config.site;
  if (previewBuild === 'off') {
    outcome.detail = hasOption(scan, 'previewBuild')
      ? 'previewBuild: false — no preview build runs'
      : 'previewBuild is not set — no preview build runs';
  } else if (previewBuild === 'adapter' || adapter) {
    outcome.detail = 'the preview build has an SSR adapter';
  } else if (previewBuild === 'unknown' || output !== 'static') {
    outcome.detail = 'not verified — doctor cannot read previewBuild, output or the adapter from the config text';
  } else {
    outcome.problems.push({
      check: 'CC8',
      level: 'error',
      message:
        'previewBuild is set, but the project is static and has no SSR adapter, so astro build fails at config time — add one (previewBuild: { adapter }) or remove previewBuild from conlocaCloud(...)',
      path: scan.config.path,
    });
  }
  return outcome;
}
