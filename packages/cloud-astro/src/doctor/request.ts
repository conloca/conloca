import { messageOf } from '../message-of.js';
import type { ConfigScan } from './config-scan.js';
import { type CloudDoctorContext, type DoctorDeps, REQUEST_TIMEOUT_MS } from './types.js';

export interface LiveInput {
  context: CloudDoctorContext;
  deps: DoctorDeps;
  scan: ConfigScan;
  /** CC9's verdict: `https://<host><base>`, undefined when CC9 failed. */
  address: string | undefined;
  /** What the build writes as `repo`, undefined when it cannot tell. */
  repoUri: string | undefined;
}

/** GET with no credential and no followed redirect: the answer the server's probe would see. */
export async function request(fetchFn: DoctorDeps['fetch'], url: string): Promise<Response | Error> {
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
