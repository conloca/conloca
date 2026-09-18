/**
 * Stable package name used as the Astro integration id, for logger scoping,
 * and in user-facing error messages. Single source of truth.
 */
export const PACKAGE_NAME = '@conloca/cloud-astro';

/**
 * Environment variable that the recursive preview build sets on the child
 * Astro process so the integration's own `astro:build:done` hook can detect
 * it and skip re-registration / further recursion.
 */
export const PREVIEW_BUILD_ENV_FLAG = 'CONLOCA_PREVIEW_BUILD';

/**
 * Environment variable consumed by the recursive preview build to discover
 * the per-branch preview secret needed to construct the secret-scoped Astro
 * route (`/conloca_preview_<secret>/[...path]`).
 */
export const PREVIEW_SECRET_ENV_FLAG = 'CONLOCA_PREVIEW_SECRET';

/**
 * Environment variable carrying the build token (`cbt_<id>.<secret>`),
 * issued by the endpoint, that authenticates the site's build to the
 * endpoint's registration route.
 * Read when {@link ConlocaCloudOptions.buildToken} is not set, so CI can
 * inject the credential without committing it to `astro.config.mjs`.
 */
export const BUILD_TOKEN_ENV_VAR = 'CONLOCA_BUILD_TOKEN';
