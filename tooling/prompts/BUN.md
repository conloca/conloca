# Using TypeScript Transform Plugins with Bun

This document explains how to use TypeScript compiler transformers (like `react-refresh-typescript`) before bundling
with Bun.

## Why?

Bun's bundler is fast but doesn't support TypeScript transform plugins. However, you can use the TypeScript compiler API
to apply transforms first, then bundle the result with Bun.

## Example: React Refresh Transform

```typescript
import { $, build } from 'bun';
import refresh from 'react-refresh-typescript';
import ts from 'typescript';

// Step 1: Read your TypeScript entry file
const entryContent = await Bun.file('./src/main.tsx').text();

// Step 2: Apply TypeScript transforms
const result = ts.transpileModule(entryContent, {
  compilerOptions: {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    jsx: ts.JsxEmit.Preserve, // Keep JSX for Bun to handle
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
  },
  fileName: 'main.tsx',
  transformers: {
    before: [refresh()], // Apply React Refresh transform
  },
});

// Step 3: Write the transformed code to a temporary file
await Bun.write('./src/main-transformed.js', result.outputText);

// Step 4: Bundle with Bun
const bundleResult = await build({
  entrypoints: ['./src/main-transformed.js'],
  outdir: './dist',
  // ... other options
});

// Step 5: Clean up
await $`rm -f ./src/main-transformed.js`;
```

## Bundling HTML with Transformed TypeScript

When your entry point is an HTML file that imports TypeScript, you need to update the import path to point to the
transformed JavaScript:

```typescript
// Step 1: Transform your TypeScript entry
const entryContent = await Bun.file('./src/main.tsx').text();
const result = ts.transpileModule(entryContent, {
  compilerOptions: {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    jsx: ts.JsxEmit.Preserve,
  },
  transformers: {
    before: [refresh()],
  },
});
await Bun.write('./src/main-transformed.js', result.outputText);

// Step 2: Create/update HTML to import the transformed JS
const htmlContent = await Bun.file('./src/index.html').text();
const updatedHtml = htmlContent.replace(
  '<script type="module" src="./main.tsx"></script>',
  '<script type="module" src="./main-transformed.js"></script>'
);
await Bun.write('./src/index-temp.html', updatedHtml);

// Step 3: Bundle with the modified HTML
const bundleResult = await build({
  entrypoints: ['./src/index-temp.html'],
  outdir: './dist',
  // ... other options
});

// Step 4: Clean up
await $`rm -f ./src/main-transformed.js ./src/index-temp.html`;
```

### Alternative: Keep Original HTML with Transformed Entry Name

Instead of modifying HTML, you can name your transformed file to match the original import:

```typescript
// Transform main.tsx → main.tsx (overwrite or use a temp directory)
const result = ts.transpileModule(entryContent, {
  /* ... */
});

// Create a temp directory structure
await $`mkdir -p ./temp/src`;
await Bun.write('./temp/src/main.tsx', result.outputText);

// Copy other assets
await $`cp ./src/index.html ./temp/src/`;
await $`cp ./src/main.css ./temp/src/`;

// Bundle from temp directory
const bundleResult = await build({
  entrypoints: ['./temp/src/index.html'],
  outdir: './dist',
});

// Clean up
await $`rm -rf ./temp`;
```

## Processing CSS with Tailwind

When using Tailwind CSS, you need to process your CSS before bundling. Similar to TypeScript transforms, this requires
updating HTML imports:

```typescript
// Step 1: Process CSS with Tailwind
await $`bunx @tailwindcss/cli -i ./src/main.css -o ./src/main.compiled.css --minify`;

// Step 2: Transform your TypeScript
const entryContent = await Bun.file('./src/main.tsx').text();
const result = ts.transpileModule(entryContent, {
  compilerOptions: {
    /* ... */
  },
  transformers: { before: [refresh()] },
});
await Bun.write('./src/main.transformed.js', result.outputText);

// Step 3: Update HTML to import processed files
const htmlContent = await Bun.file('./src/index.html').text();
const updatedHtml = htmlContent
  .replace('./main.tsx', './main.transformed.js')
  .replace('./main.css', './main.compiled.css');
await Bun.write('./src/index.temp.html', updatedHtml);

// Step 4: Bundle everything
const bundleResult = await build({
  entrypoints: ['./src/index.temp.html'],
  outdir: './dist',
  naming: {
    entry: '[name].[hash].[ext]',
    asset: '[name].[hash].[ext]',
  },
});

// Step 5: Clean up
await $`rm -f ./src/main.compiled.css ./src/main.transformed.js ./src/index.temp.html`;
```

### Complete Build Pipeline Example

Here's a complete example combining TypeScript transforms and Tailwind CSS:

```typescript
import { $, build } from 'bun';
import refresh from 'react-refresh-typescript';
import ts from 'typescript';

async function buildSPA() {
  // Clean build directory
  await $`rm -rf ./dist`;
  await $`mkdir -p ./dist`;

  // Process CSS with Tailwind
  console.log('Processing CSS with Tailwind...');
  await $`bunx @tailwindcss/cli -i ./src/main.css -o ./src/main.compiled.css --minify`;

  // Transform TypeScript with plugins
  console.log('Transforming TypeScript...');
  const tsContent = await Bun.file('./src/main.tsx').text();
  const tsResult = ts.transpileModule(tsContent, {
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.Preserve,
    },
    transformers: {
      before: [refresh()],
    },
  });
  await Bun.write('./src/main.transformed.js', tsResult.outputText);

  // Update HTML imports
  const html = await Bun.file('./src/index.html').text();
  const processedHtml = html
    .replace('<link rel="stylesheet" href="./main.css">', '<link rel="stylesheet" href="./main.compiled.css">')
    .replace(
      '<script type="module" src="./main.tsx"></script>',
      '<script type="module" src="./main.transformed.js"></script>'
    );
  await Bun.write('./src/index.processed.html', processedHtml);

  // Bundle with Bun
  console.log('Bundling with Bun...');
  const result = await build({
    entrypoints: ['./src/index.processed.html'],
    outdir: './dist',
    minify: true,
    naming: {
      entry: '[name].[hash].[ext]',
      chunk: '[name].[hash].[ext]',
      asset: '[name].[hash].[ext]',
    },
  });

  // Clean up temporary files
  await $`rm -f ./src/*.compiled.css ./src/*.transformed.js ./src/*.processed.html`;

  if (!result.success) {
    throw new Error('Build failed');
  }

  console.log('Build complete!');
}

await buildSPA();
```

## Key Points

1. **JSX Preservation**: Use `jsx: ts.JsxEmit.Preserve` to let Bun handle JSX transformation
2. **Module Format**: Use ESNext modules for compatibility with Bun
3. **Temporary Files**: Write transformed output to temporary files that Bun can bundle
4. **HTML Entry Points**: Update HTML imports to reference both transformed JS and processed CSS files
5. **CSS Processing**: Run Tailwind CLI before bundling to process CSS with PostCSS plugins
6. **Import Updates**: Replace both CSS and JS imports in HTML to point to processed files
7. **Cleanup**: Remove temporary files after bundling to keep the source directory clean
