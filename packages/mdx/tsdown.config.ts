import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    node: 'src/node.ts',
  },
  format: ['esm'],
  dts: true,
  tsconfig: 'tsconfig.lib.json',
  clean: false,
  css: {
    // Preserve `import './style.css'` in the JS output so consumers' bundlers
    // auto-load the extracted stylesheet. Default strips the import after
    // extraction, which would force consumers to import the CSS path
    // explicitly. See tsdown.dev/options/css.
    inject: true,
  },
  external: [
    '@conloca/content-api',
    '@mdx-js/mdx',
    '@mdx-js/react',
    '@mdxeditor/editor',
    '@mdxeditor/gurx',
    'lucide-react',
    'remark-frontmatter',
    'remark-gfm',
    'remark-mdx-frontmatter',
    'react',
    'react-dom',
  ],
});
