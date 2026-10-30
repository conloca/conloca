import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fail } from '../lib/cli-output.js';
import { callOptions, stripComments } from '../lib/config-text.js';
import { readSiteComponents } from '../lib/page-components.js';
import { findAstroConfig } from './doctor-astro.js';

/** Prints the site's Puck components and their fields, read from source without running it. Read-only. */
export async function components(directory: string, options: { json: boolean }): Promise<void> {
  const { json } = options;
  const projectDir = resolve(directory);
  const configPath = findAstroConfig(projectDir);
  if (configPath === undefined) fail(json, `no astro.config found in ${projectDir} — run it in the Astro project`);
  const source = await readFile(configPath, 'utf-8').catch(() => null);
  if (source === null) fail(json, `could not read ${configPath} — check its file permissions`);

  const result = await readSiteComponents(projectDir, callOptions(stripComments(source), 'conlocaCMS'));
  if ('reason' in result) fail(json, result.reason);
  const { manifest } = result;

  if (json) {
    console.log(JSON.stringify(manifest));
    return;
  }
  for (const [name, component] of Object.entries(manifest.components)) {
    const fields = Object.entries(component.fields).map(([field, { type }]) => `${field} (${type})`);
    console.log(`${name}: ${fields.length === 0 ? '(no fields)' : fields.join(', ')}`);
  }
  for (const name of manifest.unresolved) {
    const reason = manifest.unresolvedReasons?.[name];
    console.log(`${name} could not be read${reason === undefined ? '' : `: ${reason}`}`);
  }
  if (manifest.unreadable) console.log(`The config may declare more: ${manifest.unreadableReason}`);
}
