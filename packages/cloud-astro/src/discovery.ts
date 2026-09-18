import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import type { DiscoveredWrappers } from '@conloca/astro-cms/node';
import { findContentWrapper } from '@conloca/astro-cms/node';

/**
 * Build-time style discovery. The editor at the endpoint cannot run the
 * discovery flow conlocaCMS runs on the site's dev server — no Vite graph to
 * ask for a route's CSS, and cross-origin computed styles are browser-blocked
 * — but every mechanism only produces plain data, and the build is the moment
 * this pipeline stands inside the site. So: read the discovery route's
 * rendered page, collect its stylesheets, run the SAME wrapper heuristic the
 * dev server runs (`findContentWrapper`, imported — not duplicated), and hand
 * the results to registration.
 *
 * Where the rendered page comes from, in order:
 *  1. a prerendered file in the client dir (static routes);
 *  2. the built server entry, booted for one request (the node adapter's
 *     `dist/server/entry.mjs` honors HOST/PORT) — covers `output: 'server'`
 *     sites, which is what real CMS deployments are;
 *  3. nothing → warn and skip; registration proceeds without the artifacts
 *     (fail-soft, like every other optional registration input).
 *
 * ponytail: only the node adapter's entry is bootable in v1 — a
 * workerd-targeted build (Cloudflare adapter) skips discovery with the
 * warning. A site whose prose is `.conloca-prose`-scoped is already covered
 * by the derived tier; boot-via-wrangler is the upgrade path if a
 * workerd-targeted site ever needs heuristic discovery.
 */

export interface DiscoveredStyleContext {
  hostWrappers: DiscoveredWrappers;
  /** The route's stylesheets concatenated in document order (links + inline). */
  routeCss: string;
}

export type CssRef = { kind: 'link'; href: string } | { kind: 'inline'; css: string };

/**
 * Stylesheet references of a rendered page in document order. Regex-level on
 * purpose: build-output HTML is machine-generated, and the only shapes that
 * matter are `<link rel="stylesheet">` and `<style>` blocks.
 */
export function extractRouteCssRefs(html: string): CssRef[] {
  const refs: Array<{ index: number; ref: CssRef }> = [];

  const linkRe = /<link\b[^>]*>/gi;
  for (const match of html.matchAll(linkRe)) {
    const tag = match[0];
    if (!/rel\s*=\s*["']?stylesheet["']?/i.test(tag)) continue;
    const href = tag.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    if (href) refs.push({ index: match.index ?? 0, ref: { kind: 'link', href } });
  }

  const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  for (const match of html.matchAll(styleRe)) {
    const css = match[1].trim();
    if (css) refs.push({ index: match.index ?? 0, ref: { kind: 'inline', css } });
  }

  return refs.sort((a, b) => a.index - b.index).map((entry) => entry.ref);
}

interface DiscoverInput {
  /** The build's client output dir (where `_conloca/` also lands). */
  clientDir: string;
  /** The built SSR entry, when the adapter produces a bootable one. */
  serverEntry?: string;
  /** The representative content route (the shared `fragmentPreviewRoute`). */
  route: string;
  logger: { info(message: string): void; warn(message: string): void };
}

export async function discoverStyleContext(input: DiscoverInput): Promise<DiscoveredStyleContext | undefined> {
  const fromFile = await readPrerenderedPage(input);
  if (fromFile) return fromFile;

  if (input.serverEntry) {
    try {
      return await bootAndDiscover(input);
    } catch (error) {
      input.logger.warn(
        `style discovery: booting the server entry failed — skipping (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
      return undefined;
    }
  }

  input.logger.warn(
    `style discovery: no built page for ${input.route} and no bootable server entry — ` +
      'skipping; the editor falls back to the prose-safe tier.',
  );
  return undefined;
}

/** Try `<route>/index.html` then `<route>.html` under the client dir. */
async function readPrerenderedPage(input: DiscoverInput): Promise<DiscoveredStyleContext | undefined> {
  const slug = input.route.replace(/^\/+|\/+$/g, '');
  for (const candidate of [`${slug}/index.html`, `${slug}.html`]) {
    let html: string;
    try {
      html = await readFile(join2(input.clientDir, candidate), 'utf8');
    } catch {
      continue;
    }
    const routeCss = await assembleCss(extractRouteCssRefs(html), async (href) => {
      try {
        return await readFile(join2(input.clientDir, href.replace(/^\/+/, '')), 'utf8');
      } catch {
        input.logger.warn(`style discovery: stylesheet ${href} not found in the client dir — skipped.`);
        return '';
      }
    });
    return { hostWrappers: findContentWrapper(html), routeCss };
  }
  return undefined;
}

/** Boot the built entry on a loopback port, fetch the route + its CSS, kill. */
async function bootAndDiscover(input: DiscoverInput): Promise<DiscoveredStyleContext | undefined> {
  if (!input.serverEntry) return undefined;
  const port = 41000 + Math.floor(Math.random() * 20000);
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [input.serverEntry], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
    stdio: 'ignore',
  });
  try {
    await waitForServer(origin);
    const page = await fetch(`${origin}${input.route}`);
    if (!page.ok) {
      input.logger.warn(`style discovery: ${input.route} answered ${page.status} on the booted entry — skipping.`);
      return undefined;
    }
    const html = await page.text();
    const routeCss = await assembleCss(extractRouteCssRefs(html), async (href) => {
      const res = await fetch(new URL(href, origin));
      if (!res.ok) {
        input.logger.warn(`style discovery: stylesheet ${href} answered ${res.status} — skipped.`);
        return '';
      }
      return res.text();
    });
    return { hostWrappers: findContentWrapper(html), routeCss };
  } finally {
    child.kill('SIGTERM');
  }
}

async function assembleCss(refs: CssRef[], loadHref: (href: string) => Promise<string>): Promise<string> {
  const parts: string[] = [];
  for (const ref of refs) {
    if (ref.kind === 'inline') {
      parts.push(ref.css);
      continue;
    }
    const css = await loadHref(ref.href);
    if (css) parts.push(css);
  }
  return parts.join('\n');
}

async function waitForServer(origin: string): Promise<void> {
  // A design-time boot of the SSR entry; on a saturated CI runner the first
  // answer took >15s while a full parallel gate ran beside it.
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      await fetch(origin, { method: 'HEAD' });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  throw new Error('server entry did not answer within 60s');
}

/** node:path join without importing path twice under bundling edge cases. */
function join2(base: string, rel: string): string {
  return `${base.replace(/\/+$/, '')}/${rel}`;
}
