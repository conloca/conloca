import { copyFile, mkdir } from 'node:fs/promises';

await mkdir('./dist/internal', { recursive: true });
await copyFile('./src/handlers/page-handler.astro', './dist/internal/page-handler.astro');
// The same handler under a second name: cloud-astro injects it at the preview route of a site's own build.
await copyFile('./src/handlers/page-handler.astro', './dist/internal/preview-page-handler.astro');
await copyFile('./src/internal/acorn-default.mjs', './dist/internal/acorn-default.mjs');
await copyFile('./src/virtual-modules.d.ts', './dist/virtual-modules.d.ts');
