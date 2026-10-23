import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

// The lockfile is not published; the range in this package's manifest is what
// anyone installing @conloca/cms-spa from the registry resolves against.
// GHSA-cg2g-xh64-v4q7 (DOMPurify SAFE_FOR_TEMPLATES bypass) affects
// >=3.4.4 <=3.4.16 and is first patched in 3.4.17, so a range whose lowest
// admitted version is older lets outside consumers install a vulnerable build
// even while this repo's own lockfile is fixed.
const PATCHED = [3, 4, 17] as const;

const manifest: { dependencies: Record<string, string> } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

/** Lowest version a caret/tilde/exact/`>=` range admits; anything else cannot be reasoned about and fails. */
function rangeMinimum(range: string): [number, number, number] {
  const match = /^(?:\^|~|>=)?(\d+)\.(\d+)\.(\d+)$/.exec(range.trim());
  if (!match) throw new Error(`dompurify range "${range}" has no readable lower bound; use ^x.y.z`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function atLeast(version: readonly number[], floor: readonly number[]): boolean {
  for (let i = 0; i < floor.length; i++) {
    const have = version[i] ?? 0;
    const need = floor[i] ?? 0;
    if (have !== need) return have > need;
  }
  return true;
}

describe('dompurify declared floor', () => {
  test('the range minimum is at least the first patched release (3.4.17)', () => {
    const range = manifest.dependencies.dompurify;
    expect(range).toBeDefined();
    const minimum = rangeMinimum(range ?? '');
    expect(atLeast(minimum, PATCHED)).toBe(true);
  });
});
