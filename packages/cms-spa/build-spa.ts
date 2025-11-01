import { $, build } from 'bun';
import { BUN_BUILD_CONFIG, processTailwindCSS, TAILWIND_CONFIG } from './tailwind-config';

console.log('Building CMS SPA...');

// Step 1: Clean dist directory
await $`rm -rf ./dist`;
await $`mkdir -p ./dist/spa`;

// Step 2: Process CSS with Tailwind
console.log('Processing CSS with Tailwind...');
await processTailwindCSS({
  output: TAILWIND_CONFIG.outputCompiled,
  minify: true,
});

// Step 3: Bundle with Bun
console.log('Bundling with Bun...');
const isDev = process.env.NODE_ENV !== 'production';
const bundleResult = await build({
  entrypoints: ['./src/main.html'],
  outdir: './dist/spa',
  minify: !isDev,
  sourcemap: isDev ? 'inline' : 'none',
  naming: {
    entry: '[name].[hash].[ext]',
    chunk: '[name].[hash].[ext]',
    asset: '[name].[hash].[ext]',
  },
  publicPath: '/__cms/',
  ...BUN_BUILD_CONFIG,
});

// Step 4: Clean up temporary files
await $`rm -f ${TAILWIND_CONFIG.outputCompiled}`;

if (!bundleResult.success) {
  console.error('Build failed:', bundleResult.logs);
  process.exit(1);
}

// Step 5: Ensure there's an index.html in the output
const htmlFiles = bundleResult.outputs.filter((o) => o.path.endsWith('.html'));
if (htmlFiles.length > 0 && !htmlFiles.some((f) => f.path.endsWith('index.html'))) {
  // Copy the main.html to index.html for compatibility
  const mainHtml = htmlFiles[0];
  await $`cp ${mainHtml.path} ./dist/spa/index.html`;
}

// Step 6: Build TypeScript for exported files only
console.log('Building TypeScript for exported files...');
await $`tsc --build tsconfig.exports.json`;

console.log('Build complete!');
