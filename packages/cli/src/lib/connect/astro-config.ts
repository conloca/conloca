import { type ASTNode, generateCode, type ProxifiedModule, parseExpression, parseModule } from 'magicast';
import { containsOutsideStrings, stripComments } from '../config-text.js';
import { isRecord } from '../is-record.js';
import type { AdapterName } from './adapter.js';
import { siteUrlOf } from './site-domain.js';
import type { StepResult } from './step.js';

export type Node<T extends ASTNode['type']> = Extract<ASTNode, { type: T }>;
export type ObjectNode = Node<'ObjectExpression'>;
type Element = Node<'ArrayExpression'>['elements'][number];
type ImportLocals = Map<string, string>;

/** Options of the key path that `conlocaCloud()` no longer takes. */
export const REMOVED_OPTIONS = new Set([
  'buildToken',
  'publicBaseUrl',
  'previewDomain',
  'requireRegistration',
  'editorBundlePlugins',
  'fragmentPreviewRoute',
]);

/** The options `astro setup` writes the starter files for. */
const STARTER_CMS_OPTIONS =
  "{ contentRoot: './content', puckConfigPath: './src/puck.config.tsx', layout: './src/layouts/Layout.astro' }";

/** Every name Astro loads its config from, in the order connect picks one. */
export const ASTRO_CONFIG_FILES = ['mjs', 'js', 'ts', 'mts', 'cjs'].map((extension) => `astro.config.${extension}`);

/** Where the starter data schemas live; typia-vite.mjs and the Typia packages compile exactly this module. */
export const DEFAULT_SCHEMAS_PATH = './src/schemas/data.ts';

const IMPORTS = {
  react: { from: '@astrojs/react', imported: 'default', local: 'react', sources: ['@astrojs/react'] },
  cms: {
    from: '@conloca/astro-cms/node',
    imported: 'conlocaCMS',
    local: 'conlocaCMS',
    sources: ['@conloca/astro-cms/node', '@conloca/astro-cms'],
  },
  editorPage: {
    from: '@conloca/cloud-astro',
    imported: 'conlocaCloud',
    local: 'conlocaCloud',
    sources: ['@conloca/cloud-astro', '@conloca/cloud-astro/node'],
  },
} as const;

function quoted(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function editorPageCall(local: string, repoUri: string | null): string {
  return repoUri === null ? `${local}()` : `${local}({ repoUri: ${quoted(repoUri)} })`;
}

function callNode(code: string): Node<'CallExpression'> {
  const node: ASTNode = parseExpression<object>(code).$ast;
  if (node.type !== 'CallExpression') throw new Error(`not a call: ${code}`);
  return node;
}

/** The object of `export default defineConfig({...})` or `export default {...}`; null for anything computed. */
export function configObject(program: Node<'Program'>): ObjectNode | null {
  const exported = program.body.find((statement) => statement.type === 'ExportDefaultDeclaration')?.declaration;
  const config =
    exported?.type === 'CallExpression' &&
    exported.callee.type === 'Identifier' &&
    exported.callee.name === 'defineConfig' &&
    exported.arguments.length === 1
      ? exported.arguments[0]
      : exported;
  return config?.type === 'ObjectExpression' && config.properties.every((p) => p.type === 'ObjectProperty')
    ? config
    : null;
}

export function property(object: ObjectNode, name: string): Node<'ObjectProperty'> | undefined {
  return object.properties.find(
    (p): p is Node<'ObjectProperty'> =>
      p.type === 'ObjectProperty' &&
      !p.computed &&
      ((p.key.type === 'Identifier' && p.key.name === name) ||
        (p.key.type === 'StringLiteral' && p.key.value === name)),
  );
}

export function propertyName(p: ObjectNode['properties'][number]): string | null {
  if (p.type !== 'ObjectProperty' || p.computed) return null;
  return p.key.type === 'Identifier' ? p.key.name : p.key.type === 'StringLiteral' ? p.key.value : null;
}

/** Every import binding, local name → `<source>#<imported>` (`default` for a default import). */
export function importLocals(program: Node<'Program'>): ImportLocals {
  const locals: ImportLocals = new Map();
  for (const statement of program.body) {
    if (statement.type !== 'ImportDeclaration') continue;
    for (const specifier of statement.specifiers) {
      const imported =
        specifier.type === 'ImportDefaultSpecifier'
          ? 'default'
          : specifier.type === 'ImportSpecifier'
            ? specifier.imported.type === 'Identifier'
              ? specifier.imported.name
              : specifier.imported.value
            : '*';
      locals.set(specifier.local.name, `${statement.source.value}#${imported}`);
    }
  }
  return locals;
}

/** The local name a config uses for one integration, falling back to the canonical one. */
function localName(locals: ImportLocals, wanted: (typeof IMPORTS)[keyof typeof IMPORTS]): string {
  for (const [local, binding] of locals) {
    const [source, imported] = binding.split('#');
    const named = imported === wanted.imported || (wanted === IMPORTS.editorPage && imported === 'default');
    if (named && wanted.sources.some((s) => s === source)) return local;
  }
  return wanted.local;
}

function callIndex(elements: Element[], local: string): number {
  return elements.findIndex(
    (e) => e?.type === 'CallExpression' && e.callee.type === 'Identifier' && e.callee.name === local,
  );
}

/**
 * The removed options the conlocaCloud() of the integrations list still takes, [] when the config never calls it; null
 * when its options are not a plain object literal or the call sits elsewhere, so only the whole file can tell.
 */
export function removedKeyOptions(text: string): string[] | null {
  let program: ASTNode;
  try {
    program = parseModule(text).$ast;
  } catch {
    return null;
  }
  if (program.type !== 'Program') return null;
  const config = configObject(program);
  const value = config === null ? undefined : property(config, 'integrations')?.value;
  const elements = value?.type === 'ArrayExpression' ? value.elements : [];
  const local = localName(importLocals(program), IMPORTS.editorPage);
  const call = elements[callIndex(elements, local)];
  if (call?.type !== 'CallExpression') {
    return new RegExp(`\\b${local.replace(/\$/g, '\\$')}\\s*\\(`).test(stripComments(text)) ? null : [];
  }
  const [options, ...rest] = call.arguments;
  if (options === undefined) return [];
  if (options.type !== 'ObjectExpression' || rest.length > 0) return null;
  const names = options.properties.map(propertyName);
  if (names.some((name) => name === null)) return null;
  return names.flatMap((name) => (name !== null && REMOVED_OPTIONS.has(name) ? [name] : []));
}

/**
 * The config without the named options of conlocaCloud()'s `previewBuild`; null when none is there, 'computed' when
 * the call, its options or previewBuild are not plain object literals connect can edit.
 */
export function withoutPreviewBuildOptions(
  text: string,
  names: ReadonlySet<string>,
): { after: string } | 'computed' | null {
  let mod: ProxifiedModule;
  try {
    mod = parseModule(text);
  } catch {
    return 'computed';
  }
  const program: ASTNode = mod.$ast;
  if (program.type !== 'Program') return 'computed';
  const config = configObject(program);
  const value = config === null ? undefined : property(config, 'integrations')?.value;
  const elements = value?.type === 'ArrayExpression' ? value.elements : [];
  const call = elements[callIndex(elements, localName(importLocals(program), IMPORTS.editorPage))];
  const [options] = call?.type === 'CallExpression' ? call.arguments : [];
  const previewBuild = options?.type === 'ObjectExpression' ? property(options, 'previewBuild')?.value : undefined;
  if (previewBuild?.type !== 'ObjectExpression') return 'computed';
  const removed = previewBuild.properties.filter((p) => names.has(propertyName(p) ?? ''));
  if (removed.length === 0) return null;
  previewBuild.properties = previewBuild.properties.filter((p) => !removed.includes(p));
  // An adapter call that went with them leaves its import behind: drop it when nothing else names it.
  const callees = removed.flatMap((p) =>
    p.type === 'ObjectProperty' && p.value.type === 'CallExpression' && p.value.callee.type === 'Identifier'
      ? [p.value.callee.name]
      : [],
  );
  const code = program.body.filter((statement) => statement.type !== 'ImportDeclaration');
  for (const local of callees) {
    if (!namesIdentifier(code, local)) delete mod.imports[local];
  }
  return { after: printModule(mod, text) };
}

/** Node fields that hold source positions or recast's own bookkeeping, never code. */
const NOT_CODE = new Set([
  'loc',
  'start',
  'end',
  'original',
  'tokens',
  'comments',
  'leadingComments',
  'trailingComments',
  'extra',
]);

/** Whether any identifier in the syntax tree `node` is named `name`. */
function namesIdentifier(node: unknown, name: string): boolean {
  if (Array.isArray(node)) return node.some((child) => namesIdentifier(child, name));
  if (!isRecord(node)) return false;
  if (node.type === 'Identifier' && node.name === name) return true;
  return Object.entries(node).some(([key, child]) => !NOT_CODE.has(key) && namesIdentifier(child, name));
}

/** What the site owner pastes when the config is not a plain object connect can edit. */
function pasteLines(repoUri: string | null): string[] {
  return [
    `import react from '${IMPORTS.react.from}';`,
    `import { conlocaCMS } from '${IMPORTS.cms.from}';`,
    `import { conlocaCloud } from '${IMPORTS.editorPage.from}';`,
    '',
    '// in defineConfig({ ... }); keep your own conlocaCMS options if it is already there',
    'integrations: [',
    '  react(),',
    `  conlocaCMS(${STARTER_CMS_OPTIONS}),`,
    `  ${editorPageCall('conlocaCloud', repoUri)},`,
    '],',
  ];
}

/**
 * Wire react() → conlocaCMS() → conlocaCloud({ repoUri }) and drop removed key options. Never adds an adapter or
 * `output`. Options the site owner gave conlocaCloud() are kept.
 */
export function wireAstroConfig(input: { path: string; text: string; repoUri: string | null }): StepResult {
  const { path, text, repoUri } = input;
  let mod: ProxifiedModule | undefined;
  try {
    mod = parseModule(text);
  } catch {
    mod = undefined;
  }
  const program: ASTNode | undefined = mod?.$ast;
  const config = program?.type === 'Program' ? configObject(program) : null;
  const value = config === null ? undefined : property(config, 'integrations')?.value;
  let elements: Element[] | null = value === undefined ? [] : value.type === 'ArrayExpression' ? value.elements : null;
  if (
    mod === undefined ||
    program?.type !== 'Program' ||
    config === null ||
    elements === null ||
    elements.some((e) => e === null || e.type === 'SpreadElement')
  ) {
    return {
      state: 'needs-you',
      message: `${path} is not a plain defineConfig({ integrations: [...] }), so connect does not edit it: add these lines`,
      lines: pasteLines(repoUri),
      edits: [],
    };
  }
  if (value === undefined) {
    const literal: ASTNode = parseExpression<object>('({ integrations: [] })').$ast;
    const created = literal.type === 'ObjectExpression' ? literal.properties[0] : undefined;
    if (created?.type !== 'ObjectProperty' || created.value.type !== 'ArrayExpression') {
      throw new Error('unparsable literal');
    }
    config.properties.push(created);
    elements = created.value.elements;
  }

  const locals = importLocals(program);
  const names = {
    react: localName(locals, IMPORTS.react),
    cms: localName(locals, IMPORTS.cms),
    editorPage: localName(locals, IMPORTS.editorPage),
  };
  // A call held in a variable or a condition counts as wired by hand: adding another would register it twice.
  const code = stripComments(text);
  const wired = elements;
  const indirect = Object.values(names).filter(
    (name) => callIndex(wired, name) < 0 && new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\s*\\(`).test(code),
  );
  if (indirect.length > 0) {
    return {
      state: 'needs-you',
      message: `${path} calls ${indirect.map((name) => `${name}()`).join(', ')} outside the integrations list, so connect does not add another: wire it the way these lines show`,
      lines: pasteLines(repoUri),
      edits: [],
    };
  }
  const added = new Set<keyof typeof IMPORTS>();
  const notes: string[] = [];

  let cms = callIndex(elements, names.cms);
  if (cms < 0) {
    elements.push(callNode(`${names.cms}(${STARTER_CMS_OPTIONS})`));
    cms = elements.length - 1;
    added.add('cms');
    notes.push('added conlocaCMS()');
  }
  const react = callIndex(elements, names.react);
  if (react < 0 || react > cms) {
    const [moved] = react < 0 ? [callNode(`${names.react}()`)] : elements.splice(react, 1);
    elements.splice(cms, 0, moved ?? null);
    cms += 1;
    if (react < 0) added.add('react');
    notes.push(react < 0 ? 'added react() before conlocaCMS()' : 'moved react() before conlocaCMS()');
  }
  // The two edits spliceText can make without reprinting the file.
  let pageEdit: 'added' | 'replaced' | null = null;
  const page = callIndex(elements, names.editorPage);
  if (page < 0) {
    elements.splice(cms + 1, 0, callNode(editorPageCall(names.editorPage, repoUri)));
    added.add('editorPage');
    pageEdit = 'added';
    notes.push('added conlocaCloud() after conlocaCMS()');
  } else if (page !== cms + 1) {
    const [moved] = elements.splice(page, 1);
    if (page < cms) cms -= 1;
    elements.splice(cms + 1, 0, moved ?? null);
    notes.push('moved conlocaCloud() right after conlocaCMS()');
  }
  let changed = notes.length > 0;
  let differs = false;

  const call = elements[cms + 1];
  if (!added.has('editorPage') && call?.type === 'CallExpression') {
    const [options, ...rest] = call.arguments;
    if (options === undefined) {
      if (repoUri !== null) {
        elements[cms + 1] = callNode(editorPageCall(names.editorPage, repoUri));
        pageEdit = 'replaced';
        changed = true;
        notes.push('set repoUri in conlocaCloud()');
      }
    } else if (
      options.type === 'ObjectExpression' &&
      rest.length === 0 &&
      options.properties.every((p) => propertyName(p) !== null)
    ) {
      const removed = options.properties.filter((p) => REMOVED_OPTIONS.has(propertyName(p) ?? ''));
      const kept = options.properties.filter((p) => !REMOVED_OPTIONS.has(propertyName(p) ?? ''));
      const own = kept.filter((p) => propertyName(p) !== 'repoUri');
      const repo = property(options, 'repoUri');
      if (removed.length > 0) {
        options.properties = kept;
        notes.push(`removed ${removed.map((p) => propertyName(p)).join(', ')} from conlocaCloud()`);
        changed = true;
      }
      if (own.length > 0) {
        differs = true;
        notes.push('conlocaCloud() has your own options (kept yours)');
      } else if (repo !== undefined) {
        if (repoUri !== null && !(repo.value.type === 'StringLiteral' && repo.value.value === repoUri)) {
          differs = true;
          notes.push(`conlocaCloud() names a different repoUri than ${repoUri} (kept yours)`);
        }
      } else if (removed.length > 0 || repoUri !== null) {
        elements[cms + 1] = callNode(editorPageCall(names.editorPage, repoUri));
        pageEdit = 'replaced';
        if (removed.length === 0) notes.push('set repoUri in conlocaCloud()');
        changed = true;
      }
    } else {
      differs = true;
      notes.push('conlocaCloud() takes options connect cannot read (kept yours)');
    }
  }

  if (!changed) {
    return differs
      ? { state: 'differs', message: notes.join('; '), edits: [] }
      : { state: 'done', message: 'astro.config already wires react(), conlocaCMS() and conlocaCloud()', edits: [] };
  }
  const spliced =
    notes.length === 1 && pageEdit !== null
      ? spliceText({
          text,
          program,
          edit: pageEdit,
          cmsCall: elements[cms],
          oldPageCall: call,
          pageCall: editorPageCall(names.editorPage, repoUri),
          pageImport: locals.has(names.editorPage)
            ? null
            : `import { ${IMPORTS.editorPage.imported} } from '${IMPORTS.editorPage.from}';`,
        })
      : null;
  if (spliced !== null) {
    return { state: 'changed', message: notes.join('; '), edits: [{ path, before: text, after: spliced }] };
  }
  for (const key of added) {
    const spec = IMPORTS[key];
    if (!locals.has(names[key])) mod.imports.$append({ from: spec.from, imported: spec.imported, local: names[key] });
  }
  const after = printModule(mod, text);
  return { state: 'changed', message: notes.join('; '), edits: [{ path, before: text, after }] };
}

/**
 * The common edits as text splices, so the rest of the file keeps its formatting and comments: adding conlocaCloud()
 * right after conlocaCMS() (plus its import), or writing repoUri into a conlocaCloud() without options. Null when the
 * nodes carry no source offsets, which leaves the caller to reprint.
 */
function spliceText(input: {
  text: string;
  program: Node<'Program'>;
  edit: 'added' | 'replaced';
  cmsCall: Element | undefined;
  oldPageCall: Element | undefined;
  pageCall: string;
  pageImport: string | null;
}): string | null {
  const { text, program, edit, cmsCall, oldPageCall, pageCall, pageImport } = input;
  if (edit === 'replaced') {
    const { start, end } = oldPageCall ?? {};
    return typeof start === 'number' && typeof end === 'number'
      ? `${text.slice(0, start)}${pageCall}${text.slice(end)}`
      : null;
  }
  const { start, end } = cmsCall ?? {};
  if (typeof start !== 'number' || typeof end !== 'number') return null;
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const indent = text.slice(lineStart, start);
  const comma = /^\s*,/.exec(text.slice(end))?.[0];
  // An element on its own line gets a line of its own; an inline array stays inline.
  const inserted = !/^[ \t]*$/.test(indent)
    ? { at: end, text: `, ${pageCall}` }
    : comma === undefined
      ? { at: end, text: `,\n${indent}${pageCall}` }
      : { at: end + comma.length, text: `\n${indent}${pageCall},` };
  let after = `${text.slice(0, inserted.at)}${inserted.text}${text.slice(inserted.at)}`;
  if (pageImport !== null) {
    const imports = program.body.filter((statement) => statement.type === 'ImportDeclaration');
    const importEnd = imports.at(-1)?.end;
    // `importEnd` is an offset into `text`; an import after the call site moved by the insertion.
    const at = typeof importEnd === 'number' && importEnd > inserted.at ? importEnd + inserted.text.length : importEnd;
    after =
      typeof at === 'number' ? `${after.slice(0, at)}\n${pageImport}${after.slice(at)}` : `${pageImport}\n${after}`;
  }
  return after;
}

/** The module reprinted, keeping the final newline recast drops. */
export function printModule(mod: ProxifiedModule, text: string): string {
  const printed = generateCode(mod, { format: { objectCurlySpacing: true } }).code;
  return text.endsWith('\n') && !printed.endsWith('\n') ? `${printed}\n` : printed;
}

/** The properties of the object literal `code`, as nodes to push into another object. */
export function objectProperties(code: string): ObjectNode['properties'] {
  const node: ASTNode = parseExpression<object>(`({ ${code} })`).$ast;
  if (node.type !== 'ObjectExpression') throw new Error(`not an object: ${code}`);
  return node.properties;
}

/** A plain string value; undefined when the config computes it. */
function stringValue(value: Node<'ObjectProperty'>['value']): string | undefined {
  if (value.type === 'StringLiteral') return value.value;
  if (value.type === 'TemplateLiteral' && value.expressions.length === 0) return value.quasis[0]?.value.cooked;
  return undefined;
}

/** One top-level Astro option: its string, null when absent, undefined when the config computes it. */
export function readAstroOption(text: string, name: string): string | null | undefined {
  let program: ASTNode;
  try {
    program = parseModule(text).$ast;
  } catch {
    return undefined;
  }
  const config = program.type === 'Program' ? configObject(program) : null;
  if (config === null) return undefined;
  const value = property(config, name)?.value;
  return value === undefined ? null : stringValue(value);
}

/** Astro's `site` and `base` when they are plain strings or absent; `computed` when the config builds either. */
export function readAstroSite(text: string): { site: string | null; base: string | null } | 'computed' {
  const site = readAstroOption(text, 'site');
  const base = readAstroOption(text, 'base');
  return site === undefined || base === undefined ? 'computed' : { site, base };
}

/**
 * On Vercel and Netlify (d8), propose Astro's `site` when astro.config sets none: the preview's site-pages fetch needs
 * it. Only ever a `differs` replacement, since `site` also changes the live site's canonical, sitemap, RSS and Open
 * Graph URLs: connect writes it on a terminal yes only.
 */
export function addAstroSiteStep(input: {
  path: string;
  text: string;
  sitesText: string;
  adapter: AdapterName;
  siteUrl?: string;
}): StepResult {
  const { path, text } = input;
  if (input.adapter !== '@astrojs/vercel' && input.adapter !== '@astrojs/netlify') {
    return { state: 'skipped', message: `${input.adapter} needs no site for previews`, edits: [] };
  }
  const current = readAstroSite(text);
  if (current === 'computed') return { state: 'skipped', message: 'astro.config computes its site', edits: [] };
  if (current.site !== null) return { state: 'done', message: `astro.config sets site ${current.site}`, edits: [] };
  const given = input.siteUrl ?? siteUrlOf(input.sitesText);
  const parsed = given !== null && URL.canParse(given) ? new URL(given) : null;
  if (given !== null && parsed?.protocol !== 'https:') {
    return { state: 'needs-you', message: `Astro's site must be an https URL, got ${given}`, edits: [] };
  }
  const url = parsed?.origin ?? null;
  const shown = url ?? '<your production URL>';
  const message = `astro.config sets no site, so your own pages leave the preview (302) instead of staying in it; site: '${shown}' fixes that and also changes canonical, sitemap, RSS and Open Graph URLs on your live pages`;
  const lines = [`site: '${shown}',`];
  let config: ProxifiedModule | null = null;
  try {
    config = url === null ? null : parseModule(text);
  } catch {
    config = null;
  }
  const program: ASTNode | undefined = config?.$ast;
  const object = program?.type === 'Program' ? configObject(program) : null;
  if (config === null || object === null) return { state: 'needs-you', message, lines, edits: [] };
  // A URL origin holds no quote or backslash, so it needs no escaping in the config's own quote style.
  object.properties.unshift(...objectProperties(`site: '${url}'`));
  return {
    state: 'differs',
    message,
    lines,
    edits: [],
    replacement: [{ path, before: text, after: printModule(config, text) }],
    question: `Set site to ${shown} in astro.config? It changes canonical, sitemap, RSS and Open Graph URLs on your live pages.`,
  };
}

/** What the site owner pastes when the data schemas cannot be wired for them. */
function dataSchemaLines(assetsPath: string): string[] {
  return [
    "import { schemaTypia } from './typia-vite.mjs';",
    '',
    '// in conlocaCMS({ ... }); keep your own schemasPath and assetsPath if it has them',
    `schemasPath: '${DEFAULT_SCHEMAS_PATH}',`,
    `assetsPath: '${assetsPath}',`,
    '',
    '// in defineConfig({ ... }), next to your own vite plugins',
    'vite: { plugins: [...schemaTypia()] },',
  ];
}

/**
 * Give conlocaCMS() a `schemasPath` and an `assetsPath` (`<publicDir>/media`) when it has none, and with the default
 * schemas the Typia vite plugin that compiles them. Values the site already names are kept. `schemasPath` and
 * `assetsPath` are the site's own values or the defaults added; null only with `needs-you`.
 */
export function wireDataSchemaOptions(input: {
  path: string;
  text: string;
}): StepResult & { schemasPath: string | null; assetsPath: string | null } {
  const { path, text } = input;
  let mod: ProxifiedModule | undefined;
  try {
    mod = parseModule(text);
  } catch {
    mod = undefined;
  }
  const program: ASTNode | undefined = mod?.$ast;
  const config = program?.type === 'Program' ? configObject(program) : null;
  const integrations = config === null ? undefined : property(config, 'integrations')?.value;
  const locals = program?.type === 'Program' ? importLocals(program) : new Map<string, string>();
  const elements = integrations?.type === 'ArrayExpression' ? integrations.elements : [];
  const call = elements[callIndex(elements, localName(locals, IMPORTS.cms))];
  const options = call?.type === 'CallExpression' && call.arguments.length === 1 ? call.arguments[0] : undefined;
  const publicDir = readAstroOption(text, 'publicDir');
  const defaultAssets =
    publicDir === undefined
      ? '<your publicDir>/media'
      : `${publicDir === null ? './public' : publicDir.replace(/\/+$/, '')}/media`;
  const needsYou = (message: string) => ({
    state: 'needs-you' as const,
    message,
    lines: dataSchemaLines(defaultAssets),
    edits: [],
    schemasPath: null,
    assetsPath: null,
  });
  if (
    mod === undefined ||
    config === null ||
    options?.type !== 'ObjectExpression' ||
    !options.properties.every((p) => propertyName(p) !== null)
  ) {
    return needsYou(
      `${path} has no conlocaCMS({ ... }) with plain options to name the data schemas in: add these lines`,
    );
  }
  const ownValue = (name: string) => {
    const value = property(options, name)?.value;
    return value === undefined ? null : stringValue(value);
  };
  const ownSchemas = ownValue('schemasPath');
  const ownAssets = ownValue('assetsPath');
  if (ownSchemas === undefined || ownAssets === undefined) {
    return needsYou(`${path} computes schemasPath or assetsPath in conlocaCMS(), so their files are unknown`);
  }
  if (ownAssets === null && publicDir === undefined) {
    return needsYou(`${path} computes publicDir, so the media folder inside it is unknown: add assetsPath yourself`);
  }
  const values = { schemasPath: ownSchemas ?? DEFAULT_SCHEMAS_PATH, assetsPath: ownAssets ?? defaultAssets };
  const added: string[] = [];
  if (ownSchemas === null) added.push(`schemasPath: ${quoted(values.schemasPath)}`);
  if (ownAssets === null) added.push(`assetsPath: ${quoted(values.assetsPath)}`);
  if (added.length === 0) {
    return { state: 'done', message: 'conlocaCMS() already names schemasPath and assetsPath', edits: [], ...values };
  }
  options.properties.push(...objectProperties(added.join(', ')));
  const notes = [`added ${added.map((entry) => entry.split(':')[0]).join(' and ')} to conlocaCMS()`];

  if (ownSchemas === null) {
    const vite = property(config, 'vite')?.value;
    if (vite === undefined) {
      config.properties.push(...objectProperties('vite: { plugins: [...schemaTypia()] }'));
    } else if (vite.type === 'ObjectExpression' && vite.properties.every((p) => propertyName(p) !== null)) {
      const plugins = property(vite, 'plugins')?.value;
      if (plugins === undefined) {
        vite.properties.push(...objectProperties('plugins: [...schemaTypia()]'));
      } else if (plugins.type !== 'ArrayExpression') {
        return needsYou(`${path} computes vite.plugins, so the Typia plugin cannot be added to it`);
      } else if (!containsOutsideStrings(stripComments(text), 'schemaTypia(')) {
        const [spread] = objectProperties('...schemaTypia()');
        if (spread?.type === 'SpreadElement') plugins.elements.push(spread);
      }
    } else {
      return needsYou(`${path} computes vite, so the Typia plugin cannot be added to it`);
    }
    if (!locals.has('schemaTypia')) {
      mod.imports.$append({ from: './typia-vite.mjs', imported: 'schemaTypia', local: 'schemaTypia' });
    }
    notes.push('added the Typia plugin to vite.plugins');
  }
  return {
    state: 'changed',
    message: notes.join('; '),
    edits: [{ path, before: text, after: printModule(mod, text) }],
    ...values,
  };
}
