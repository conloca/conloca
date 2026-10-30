/* oxlint-disable anti-slop/no-unsafe-dictionary-type -- a module namespace has whatever exports the installed version ships; callers narrow the ones they use. */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { messageOf } from './message-of.js';

/**
 * A module as the project itself installs it, so its rules match the version the site builds with. Resolution
 * starts at the project, never at the CLI's own install.
 */
export async function importFromProject(
  projectDir: string,
  specifier: string,
): Promise<Record<string, unknown> | 'missing' | Error> {
  let entry: string;
  try {
    entry = createRequire(join(projectDir, 'package.json')).resolve(specifier);
  } catch {
    return 'missing';
  }
  try {
    // Dynamic on purpose: the module path is the project's install, known only at run time.
    return await import(pathToFileURL(entry).href);
  } catch (error) {
    return new Error(messageOf(error));
  }
}
