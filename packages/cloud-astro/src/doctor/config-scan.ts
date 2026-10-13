import { join } from 'node:path';
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
function stripComments(source: string): string {
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
function balancedSlice(text: string, openIndex: number): string | null {
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
function containsOutsideStrings(text: string, needle: string): boolean {
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
}

interface ScannedConfig {
  path: string;
  conlocaCloud: CallArgs;
  conlocaCMS: CallArgs;
  site: SiteSettings;
}

/** Astro's output and adapter, read without conlocaCloud's options: their previewBuild.adapter is not the site's. */
function siteSettings(configText: string, conlocaCloud: CallArgs): SiteSettings {
  const text = typeof conlocaCloud === 'string' ? configText : configText.replace(conlocaCloud.text, '');
  const adapter = containsOutsideStrings(text, 'adapter');
  if (containsOutsideStrings(text, '...')) return { output: 'unknown', adapter };
  const key = /\boutput\s*:/.exec(text);
  if (key === null) return { output: 'static', adapter };
  const value = /^(['"])(static|server)\1/.exec(text.slice(key.index + key[0].length).trimStart())?.[2];
  return { output: value === 'static' || value === 'server' ? value : 'unknown', adapter };
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
    config: { path, conlocaCloud, conlocaCMS: callArgs(text, 'conlocaCMS'), site: siteSettings(text, conlocaCloud) },
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
 * conlocaCloud's previewBuild as the text shows it: 'off' when written as false, 'adapter' when the options name an
 * adapter (previewBuild.adapter, written out or as shorthand), 'on' when absent or an options object without one,
 * and 'unknown' when computed or when a spread could set it.
 */
export function previewBuildSetting(scan: ConfigScan): 'off' | 'adapter' | 'on' | 'unknown' {
  if (scan.kind !== 'read' || typeof scan.config.conlocaCloud === 'string') return 'unknown';
  const { text, spread } = scan.config.conlocaCloud;
  const value = /\bpreviewBuild\s*:\s*(false\b|\{)?/.exec(text);
  if (value?.[1] === 'false') return 'off';
  if (containsOutsideStrings(text, 'adapter')) return 'adapter';
  if (value === null) return spread || containsOutsideStrings(text, 'previewBuild') ? 'unknown' : 'on';
  return value[1] === '{' ? 'on' : 'unknown';
}
