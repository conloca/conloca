import { createRequire } from 'node:module';
import { PACKAGE_NAME } from './constants.js';

/**
 * The installed version of this package, read from its own package.json through the `./package.json` export
 * (self-reference by name resolves in Node and Bun; the skill template is located the same way). Undefined when the
 * lookup fails — a copy running outside its package boundary must not fail a site's build over a cosmetic field.
 */
export function packageVersion(): string | undefined {
  try {
    const pkg = createRequire(import.meta.url)(`${PACKAGE_NAME}/package.json`) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}
