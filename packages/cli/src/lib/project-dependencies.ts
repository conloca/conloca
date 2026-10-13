import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isRecord } from './is-record.js';

export type ProjectPackage = { deps: Set<string> } | 'missing' | 'unreadable';

/** Declared dependency names (dependencies + devDependencies) from the project's package.json. */
export async function readProjectDependencies(projectDir: string): Promise<ProjectPackage> {
  let raw: string;
  try {
    raw = await readFile(join(projectDir, 'package.json'), 'utf-8');
  } catch {
    return 'missing';
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 'unreadable';
  }
  if (!isRecord(parsed)) return 'unreadable';
  const deps = new Set<string>();
  for (const field of ['dependencies', 'devDependencies']) {
    const section = parsed[field];
    if (isRecord(section)) {
      for (const name of Object.keys(section)) deps.add(name);
    }
  }
  return { deps };
}
