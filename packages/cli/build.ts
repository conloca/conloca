import { $, build } from 'bun';

console.log('Building Conloca CLI...');

// Step 1: Clean dist directory
await $`rm -rf ./dist`;
await $`mkdir -p ./dist`;

// Step 2: Bundle the CLI with Bun
console.log('Bundling CLI with Bun...');
const bundleResult = await build({
  entrypoints: ['./src/cli.ts'],
  outdir: './dist',
  target: 'node',
  format: 'esm',
  minify: false,
  sourcemap: 'none',
  external: [
    // Node built-ins
    'fs',
    'path',
    'util',
    'node:fs',
    'node:path',
    'node:util',
    'node:fs/promises',
    // Keep this external as it has native/heavy transitive deps
    'fast-glob',
    // npm dependencies, installed with the CLI
    'magicast',
    'diff',
    // Workspace dependencies - resolved via npm at install time
    '@conloca/content-api',
    '@conloca/astro-cms',
    // Optional peer: framing helpers load from the project's own install, never from the bundle
    '@conloca/cloud-astro',
  ],
  naming: {
    entry: 'conloca.js',
  },
});

if (!bundleResult.success) {
  console.error('CLI build failed:', bundleResult.logs);
  process.exit(1);
}

// Step 3: Add shebang to the bundled file
const cliPath = './dist/conloca.js';
const content = await Bun.file(cliPath).text();
await Bun.write(cliPath, `#!/usr/bin/env node\n${content}`);

// Step 4: Make the CLI executable
await $`chmod +x ./dist/conloca.js`;

console.log('CLI build complete! Output: dist/conloca.js');
