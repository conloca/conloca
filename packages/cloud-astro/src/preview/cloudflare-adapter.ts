import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isRecord } from '@conloca/content-api/component-vocabulary';
import type { AstroIntegration } from 'astro';
import { parse } from 'jsonc-parser';
import { PACKAGE_NAME } from '../constants.js';

/**
 * A `wrangler.jsonc` text → its object (comments and trailing commas allowed), else undefined. The return type is
 * `isRecord`'s narrowing, inferred: anti-slop's `no-unsafe-dictionary-type` refuses the type written out.
 */
export function parseWranglerConfig(text: string) {
  const value: unknown = parse(text, [], { allowTrailingComma: true });
  return isRecord(value) ? value : undefined;
}

/** `wrangler.jsonc`, else `wrangler.json`, in the project; undefined when it has neither. */
export function wranglerConfigPath(root: string): string | undefined {
  return ['wrangler.jsonc', 'wrangler.json'].map((name) => join(root, name)).find((path) => existsSync(path));
}

/** Where `@astrojs/cloudflare` resolves from the project; throws naming the fix when it is not installed. */
export function resolveCloudflareAdapter(root: string): string {
  try {
    return createRequire(join(root, 'package.json')).resolve('@astrojs/cloudflare');
  } catch {
    throw new Error(
      `${PACKAGE_NAME}: a static site's preview server runs on Cloudflare Workers and needs the Cloudflare adapter: ` +
        'install @astrojs/cloudflare in this project',
    );
  }
}

/** What the preview build passes `@astrojs/cloudflare`. */
interface ChildAdapterOptions {
  configPath?: string;
  imageService?: { build: 'compile'; runtime: 'passthrough' };
}

// Returns `object`, not `unknown`: anti-slop's no-unknown-returns reads function types too; `isIntegration` narrows the result.
function isAdapterFactory(value: unknown): value is (options: ChildAdapterOptions) => object {
  return typeof value === 'function';
}

function isIntegration(value: unknown): value is AstroIntegration {
  return isRecord(value) && typeof value.name === 'string' && isRecord(value.hooks);
}

/**
 * The adapter options per mode. Under D3 the child reads its config copy, and compiles images at build time: on-demand
 * draft pages then emit `/_image` URLs the passthrough endpoint answers from the static files, with no `IMAGES` binding,
 * which the dispatcher's config doesn't declare (the real-build round trip serves a fixture image through it).
 * Under D4 the preview deploy is a Cloudflare Worker of its own and keeps the adapter's defaults.
 */
export function childAdapterOptions(mode: 'd3' | 'd4', configPath: string | undefined): ChildAdapterOptions {
  if (mode === 'd4') return {};
  return {
    ...(configPath === undefined ? {} : { configPath }),
    imageService: { build: 'compile', runtime: 'passthrough' },
  };
}

/**
 * The adapter for the preview build of a site that names none. Under D3 it reads a copy of the site's `wrangler.jsonc`
 * without `main` and `assets`, at the top level and in every env block (both inherit): those belong to the dispatcher in
 * front of the static site, and the adapter would take `main` for its own entry. Under D4 the site's own config, with the env
 * block the build selects, is the preview deploy's.
 * shortcut: relative paths inside the copy resolve from .conloca/; rewrite them when a site's config carries one.
 */
export async function cloudflareAdapter(rootUrl: URL, mode: 'd3' | 'd4'): Promise<AstroIntegration> {
  const root = fileURLToPath(rootUrl);
  const module: unknown = await import(pathToFileURL(resolveCloudflareAdapter(root)).href);
  // Not isRecord: Bun gives a module namespace a prototype object, Node gives it none.
  const factory = typeof module === 'object' && module !== null && 'default' in module ? module.default : undefined;
  if (!isAdapterFactory(factory)) throw new Error(`${PACKAGE_NAME}: @astrojs/cloudflare has no default export`);
  let configPath: string | undefined;
  if (mode === 'd3') {
    const path = wranglerConfigPath(root);
    const child = { ...(path === undefined ? {} : (parseWranglerConfig(readFileSync(path, 'utf8')) ?? {})) };
    delete child.main;
    delete child.assets;
    if (isRecord(child.env)) {
      const blocks = { ...child.env };
      for (const [name, block] of Object.entries(blocks)) {
        if (!isRecord(block)) continue;
        const kept = { ...block };
        delete kept.main;
        delete kept.assets;
        blocks[name] = kept;
      }
      child.env = blocks;
    }
    configPath = join(root, '.conloca', 'wrangler.child.json');
    mkdirSync(join(root, '.conloca'), { recursive: true });
    writeFileSync(configPath, `${JSON.stringify(child, null, 2)}\n`);
  }
  const adapter = factory(childAdapterOptions(mode, configPath));
  if (!isIntegration(adapter))
    throw new Error(`${PACKAGE_NAME}: @astrojs/cloudflare did not return an Astro integration`);
  return adapter;
}
