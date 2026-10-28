/**
 * Stable package name used as the Astro integration id, for logger scoping,
 * and in user-facing error messages. Single source of truth.
 */
export const PACKAGE_NAME = '@conloca/cloud-astro';

/**
 * Environment variable that the recursive preview build sets on the child
 * Astro process so the integration's own `astro:build:done` hook can detect
 * it and skip the editor page and further recursion.
 */
export const PREVIEW_BUILD_ENV_FLAG = 'CONLOCA_PREVIEW_BUILD';

/**
 * Adapters the preview build is refused under: they write their deployable
 * output at the project root whatever `outDir` says, so the preview build
 * could replace the live site.
 */
export const REFUSED_PREVIEW_ADAPTERS: readonly string[] = ['@astrojs/vercel', '@astrojs/netlify'];
