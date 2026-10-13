/** The astro.config.mjs a created project starts with: every generated file already wired. */
export function renderAstroConfig(siteName: string): string {
  // The command validates the site name, but escaping here means no name can ever emit broken JS.
  const literal = siteName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `// @ts-check
import node from '@astrojs/node';
import react from '@astrojs/react';
import { conlocaCMS } from '@conloca/astro-cms/node';
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [
    // react() must come before conlocaCMS(): the visual editor is a React app.
    react(),
    conlocaCMS({
      contentRoot: './content',
      puckConfigPath: './src/puck.config.tsx',
      schemasPath: './src/schemas/data.ts',
      routing: {
        routes: {
          pages: {
            pattern: '/[...slug]',
            collection: 'pages',
            layout: './src/layouts/Layout.astro',
          },
        },
        fallback: '404',
        siteName: '${literal}',
        locale: 'en',
      },
    }),
  ],
});
`;
}

export const TSCONFIG_TEMPLATE = `{
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "react"
  },
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist"]
}
`;

/** Declares every content collection by name; without it every content page 404s. */
export const CONTENT_CONFIG_TEMPLATE = `import { conlocaData, conlocaFragments, conlocaPages } from '@conloca/astro-cms/node/content';
import { dataSchemas } from './schemas/data';

export const collections = {
  pages: conlocaPages(),
  ...conlocaData({ dataSchemas }),
  ...conlocaFragments(),
};
`;

export const GITIGNORE_TEMPLATE = `# build output
dist/
# generated types
.astro/
# dependencies
node_modules/
# environment variables
.env
.env.production
# Conloca build output
.conloca/
# OS files
.DS_Store
`;

export function renderReadme(name: string, runPrefix: string): string {
  return `# ${name}

An Astro site edited with [Conloca CMS](https://conloca.com).

- \`${runPrefix} dev\` — start the site, then open http://localhost:4321/__cms to edit pages.
- \`${runPrefix} build\` — production build.
- \`${runPrefix} doctor\` — check the Conloca setup; run it first whenever something looks wrong.

CI installs from the lockfile, so commit it.

Pages live in \`content/\` as \`.vxjson\` files built from the components in \`src/components/puck/\`.
Working with a coding agent? \`.claude/skills/conloca/SKILL.md\` teaches it Conloca.
`;
}
