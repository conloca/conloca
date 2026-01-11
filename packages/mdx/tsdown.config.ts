import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    node: 'src/node.ts',
  },
  format: ['esm'],
  // Disable dts generation - use tsc for declarations due to rolldown-plugin-dts issues
  dts: false,
  tsconfig: 'tsconfig.lib.json',
  clean: true,
  external: [
    '@conloca/content-api',
    '@mdx-js/mdx',
    '@mdx-js/react',
    '@mdxeditor/editor',
    'remark-frontmatter',
    'remark-gfm',
    'remark-mdx-frontmatter',
    'react',
    'react-dom',
  ],
});
