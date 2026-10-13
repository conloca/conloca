import { afterAll, beforeAll } from 'bun:test';

/**
 * Runs the enclosing describe block's tests in `zone`, then gives the process
 * its own zone back. bun runs many test files in one process, so a zone set and
 * left behind decides how every later file renders its dates.
 */
export function pinTimeZone(zone: string): void {
  let previous: string | undefined;
  beforeAll(() => {
    previous = process.env.TZ;
    process.env.TZ = zone;
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  });
}
