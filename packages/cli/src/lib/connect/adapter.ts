import { type ASTNode, type ProxifiedModule, parseExpression, parseModule } from 'magicast';
import { compareVersions } from '../versions.js';
import {
  configObject,
  importLocals,
  type ObjectNode,
  objectProperties,
  printModule,
  property,
  readAstroSite,
} from './astro-config.js';
import type { PreviewHost } from './host.js';
import type { StepResult } from './step.js';

export type AdapterName = '@astrojs/vercel' | '@astrojs/netlify' | '@astrojs/cloudflare' | '@astrojs/node';

/** The official adapter for each host that renders drafts in the site's own build, and the call astro.config makes. */
export const HOST_ADAPTERS = {
  vercel: { name: '@astrojs/vercel', call: 'vercel' },
  netlify: { name: '@astrojs/netlify', call: 'netlify' },
  cloudflare: { name: '@astrojs/cloudflare', call: 'cloudflare' },
  node: { name: '@astrojs/node', call: 'node' },
} as const satisfies Record<string, { name: AdapterName; call: string }>;

/** Each pinned adapter's astro peer floor, from `npm view <pkg>@<pin> peerDependencies` at the ADAPTER_VERSIONS pins. */
export const ADAPTER_ASTRO_FLOORS = {
  '@astrojs/vercel': '7.0.0',
  '@astrojs/netlify': '7.0.0',
  '@astrojs/cloudflare': '7.2.0',
  '@astrojs/node': '7.2.1',
} as const satisfies Record<AdapterName, string>;

/** cloud-astro's config-text refusal for d8 on one adapter (`d8ConfigRefusal`), from the project's own install. */
export type D8ConfigRefusal = (text: string, adapterName: string, base?: string) => string | null;

const needs = (message: string): StepResult => ({ state: 'needs-you', message, edits: [] });

function expression(code: string): ASTNode {
  return parseExpression<object>(code).$ast;
}

/** Vercel's `isr` with the preview route under `base` excluded from its path cache; false when it needs no change. */
function excludePreview(options: ObjectNode, base: string): boolean {
  const isr = property(options, 'isr');
  if (isr === undefined || (isr.value.type === 'BooleanLiteral' && !isr.value.value)) return false;
  const entry = `/^${`${base.replace(/\/+$/u, '')}/_conloca/preview`.replaceAll('/', '\\/')}(\\/.*)?$/`;
  if (isr.value.type === 'BooleanLiteral') {
    const replaced = expression(`({ exclude: [${entry}] })`);
    if (replaced.type !== 'ObjectExpression') return false;
    isr.value = replaced;
    return true;
  }
  if (isr.value.type !== 'ObjectExpression') return false;
  const exclude = property(isr.value, 'exclude');
  if (exclude === undefined) {
    isr.value.properties.push(...objectProperties(`exclude: [${entry}]`));
    return true;
  }
  if (exclude.value.type !== 'ArrayExpression') return false;
  const listed = exclude.value.elements.some((e) => e?.type === 'RegExpLiteral' && e.pattern.includes('_conloca'));
  const regex = expression(entry);
  if (listed || regex.type !== 'RegExpLiteral') return false;
  exclude.value.elements.push(regex);
  return true;
}

/**
 * Adds the host's official adapter to astro.config with the options d8 needs (§4.6): Netlify's `session: false`,
 * Node's standalone mode and `security.allowedDomains`; an adapter already there gets those, and Vercel's
 * `isr.exclude` for the preview route when isr is on. Refuses, writing nothing, below the adapter's astro floor, for a
 * config cloud-astro would turn preview off for (edge middleware), and for Vercel with `build.format: 'file'` under
 * --yes.
 */
export function addAdapterStep(input: {
  path: string;
  text: string;
  host: PreviewHost;
  siteDomains: string[];
  /** The site's astro version; '' when unknown, which skips the floor check. */
  astroVersion: string;
  yes: boolean;
  configRefusal?: D8ConfigRefusal;
}): StepResult {
  const { path, text, host } = input;
  if (host === 'cloudflare-d3' || host === 'static-only') {
    return { state: 'skipped', message: `${host} takes no adapter`, edits: [] };
  }
  const { name, call } = HOST_ADAPTERS[host];
  const floor = ADAPTER_ASTRO_FLOORS[name];
  if (input.astroVersion !== '' && compareVersions(input.astroVersion, floor) < 0) {
    return needs(`${name} needs astro ${floor} or later; this site has ${input.astroVersion}: update astro first`);
  }
  let mod: ProxifiedModule;
  try {
    mod = parseModule(text);
  } catch {
    return needs(`${path} does not parse, so connect does not add ${call}(): add it by hand`);
  }
  const program: ASTNode = mod.$ast;
  const config = program.type === 'Program' ? configObject(program) : null;
  if (program.type !== 'Program' || config === null) {
    return needs(`${path} is not a plain defineConfig({...}), so connect does not add ${call}(): add it by hand`);
  }
  const site = readAstroSite(text);
  const base = site === 'computed' ? '/' : (site.base ?? '/');
  const locals = importLocals(program);
  const notes: string[] = [];
  const adapter = property(config, 'adapter');
  if (adapter === undefined) {
    const build = property(config, 'build')?.value;
    const format = build?.type === 'ObjectExpression' ? property(build, 'format')?.value : undefined;
    const fileFormat = format?.type === 'StringLiteral' && format.value === 'file';
    if (host === 'vercel' && fileFormat) {
      const warning =
        "build.format 'file' becomes 'directory' under @astrojs/vercel, so page addresses lose their .html";
      if (input.yes) return needs(`${warning}: remove the option, or run connect in a terminal to accept`);
      notes.push(`warning: ${warning}`);
    }
    const bound = locals.get(call);
    if (bound !== undefined && bound !== `${name}#default`) {
      return needs(`${path} already names something ${call}, so connect does not add ${name}: add it by hand`);
    }
    if (bound === undefined) mod.imports.$append({ from: name, imported: 'default', local: call });
    config.properties.push(
      ...objectProperties(host === 'node' ? `adapter: ${call}({ mode: 'standalone' })` : `adapter: ${call}()`),
    );
    notes.push(`added ${call}() from ${name}`);
  } else {
    const value = adapter.value;
    const callee = value.type === 'CallExpression' && value.callee.type === 'Identifier' ? value.callee.name : null;
    if (value.type !== 'CallExpression' || callee === null || !locals.get(callee)?.startsWith(`${name}#`)) {
      return needs(
        `astro.config's adapter is not ${name}, which ${host} needs for draft previews; pass --host if ${host} is wrong`,
      );
    }
    const [options] = value.arguments;
    if (host === 'vercel' && options?.type === 'ObjectExpression' && excludePreview(options, base)) {
      notes.push('excluded the preview route from isr');
    }
  }
  if (host === 'netlify' && property(config, 'session') === undefined) {
    config.properties.push(...objectProperties('session: false'));
    notes.push('session: false');
  }
  const security = property(config, 'security');
  const needsDomains =
    security === undefined ||
    (security.value.type === 'ObjectExpression' && property(security.value, 'allowedDomains') === undefined);
  if (host === 'node' && needsDomains && input.siteDomains.length === 0) {
    return needs(
      "sites.json names no domain for security.allowedDomains, and without it every preview entry fails behind a TLS proxy: add the site's domains to sites.json, then run again",
    );
  }
  if (host === 'node') {
    const domains = input.siteDomains.map((hostname) => `{ hostname: ${JSON.stringify(hostname)}, protocol: 'https' }`);
    const allowed = `allowedDomains: [${domains.join(', ')}]`;
    if (security === undefined) {
      config.properties.push(...objectProperties(`security: { ${allowed} }`));
      notes.push('security.allowedDomains');
    } else if (security.value.type === 'ObjectExpression' && property(security.value, 'allowedDomains') === undefined) {
      security.value.properties.push(...objectProperties(allowed));
      notes.push('security.allowedDomains');
    }
  }
  const after = notes.length === 0 ? text : printModule(mod, text);
  const refusal = input.configRefusal?.(after, name, base) ?? null;
  if (refusal !== null) return needs(refusal);
  if (after === text) {
    return { state: 'done', message: `astro.config has ${call}() with the options draft previews need`, edits: [] };
  }
  return { state: 'changed', message: notes.join('; '), edits: [{ path, before: text, after }] };
}
