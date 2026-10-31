/**
 * Stable package name used as the Astro integration id, for logger scoping,
 * and in user-facing error messages. Single source of truth.
 */
export const PACKAGE_NAME = '@conloca/cloud-astro';

/**
 * Environment variable that makes a build the preview server: the site's build sets it on the child build it starts,
 * and a separate preview deploy (D4) builds with it set.
 */
export const PREVIEW_BUILD_ENV_FLAG = 'CONLOCA_PREVIEW_BUILD';

/**
 * Environment variable the site's build names the child's mode in (`d2` or `d3`). A build started with
 * {@link PREVIEW_BUILD_ENV_FLAG} alone, as a separate preview deploy runs it, has none: it is D4.
 */
export const PREVIEW_MODE_ENV = 'CONLOCA_PREVIEW_MODE';

/**
 * Environment variable the site's build names, for a D3 child, the routes it prerendered (a JSON list of their
 * components): the child keeps exactly those prerendered, and every other route keeps its own setting.
 */
export const PREVIEW_PRERENDERED_ENV = 'CONLOCA_PREVIEW_PRERENDERED';

/**
 * Adapters the preview build is refused under: they write their deployable
 * output at the project root whatever `outDir` says, so the preview build
 * could replace the live site.
 */
export const REFUSED_PREVIEW_ADAPTERS: readonly string[] = ['@astrojs/vercel', '@astrojs/netlify'];
