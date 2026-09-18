import { runDoctor } from './doctor/run.js';
import type { CloudDoctorContext, CloudDoctorResult } from './doctor/types.js';

export type { CloudDoctorContext, CloudDoctorResult };

/**
 * `conloca doctor` extension entry (package.json `conloca.doctor`). The CLI
 * calls it with its contract object; an unknown contract gets an empty
 * contract-1 answer, so the CLI reports the mismatch instead of crashing.
 */
export default function doctorExtension(context: CloudDoctorContext): Promise<CloudDoctorResult> {
  if (context.contractVersion !== 1) return Promise.resolve({ contractVersion: 1, checks: [] });
  return runDoctor(context);
}
