import { readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { isUneditedSkill, stampSkill } from '@conloca/content-api/skill-stamp';
// Kept as a real .md file so it stays editable markdown; Bun inlines it into the bundle.
import CONLOCA_SKILL_TEMPLATE from '../templates/conloca-skill.md' with { type: 'text' };
import type { FileEdit, StepResult } from './connect/step.js';
import { isRecord } from './is-record.js';
import { messageOf } from './message-of.js';
import { importFromProject } from './project-module.js';

/** Where the CLI's agent skill page lives, relative to the Astro project. */
export const CONLOCA_SKILL_PATH = join('.claude', 'skills', 'conloca', 'SKILL.md');

/** The sha256 of every unstamped page a released CLI wrote, so a refresh can tell an untouched old page from an edited one. */
export const LEGACY_CONLOCA_SKILL_CHECKSUMS: readonly string[] = [
  '12a3b71e53d712fb2245e157c99c088df3841dc1d2e6332a9e17f23d306a8159', // 0.2.0, 0.2.1
  'f879c60b510ddf2fd7af781d60dd8c5cd6b4b8c7cbd9057fbd4d70fac6222ead', // 0.2.2
  '603d8eea4df13c0ec6895f22365db2967fbe43bb3745582b0493e12b97c91f65', // 0.2.3
];

interface Skill {
  path: string;
  text: string;
  legacyChecksums: readonly string[];
}

function isSkill(value: unknown): value is Skill {
  return (
    isRecord(value) &&
    typeof value.path === 'string' &&
    typeof value.text === 'string' &&
    Array.isArray(value.legacyChecksums) &&
    value.legacyChecksums.every((checksum) => typeof checksum === 'string')
  );
}

/** The page the project's own @conloca/cloud-astro writes; null when it is not installed, predates `agentSkill` or has no page to write. */
async function projectPackageSkill(projectDir: string): Promise<Skill | null | Error> {
  const module = await importFromProject(projectDir, '@conloca/cloud-astro');
  if (module instanceof Error) return module;
  if (module === 'missing' || typeof module.agentSkill !== 'function') return null;
  try {
    const skill: unknown = module.agentSkill(projectDir);
    return isSkill(skill) ? skill : null;
  } catch (error) {
    return new Error(messageOf(error));
  }
}

/** The edit that brings one page to `skill.text`, and the `SKILL.new.md` it writes instead when the page was edited. */
async function refresh(skill: Skill): Promise<{ edit?: FileEdit; kept?: string }> {
  const before = await readFile(skill.path, 'utf8').catch(() => null);
  // A CRLF checkout of the current page is current.
  if (before?.replaceAll('\r\n', '\n') === skill.text) return {};
  if (before === null || isUneditedSkill(before, skill.legacyChecksums)) {
    return { edit: { path: skill.path, before, after: skill.text } };
  }
  const beside = join(dirname(skill.path), 'SKILL.new.md');
  return {
    edit: { path: beside, before: await readFile(beside, 'utf8').catch(() => null), after: skill.text },
    kept: beside,
  };
}

/**
 * The edits that bring the project's agent skills to this release: the CLI's page and the page of the project's own
 * @conloca/cloud-astro. A page the site owner edited is kept, its new text going to `SKILL.new.md` beside it. Never
 * writes.
 */
export async function planSkillRefresh(projectDir: string, version: string): Promise<StepResult> {
  const skills: Skill[] = [
    {
      path: join(projectDir, CONLOCA_SKILL_PATH),
      text: stampSkill(CONLOCA_SKILL_TEMPLATE, version),
      legacyChecksums: LEGACY_CONLOCA_SKILL_CHECKSUMS,
    },
  ];
  const packageSkill = await projectPackageSkill(projectDir);
  if (isSkill(packageSkill)) skills.push(packageSkill);
  const skipped =
    packageSkill instanceof Error
      ? `; skipped the page of @conloca/cloud-astro, which failed to load (${packageSkill.message})`
      : '';

  const results = await Promise.all(skills.map(refresh));
  const edits = results.flatMap((result) => (result.edit === undefined ? [] : [result.edit]));
  const kept = results.flatMap((result) => (result.kept === undefined ? [] : [relative(projectDir, result.kept)]));
  if (kept.length > 0) {
    return {
      state: 'differs',
      message: `kept the edited agent skills; the new text is in ${kept.join(' and ')}${skipped}`,
      edits,
    };
  }
  if (edits.length > 0) {
    const paths = edits.map((edit) => relative(projectDir, edit.path)).join(' and ');
    return { state: 'changed', message: `refreshed ${paths}${skipped}`, edits };
  }
  return { state: 'done', message: `the agent skills are current${skipped}`, edits };
}
