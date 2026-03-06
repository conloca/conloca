import { resolve, sep } from 'node:path';

/**
 * Validates that a target path resolves within a base directory.
 * Prevents path traversal attacks by canonicalizing both paths
 * and checking that the target starts with the base path + separator
 * (or is exactly the base path).
 */
export function isPathWithinBase(basePath: string, targetPath: string): boolean {
  const resolvedBase = resolve(basePath);
  const resolvedTarget = resolve(targetPath);
  return resolvedTarget === resolvedBase || resolvedTarget.startsWith(resolvedBase + sep);
}
