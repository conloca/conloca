import { existsSync, readFileSync } from 'node:fs';
import { gitOutput, resolveRepositoryUri } from '../git.js';
import { checkFramingHeaders, checkKeyLeftovers, checkSiteAddress } from './checks-address.js';
import { runLiveChecks } from './checks-live.js';
import { checkPreviewBuildAdapter, checkWiring, suppliedEndpoint } from './checks-offline.js';
import { optionLiteral, scanAstroConfig } from './config-scan.js';
import type { CloudDoctorContext, CloudDoctorResult, DoctorDeps } from './types.js';

/** The doctor extension: offline checks always, live ones only under --live. Every side effect rides `deps`. */
export async function runDoctor(
  context: CloudDoctorContext,
  overrides: Partial<DoctorDeps> = {},
): Promise<CloudDoctorResult> {
  const deps: DoctorDeps = {
    env: process.env,
    exists: existsSync,
    readFile: (path) => readFileSync(path, 'utf8'),
    git: gitOutput,
    fetch: globalThis.fetch,
    ...overrides,
  };
  const scan = scanAstroConfig(context.projectDir, deps);
  // The doctor diagnoses the project it was handed, not whatever checkout the CLI happens to be standing in.
  const repoUri = resolveRepositoryUri(optionLiteral(scan, 'repoUri'), deps.env, (args) =>
    deps.git(args, context.projectDir),
  );
  const site = checkSiteAddress(scan, context.contentRoot, deps);
  const checks = [
    checkWiring(scan, repoUri),
    site.outcome,
    await checkFramingHeaders(scan, context.projectDir, suppliedEndpoint(scan, deps.env), deps),
    checkKeyLeftovers(scan, context.projectDir, deps),
    checkPreviewBuildAdapter(scan),
    ...(await runLiveChecks({ context, deps, scan, address: site.address, repoUri })),
  ];
  return { contractVersion: 1, checks };
}
