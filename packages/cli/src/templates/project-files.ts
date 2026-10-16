/** The astro.config.mjs a created project starts with: every generated file already wired. */
export function renderAstroConfig(siteName: string): string {
  // The command validates the site name, but escaping here means no name can ever emit broken JS.
  const literal = siteName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `// @ts-check
import node from '@astrojs/node';
import react from '@astrojs/react';
import { conlocaCMS } from '@conloca/astro-cms/node';
import { defineConfig } from 'astro/config';
import { schemaTypia } from './typia-vite.mjs';

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
  // Generates the validators and form metadata src/schemas/data.ts declares.
  vite: { plugins: [...schemaTypia()] },
});
`;
}

/** The native Typia transform for \`src/schemas/\`, the modules that author \`typia.*<T>()\` call sites. */
export const TYPIA_VITE_TEMPLATE = `import { fileURLToPath } from 'node:url';
import ttsc from '@ttsc/unplugin/vite';

const project = fileURLToPath(new URL('./tsconfig.typia.json', import.meta.url));

/**
 * Compiles the Typia call sites in src/schemas/ into generated validators and
 * JSON Schema metadata. Astro's content config and the CMS editor both load
 * those modules through this Vite pipeline.
 *
 * @returns {import('vite').Plugin[]}
 */
export function schemaTypia() {
  const plugins = ttsc({ project });
  return (Array.isArray(plugins) ? plugins : [plugins]).map((plugin) => {
    const transform = plugin.transform;
    if (!transform) return plugin;
    const hook = typeof transform === 'function' ? { handler: transform } : transform;
    return { ...plugin, transform: { ...hook, filter: { ...hook.filter, id: /[\\\\/]src[\\\\/]schemas[\\\\/]/ } } };
  });
}
`;

/** The program typia-vite.mjs compiles: only the schema modules. */
export const TYPIA_TSCONFIG_TEMPLATE = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": []
  },
  "include": ["src/schemas/**/*.ts"]
}
`;

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
