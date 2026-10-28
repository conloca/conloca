import { type ASTNode, generateCode, type ProxifiedModule, parseExpression, parseModule } from 'magicast';
import { stripComments } from '../config-text.js';
import type { StepResult } from './step.js';

type Node<T extends ASTNode['type']> = Extract<ASTNode, { type: T }>;
type ObjectNode = Node<'ObjectExpression'>;
type Element = Node<'ArrayExpression'>['elements'][number];
type ImportLocals = Map<string, string>;

/** Options of the key path that `conlocaCloud()` no longer takes. */
const REMOVED_OPTIONS = new Set([
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
function configObject(program: Node<'Program'>): ObjectNode | null {
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

function property(object: ObjectNode, name: string): Node<'ObjectProperty'> | undefined {
  return object.properties.find(
    (p): p is Node<'ObjectProperty'> =>
      p.type === 'ObjectProperty' &&
      !p.computed &&
      ((p.key.type === 'Identifier' && p.key.name === name) ||
        (p.key.type === 'StringLiteral' && p.key.value === name)),
  );
}

function propertyName(p: ObjectNode['properties'][number]): string | null {
  if (p.type !== 'ObjectProperty' || p.computed) return null;
  return p.key.type === 'Identifier' ? p.key.name : p.key.type === 'StringLiteral' ? p.key.value : null;
}

/** Every import binding, local name → `<source>#<imported>` (`default` for a default import). */
function importLocals(program: Node<'Program'>): ImportLocals {
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
  const printed = generateCode(mod, { format: { objectCurlySpacing: true } }).code;
  // recast drops the final newline; keep the file's own.
  const after = text.endsWith('\n') && !printed.endsWith('\n') ? `${printed}\n` : printed;
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

/** Astro's `site` and `base` when they are plain strings or absent; `computed` when the config builds either. */
export function readAstroSite(text: string): { site: string | null; base: string | null } | 'computed' {
  let program: ASTNode;
  try {
    program = parseModule(text).$ast;
  } catch {
    return 'computed';
  }
  const config = program.type === 'Program' ? configObject(program) : null;
  if (config === null) return 'computed';
  // undefined: the config computes the value.
  const read = (name: string): string | null | undefined => {
    const value = property(config, name)?.value;
    if (value === undefined) return null;
    if (value.type === 'StringLiteral') return value.value;
    if (value.type === 'TemplateLiteral' && value.expressions.length === 0) return value.quasis[0]?.value.cooked;
    return undefined;
  };
  const site = read('site');
  const base = read('base');
  return site === undefined || base === undefined ? 'computed' : { site, base };
}
