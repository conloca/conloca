import type { PreviewMiddlewareOptions } from './middleware.js';

/** Values the preview build can bake into the artifact at build time. */
export interface BakedPreviewOpts {
  secret?: string;
  saasEndpoint?: string;
  saasIssuer?: string;
  saasAudience?: string;
  /** The commit the preview build was built from; page-status compares the branch's latest commit with it. */
  buildCommit?: string;
}

/**
 * Resolve the middleware options, preferring values baked in at build time and
 * falling back to the runtime environment.
 *
 * Baking is what removes the deployer's setup burden: every value is already
 * known while the preview build runs — the secret arrived with registration,
 * the endpoint and audience are integration options — so a correctly built
 * preview artifact needs NO env vars on the deployment. It also removes a
 * chicken-and-egg loop: the secret is generated during the build but the
 * deployment that would carry it happens afterwards.
 *
 * The environment still wins when set, so one artifact can be promoted across
 * environments without a rebuild.
 *
 * Throws naming the missing variable — a misconfigured preview runtime must
 * not silently accept requests.
 */
export function resolveFromBaked(
  baked: BakedPreviewOpts,
  readEnvVar: (name: string) => string | undefined,
): PreviewMiddlewareOptions {
  const pick = (envName: string, bakedValue: string | undefined): string => {
    const fromEnv = readEnvVar(envName);
    if (fromEnv) return fromEnv;
    if (bakedValue) return bakedValue;
    throw new Error(
      `${'@conloca/cloud-astro'}: preview SSR handler is missing required configuration ${envName}. ` +
        'The preview build normally bakes this in from the conlocaCloud() options; ' +
        `set ${envName} on the deployment to override.`,
    );
  };
  return {
    secret: pick('CONLOCA_PREVIEW_SECRET', baked.secret),
    saasEndpoint: pick('CONLOCA_SAAS_ENDPOINT', baked.saasEndpoint),
    saasIssuer: pick('CONLOCA_SAAS_ISSUER', baked.saasIssuer),
    saasAudience: pick('CONLOCA_SAAS_AUDIENCE', baked.saasAudience),
    // Optional: an artifact built before this was baked has none, and the
    // endpoint then falls back to the branch's registered build.
    ...(baked.buildCommit ? { buildCommit: baked.buildCommit } : {}),
  };
}

/**
 * Endpoint transport: prefer a `CONLOCA_SAAS` binding when the Cloudflare
 * Workers runtime exposes one, else `undefined` so callers fall back to
 * the global fetch. Bind it when a plain fetch from the preview deployment
 * cannot reach the endpoint by its hostname; JWKS discovery and every preview
 * read then go through the binding.
 *
 * Bindings come from Cloudflare's runtime module (Astro v6 removed
 * `locals.runtime.env`); the import is dynamic and swallowed on Node, where
 * the module does not exist and the global fetch is correct. Memoized so
 * jose's JWKS cache keys off a stable function identity.
 */
let endpointFetchPromise: Promise<typeof fetch | undefined> | undefined;
export function resolveEndpointFetch(): Promise<typeof fetch | undefined> {
  endpointFetchPromise ??= (async () => {
    try {
      const mod = (await import(/* @vite-ignore */ 'cloudflare:workers')) as { env?: Record<string, unknown> };
      const binding = mod.env?.CONLOCA_SAAS;
      if (
        typeof binding === 'object' &&
        binding !== null &&
        typeof (binding as { fetch?: unknown }).fetch === 'function'
      ) {
        const fetcher = binding as { fetch: typeof fetch };
        // Cast: an arrow satisfies fetch's call signature but not the static
        // properties Bun's typings hang off `typeof fetch` (preconnect).
        return ((input, init) => fetcher.fetch(input, init)) as typeof fetch;
      }
    } catch {
      // Not running on Cloudflare Workers — the global fetch is the transport.
    }
    return undefined;
  })();
  return endpointFetchPromise;
}
