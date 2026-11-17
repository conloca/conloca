import { copyFile, mkdir } from 'node:fs/promises';

await mkdir('./dist/internal', { recursive: true });
await copyFile('./src/handlers/page-handler.astro', './dist/internal/page-handler.astro');
// The same handler under a second name: cloud-astro injects it at the preview route of a site's own build.
await copyFile('./src/handlers/page-handler.astro', './dist/internal/preview-page-handler.astro');
// The handler's page-root wrapper, beside it so its relative import resolves from both copies.
await copyFile('./src/components/PageRoot.astro', './dist/internal/PageRoot.astro');
await copyFile('./src/internal/acorn-default.mjs', './dist/internal/acorn-default.mjs');
await copyFile('./src/virtual-modules.d.ts', './dist/virtual-modules.d.ts');
