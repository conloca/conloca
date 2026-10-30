import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { legacyKeyFinding } from '../legacy-key.js';
import type { FileEdit, StepResult } from './step.js';

/** The workflow lines that still pass the old build key, as deletion edits; lines a person must change stay needs-you. */
export async function leftoversStep(repoRoot: string): Promise<StepResult> {
  const folder = join(repoRoot, '.github', 'workflows');
  const names = (await readdir(folder).catch(() => [])).filter((name) => /\.ya?ml$/.test(name));
  names.sort();
  const texts = await Promise.all(names.map((name) => readFile(join(folder, name), 'utf8').catch(() => null)));
  const edits: FileEdit[] = [];
  const manual: string[] = [];
  for (const [index, name] of names.entries()) {
    const path = join(folder, name);
    const text = texts[index] ?? null;
    const finding = text === null ? null : legacyKeyFinding(relative(repoRoot, path), text);
    if (text === null || finding === null) continue;
    if (finding.deleted.length > 0) {
      const gone = new Set(finding.deleted);
      const after = text
        .split('\n')
        .filter((_, line) => !gone.has(line + 1))
        .join('\n');
      edits.push({ path, before: text, after });
    }
    if (finding.manual.length > 0) manual.push(`${finding.path}: line ${finding.manual.join(', ')}`);
  }
  if (manual.length > 0) {
    return {
      state: 'needs-you',
      message: 'remove the old build key CONLOCA_BUILD_TOKEN from these lines yourself; the editor page needs no key',
      lines: manual,
      edits,
    };
  }
  return edits.length > 0
    ? {
        state: 'changed',
        message: 'removed the old build key CONLOCA_BUILD_TOKEN; the editor page needs no key',
        edits,
      }
    : { state: 'done', message: 'no workflow names the old build key', edits: [] };
}
