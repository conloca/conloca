/**
 * Ambient declaration for the build-time virtual module the integration serves.
 *
 * Kept in its OWN file with no top-level import/export: in a module (a file
 * that imports or exports anything), a `declare module` is treated as
 * augmenting an existing module rather than declaring a new ambient one.
 *
 * `virtual:conloca-preview-opts` carries the preview middleware's configuration
 * baked in during the recursive preview build, so a preview deployment needs no
 * runtime env vars. It resolves to `{}` outside that build.
 */
declare module 'virtual:conloca-preview-opts' {
  const baked: {
    secret?: string;
    saasEndpoint?: string;
    saasIssuer?: string;
    saasAudience?: string;
  };
  export default baked;
}

/**
 * The routing config astro-cms's vite plugin serves to the site build. The
 * middleware entry is compiled INTO the site's build graph (addMiddleware
 * entrypoint), where the module resolves; this declaration only teaches tsc.
 */
declare module 'virtual:conloca-routing-config' {
  import type { ResolvedRoutingConfig } from '@conloca/astro-cms';

  const config: ResolvedRoutingConfig;
  export default config;
}

/**
 * Astro's content-collections module, resolvable only inside a site build.
 * Declared with the narrow surface the middleware entry consumes (the same
 * projection `createCollectionBackedContentAPI` expects).
 */
declare module 'astro:content' {
  export function getCollection(collection: string): Promise<{ data: Record<string, unknown> }[]>;
}

/**
 * The Cloudflare Workers runtime module (bindings live here since Astro v6
 * removed `locals.runtime.env`). Only resolvable inside workerd; the preview
 * middleware imports it dynamically and treats a failed import as "not on
 * Cloudflare Workers". Declared with the narrow surface consumed (the env bag).
 */
declare module 'cloudflare:workers' {
  export const env: Record<string, unknown>;
}
