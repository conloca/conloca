import { join } from 'node:path';
import { REFUSED_PREVIEW_ADAPTERS } from '../constants.js';
import type { DoctorDeps } from './types.js';

const ASTRO_CONFIG_NAMES = ['astro.config.mjs', 'astro.config.ts', 'astro.config.js'] as const;
const OPENERS: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
const CLOSERS = new Set([')', '}', ']']);
const QUOTES = new Set(["'", '"', '`']);

// The astro config is scanned as TEXT, never imported: user configs may import
// anything and run side effects. Same discipline (and the same helpers) as
// @conloca/cli's astro checks — duplicated because the CLI exports nothing.

/** Index just past the string literal whose opening quote sits at `index`. */
function skipString(text: string, index: number): number {
  const quote = text[index];
  let i = index + 1;
  while (i < text.length) {
    if (text[i] === '\\') i += 2;
    else if (text[i] === quote) return i + 1;
    else i += 1;
  }
  return i;
}

/** Blank out comments, keeping strings and offsets intact, so a commented-out option never counts as set. */
export function stripComments(source: string): string {
  const chars = source.split('');
  let i = 0;
  while (i < chars.length) {
    if (QUOTES.has(chars[i])) {
      i = skipString(source, i);
    } else if (chars[i] === '/' && chars[i + 1] === '/') {
      while (i < chars.length && chars[i] !== '\n') chars[i++] = ' ';
    } else if (chars[i] === '/' && chars[i + 1] === '*') {
      while (i < chars.length && !(chars[i] === '*' && chars[i + 1] === '/')) {
        if (chars[i] !== '\n') chars[i] = ' ';
        i += 1;
      }
      if (i < chars.length) {
        chars[i] = ' ';
        chars[i + 1] = ' ';
        i += 2;
      }
    } else {
      i += 1;
    }
  }
  return chars.join('');
}

/** The balanced bracket slice starting at openIndex, or null when it never closes. */
export function balancedSlice(text: string, openIndex: number): string | null {
  const closer = OPENERS[text[openIndex]];
  let depth = 0;
  let i = openIndex;
  while (i < text.length) {
    const ch = text[i];
    if (QUOTES.has(ch)) {
      i = skipString(text, i);
      continue;
    }
    if (OPENERS[ch]) {
      depth += 1;
    } else if (CLOSERS.has(ch)) {
      depth -= 1;
      if (depth === 0) return ch === closer ? text.slice(openIndex, i + 1) : null;
    }
    i += 1;
  }
  return null;
}

/** True when `needle` appears in the text outside string literals. */
export function containsOutsideStrings(text: string, needle: string): boolean {
  let i = 0;
  while (i < text.length) {
    if (QUOTES.has(text[i])) {
      i = skipString(text, i);
      continue;
    }
    if (text.startsWith(needle, i)) return true;
    i += 1;
  }
  return false;
}

interface LiteralArgs {
  /** Every `key:` seen in the argument object, literal or not. */
  keys: Set<string>;
  /** Keys whose value is a plain single- or double-quoted string. */
  literals: Map<string, string>;
  /** Whether the object spreads another value in, so keys may be set that the text does not show. */
  spread: boolean;
  /** The object literal as written. */
  text: string;
}

type CallArgs = 'absent' | 'dynamic' | LiteralArgs;

/** The single object-literal argument of `<name>(...)` in the config text. */
function callArgs(configText: string, name: string): CallArgs {
  const call = new RegExp(`\\b${name}\\s*\\(`).exec(configText);
  if (!call) return 'absent';
  const args = balancedSlice(configText, call.index + call[0].length - 1);
  if (args === null) return 'dynamic';
  const inner = args.slice(1, -1).trim();
  if (!inner.startsWith('{')) return 'dynamic';
  const text = balancedSlice(inner, 0);
  if (text === null) return 'dynamic';
  // Note: keys are collected at ANY depth of the object text. conlocaCloud's
  // options are flat (previewBuild.config is the one nested object and, as a
  // Record<string, unknown>, is not expected to carry the keys doctor reads),
  // so a depth-1 parser would buy nothing. Upgrade to the CLI's
  // parseObjectEntries if a nested key ever collides.
  const keys = new Set<string>();
  const literals = new Map<string, string>();
  for (const match of text.matchAll(/\b([$A-Za-z_][$\w]*)\s*:\s*(?:'([^'\\]*)'|"([^"\\]*)")?/g)) {
    keys.add(match[1]);
    if (match[2] !== undefined || match[3] !== undefined) literals.set(match[1], match[2] ?? match[3] ?? '');
  }
  return { keys, literals, spread: containsOutsideStrings(text, '...'), text };
}

/**
 * Astro's own settings as the config text shows them. `output` is 'unknown' when computed or when a spread could set
 * it; `adapter` is true whenever the word appears in code (the option written out or as shorthand), so a doubt never
 * reads as a missing adapter.
 */
interface SiteSettings {
  output: 'static' | 'server' | 'unknown';
  adapter: boolean;
  /** Astro's `site` and `base` as plain string literals: undefined when absent, null when computed or spread in. */
  url: string | null | undefined;
  base: string | null | undefined;
}

interface ScannedConfig {
  path: string;
  conlocaCloud: CallArgs;
  conlocaCMS: CallArgs;
  site: SiteSettings;
  /** The whole config, comments blanked. */
  text: string;
}

/** Astro's own settings, read without conlocaCloud's options: their previewBuild.adapter is not the site's. */
function siteSettings(configText: string, conlocaCloud: CallArgs): SiteSettings {
  const text = typeof conlocaCloud === 'string' ? configText : configText.replace(conlocaCloud.text, '');
  const adapter = containsOutsideStrings(text, 'adapter');
  const spread = containsOutsideStrings(text, '...');
  // shortcut: the first `site:`/`base:` outside conlocaCloud's options counts, so a nested `vite: { base }` would read
  // as Astro's; parse the top-level object if a real config trips it.
  const setting = (key: string) => {
    const match = new RegExp(`\\b${key}\\s*:\\s*(?:'([^'\\\\]*)'|"([^"\\\\]*)")?`).exec(text);
    if (match === null) return spread ? null : undefined;
    return match[1] ?? match[2] ?? null;
  };
  const strings = { url: setting('site'), base: setting('base') };
  if (spread) return { output: 'unknown', adapter, ...strings };
  const key = /\boutput\s*:/.exec(text);
  if (key === null) return { output: 'static', adapter, ...strings };
  const value = /^(['"])(static|server)\1/.exec(text.slice(key.index + key[0].length).trimStart())?.[2];
  return { output: value === 'static' || value === 'server' ? value : 'unknown', adapter, ...strings };
}

export type ConfigScan =
  | { kind: 'none' }
  | { kind: 'unreadable'; path: string }
  | { kind: 'read'; config: ScannedConfig };

/** A scan that found and read a config — the only state the option checks can inspect. */
export type ReadScan = Extract<ConfigScan, { kind: 'read' }>;

/** The file-system half of the doctor seams that the scanner needs. */
export type ScanFs = Pick<DoctorDeps, 'exists' | 'readFile'>;

export function scanAstroConfig(projectDir: string, fs: ScanFs): ConfigScan {
  const path = ASTRO_CONFIG_NAMES.map((name) => join(projectDir, name)).find((candidate) => fs.exists(candidate));
  if (path === undefined) return { kind: 'none' };
  let source: string;
  try {
    source = fs.readFile(path);
  } catch {
    return { kind: 'unreadable', path };
  }
  const text = stripComments(source);
  const conlocaCloud = callArgs(text, 'conlocaCloud');
  return {
    kind: 'read',
    config: {
      path,
      conlocaCloud,
      conlocaCMS: callArgs(text, 'conlocaCMS'),
      site: siteSettings(text, conlocaCloud),
      text,
    },
  };
}

/** A literal string option of conlocaCloud(...), or undefined when absent or computed. */
export function optionLiteral(scan: ConfigScan, key: string): string | undefined {
  if (scan.kind !== 'read' || typeof scan.config.conlocaCloud === 'string') return undefined;
  return scan.config.conlocaCloud.literals.get(key);
}

/** Whether conlocaCloud(...) sets the key at all (literal or computed). */
export function hasOption(scan: ConfigScan, key: string): boolean {
  if (scan.kind !== 'read' || typeof scan.config.conlocaCloud === 'string') return false;
  return scan.config.conlocaCloud.keys.has(key);
}

/**
 * conlocaCloud's previewBuild as the text shows it: 'off' when absent or written as false (the preview build is
 * opt-in), 'adapter' when previewBuild's own object names an adapter (written out or as shorthand; one nested in
 * `config` is not previewBuild's), 'on' for an options object without one, and 'unknown' when computed or when a
 * spread could set it.
 */
export function previewBuildSetting(scan: ConfigScan): 'off' | 'adapter' | 'on' | 'unknown' {
  if (scan.kind !== 'read' || typeof scan.config.conlocaCloud === 'string') return 'unknown';
  const { text, spread } = scan.config.conlocaCloud;
  const value = /\bpreviewBuild\s*:\s*(false\b|\{)?/.exec(text);
  if (value === null) return spread || containsOutsideStrings(text, 'previewBuild') ? 'unknown' : 'off';
  if (value[1] === 'false') return 'off';
  if (value[1] !== '{') return 'unknown';
  const options = balancedSlice(text, value.index + value[0].length - 1);
  if (options === null) return 'unknown';
  return hasTopLevelKey(options, 'adapter') ? 'adapter' : 'on';
}

/** Whether the object literal `objectText` has `key` at its own top level, written out or as shorthand. */
function hasTopLevelKey(objectText: string, key: string): boolean {
  let depth = 0;
  let i = 0;
  while (i < objectText.length) {
    const ch = objectText[i];
    if (QUOTES.has(ch)) {
      i = skipString(objectText, i);
      continue;
    }
    if (OPENERS[ch]) depth += 1;
    else if (CLOSERS.has(ch)) depth -= 1;
    else if (
      depth === 1 &&
      objectText.startsWith(key, i) &&
      /[{,]\s*$/u.test(objectText.slice(0, i)) &&
      /^\s*[:,}]/u.test(objectText.slice(i + key.length))
    ) {
      return true;
    }
    i += 1;
  }
  return false;
}

/**
 * How the preview build serves, as the config text shows it (the rule of `previewBuildMode`): previewBuild.adapter
 * turns preview off ('unknown' here, CC26 names it), `separate: true` is D4, the site's own adapter is d8, a static
 * site is D3; 'unknown' when the text cannot tell.
 */
export function previewServeSetting(scan: ConfigScan): 'off' | 'd3' | 'd4' | 'd8' | 'unknown' {
  const setting = previewBuildSetting(scan);
  if (setting === 'off') return 'off';
  if (setting !== 'on') return 'unknown';
  if (scan.kind !== 'read' || typeof scan.config.conlocaCloud === 'string') return 'unknown';
  // The build refuses separate: true under an adapter that deploys from the project root, so no D4 runs.
  if (/\bseparate\s*:\s*true\b/u.test(scan.config.conlocaCloud.text)) {
    return separateRefused(scan) === undefined ? 'd4' : 'unknown';
  }
  if (scan.config.site.adapter) return 'd8';
  return scan.config.site.output === 'unknown' ? 'unknown' : 'd3';
}

/** The site's adapter when previewBuild asks for `separate: true` under one the build refuses it for; else undefined. */
export function separateRefused(scan: ConfigScan): string | undefined {
  if (scan.kind !== 'read' || typeof scan.config.conlocaCloud === 'string') return undefined;
  if (!/\bseparate\s*:\s*true\b/u.test(scan.config.conlocaCloud.text)) return undefined;
  const adapter = siteAdapter(scan);
  return adapter && REFUSED_PREVIEW_ADAPTERS.includes(adapter) ? adapter : undefined;
}

/**
 * The package of the site's adapter, from `adapter: <name>(...)` and the default import of `<name>`; null when the
 * text names an adapter it does not show that way (a variable, a named import), undefined when there is none.
 */
export function siteAdapter(scan: ReadScan): string | null | undefined {
  if (!scan.config.site.adapter) return undefined;
  const { text, conlocaCloud } = scan.config;
  const own = typeof conlocaCloud === 'string' ? text : text.replace(conlocaCloud.text, '');
  const call = /\badapter\s*:\s*([$A-Za-z_][$\w]*)\s*\(/u.exec(own)?.[1];
  if (call === undefined) return null;
  const from = new RegExp(`\\bimport\\s+${call.replaceAll('$', '\\$')}\\s+from\\s+['"]([^'"]+)['"]`, 'u').exec(text);
  return from?.[1] ?? null;
}

/** previewBuild's object literal as written, or undefined when it is absent or not an object. */
export function previewBuildText(scan: ReadScan): string | undefined {
  const { conlocaCloud } = scan.config;
  if (typeof conlocaCloud === 'string') return undefined;
  const key = /\bpreviewBuild\s*:\s*\{/u.exec(conlocaCloud.text);
  return key === null ? undefined : (balancedSlice(conlocaCloud.text, key.index + key[0].length - 1) ?? undefined);
}
