import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

/**
 * The test browser's environment, with TMPDIR on disk.
 *
 * Chromium on Linux keeps its shared memory as files in TMPDIR (Playwright launches it with
 * --disable-dev-shm-usage), and a story run holds up to ~23 GiB of them at once. On a RAM-backed /tmp
 * without swap, as on CI runners, that exhausts the machine's memory. /var/tmp persists across reboots
 * (FHS), so it is disk-backed, and its path is short: Chromium also creates its singleton socket under
 * TMPDIR, and a socket path longer than 107 bytes aborts it, which rules out a directory in a checkout.
 */
export const browserEnv = { ...process.env, TMPDIR: '/var/tmp' };

// Free space the browser's shared memory can take, and the RAM-backed /tmp it moved off. Nx hides a passing
// task's output, so it also goes into the trace artifact CI uploads (packages/*/.cache/lmao/trace-results.db*).
const df = execSync('df -h /var/tmp /tmp', { encoding: 'utf8' });
console.log(df);
const report = new URL('../.cache/lmao/', import.meta.url);
mkdirSync(report, { recursive: true });
writeFileSync(new URL(`trace-results.db-df-${basename(process.cwd())}.txt`, report), df);
