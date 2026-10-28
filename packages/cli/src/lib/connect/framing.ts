import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FramingBlocker, FramingSnippets } from '@conloca/cloud-astro';
import { editorUiOrigin, parentRoot } from '@conloca/content-api/editor-host';
import { isRecord } from '../is-record.js';
import { messageOf } from '../message-of.js';
import { type FileEdit, jsonLike, type StepResult } from './step.js';

interface FramingHelpers {
  framingSnippets(editorRoot: string): FramingSnippets;
  findFramingBlockers(projectRoot: string): Promise<FramingBlocker[]>;
}

function isFramingHelpers(value: unknown): value is FramingHelpers {
  return (
    isRecord(value) && typeof value.framingSnippets === 'function' && typeof value.findFramingBlockers === 'function'
  );
}

/**
 * The framing helpers of the project's own @conloca/cloud-astro, so the rules match the version the site builds
 * with. Resolution starts at the project, never at the CLI's own install.
 */
async function loadFramingHelpers(projectDir: string): Promise<FramingHelpers | 'missing' | 'outdated' | Error> {
  let entry: string;
  try {
    entry = createRequire(join(projectDir, 'package.json')).resolve('@conloca/cloud-astro');
  } catch {
    return 'missing';
  }
  let module: unknown;
  try {
    // Dynamic on purpose: the module path is the project's install, known only at run time.
    module = await import(pathToFileURL(entry).href);
  } catch (error) {
    return new Error(messageOf(error));
  }
  return isFramingHelpers(module) ? module : 'outdated';
}

const HEADERS_FILE = 'public/_headers';

async function readText(path: string): Promise<string | null> {
  return readFile(path, 'utf8').catch(() => null);
}

/**
 * vercel.json with the editor-page entries appended to `headers`, and whether every entry was already there; null when
 * the file is not an object with a headers list.
 */
function vercelWithRules(text: string, snippets: FramingSnippets): { present: boolean; after: string } | null {
  let vercel: unknown;
  try {
    vercel = JSON.parse(text);
  } catch {
    return null;
  }
  const current = isRecord(vercel) ? (vercel.headers ?? []) : undefined;
  if (!isRecord(vercel) || !Array.isArray(current)) return null;
  const existing = new Set(current.map((entry) => JSON.stringify(entry)));
  return {
    present: snippets.vercelHeaders.every((entry) => existing.has(JSON.stringify(entry))),
    after: jsonLike(text, { ...vercel, headers: [...current, ...snippets.vercelHeaders] }),
  };
}

/**
 * Let the workspace editor frame the editor page, writing header rules only where a committed rule forbids framing
 * today. A site-wide `frame-ancestors` cannot be loosened by a second header, so that one is left to the site owner.
 */
export async function framingStep(projectDir: string, endpoint: string | undefined): Promise<StepResult> {
  const origin = editorUiOrigin(endpoint);
  const editorRoot = origin === null ? null : parentRoot(origin);
  if (editorRoot === null) {
    return { state: 'failed', message: "endpoint is not the workspace editor's app. address", edits: [] };
  }
  const helpers = await loadFramingHelpers(projectDir);
  if (helpers === 'missing') return { state: 'skipped', message: 'install @conloca/cloud-astro first', edits: [] };
  if (helpers === 'outdated') {
    return { state: 'skipped', message: 'update @conloca/cloud-astro to a version with the editor page', edits: [] };
  }
  if (helpers instanceof Error) {
    return { state: 'failed', message: `could not load @conloca/cloud-astro: ${helpers.message}`, edits: [] };
  }
  const snippets = helpers.framingSnippets(editorRoot);
  const blockers = await helpers.findFramingBlockers(projectDir);
  const headersPath = join(projectDir, HEADERS_FILE);
  const vercelPath = join(projectDir, 'vercel.json');
  const [headers, netlify, vercel] = await Promise.all([
    readText(headersPath),
    readText(join(projectDir, 'netlify.toml')),
    readText(vercelPath),
  ]);
  // Netlify reads public/_headers too, but has no syntax for removing a header.
  const headersRule = netlify === null ? snippets.cloudflareHeaders : snippets.netlifyHeaders;

  if (blockers.length === 0) {
    // findFramingBlockers reports nothing once any header file names the editor page, so tell ours from a hand-written rule.
    if (![headers, netlify, vercel].some((text) => text?.toLowerCase().includes('/_conloca/editor/'))) {
      return { state: 'done', message: 'nothing blocks framing', edits: [] };
    }
    const ours =
      headers?.includes(headersRule) === true ||
      (vercel !== null && vercelWithRules(vercel, snippets)?.present === true);
    return ours
      ? { state: 'done', message: 'the editor page rules are in place', edits: [] }
      : {
          state: 'differs',
          message: 'a /_conloca/editor/ header rule differs from the one connect writes (kept yours)',
          edits: [],
        };
  }

  const vercelLines = JSON.stringify(snippets.vercelHeaders, null, 2).split('\n');
  const headersLines = headersRule.trimEnd().split('\n');
  const frameAncestors = new Set(blockers.filter((b) => b.header === 'frame-ancestors').map((b) => b.file));
  if (frameAncestors.size > 0) {
    return {
      state: 'needs-you',
      message: `a site-wide Content-Security-Policy in ${[...frameAncestors].join(', ')} sets frame-ancestors, which a second header cannot loosen: exclude /_conloca/editor/ from it and add these rules`,
      lines: [
        ...(frameAncestors.has('public/_headers') || frameAncestors.has('netlify.toml') ? headersLines : []),
        ...(frameAncestors.has('vercel.json') ? vercelLines : []),
      ],
      edits: [],
    };
  }

  const edits: FileEdit[] = [];
  const blocked = new Set(blockers.map((b) => b.file));
  if (blocked.has('public/_headers') || blocked.has('netlify.toml')) {
    const after = headers === null ? headersRule : `${headers}${headers.endsWith('\n') ? '' : '\n'}\n${headersRule}`;
    edits.push({ path: headersPath, before: headers, after });
  }
  if (blocked.has('vercel.json') && vercel !== null) {
    const extended = vercelWithRules(vercel, snippets);
    if (extended === null) {
      return {
        state: 'needs-you',
        message: 'vercel.json has no headers list connect can extend: add these entries to its headers',
        lines: vercelLines,
        edits: [],
      };
    }
    edits.push({ path: vercelPath, before: vercel, after: extended.after });
  }
  return {
    state: 'changed',
    message: `added the editor page rules to ${edits.map((edit) => relative(projectDir, edit.path)).join(' and ')}`,
    edits,
  };
}
