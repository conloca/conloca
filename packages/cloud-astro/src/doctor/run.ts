import { existsSync, readFileSync } from 'node:fs';
import { gitOutput } from '../git.js';
import { runLiveChecks } from './checks-live.js';
import {
  checkBuildToken,
  checkEndpoints,
  checkInertCmsOptions,
  checkPreviewBuildAdapter,
  checkWiring,
} from './checks-offline.js';
import { scanAstroConfig } from './config-scan.js';
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
  const token = checkBuildToken(scan, deps.env);
  const endpoints = checkEndpoints(scan, deps.env);
  const checks = [
    checkWiring(scan),
    token.outcome,
    endpoints.outcome,
    checkInertCmsOptions(scan),
    ...(await runLiveChecks({ context, deps, scan, token: token.token, endpoint: endpoints.endpoint })),
    checkPreviewBuildAdapter(scan),
  ];
  return { contractVersion: 1, checks };
}
