import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

/**
 * Resolve a project directory to its content root. A directory already named
 * `content` is the content root itself, so `conloca <command> ./content` does
 * not produce content/content — unless it holds a `content/sites.json`, which
 * only a project whose directory happens to be called `content` does.
 */
export function contentRootOf(directory: string): string {
  const resolvedPath = resolve(directory);
  const nested = join(resolvedPath, 'content');
  if (basename(resolvedPath) === 'content' && !existsSync(join(nested, 'sites.json'))) {
    return resolvedPath;
  }
  return nested;
}
