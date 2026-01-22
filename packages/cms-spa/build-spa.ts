import { $, build } from 'bun';
import { BUN_BUILD_CONFIG, processTailwindCSS, TAILWIND_CONFIG } from './tailwind-config';

const isDev = process.env.NODE_ENV !== 'production';
console.log(`Building CMS SPA (${isDev ? 'dev' : 'production'})...`);

// Step 1: Clean dist directory
await $`rm -rf ./dist`;
await $`mkdir -p ./dist/spa`;

// Step 2: Process CSS with Tailwind
console.log('Processing CSS with Tailwind...');
await processTailwindCSS({
  output: TAILWIND_CONFIG.outputCompiled,
  minify: !isDev,
});

// Dev mode: CSS only - Vite loads source directly via virtual module
if (isDev) {
  // Copy CSS to dist/spa for serving
  await $`cp ${TAILWIND_CONFIG.outputCompiled} ./dist/spa/main.css`;
  await $`rm -f ${TAILWIND_CONFIG.outputCompiled}`;
  console.log('Dev build complete (CSS only - Vite handles JS source)');
  process.exit(0);
}

// Production: Bundle with Bun
console.log('Bundling with Bun...');
const bundleResult = await build({
  entrypoints: ['./src/main.html'],
  outdir: './dist/spa',
  minify: true,
  sourcemap: 'none',
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
