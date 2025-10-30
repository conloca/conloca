import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

function getSlugRouteTemplate(siteName = 'default') {
  return `---
import { Render } from '@measured/puck';
import config from '../puck.config';
import { createContentAPI } from '@conloca/content-api/node';

export const prerender = false;

export function getStaticPaths() {
  return [];
}

  const slugParam = (Astro.params as any).slug;
  const slug = Array.isArray(slugParam) ? slugParam.join('/') : (slugParam || 'index');
const locale = 'en';
  const pathname = slug === 'index' ? '/' : (slug.startsWith('/') ? slug : '/' + slug);

const api = await createContentAPI({ contentRoot: './content' });

let puckData;
let manifest;

try {
    const site = (import.meta.env.SITE_NAME ?? import.meta.env.PUBLIC_SITE_NAME ?? '${siteName}') as string;
    const siteApi = api.getSite(site);
  const found = siteApi?.getByPathname(pathname, locale) || siteApi?.getByPathname(pathname);
  if (!found) {
    return Astro.redirect('/404');
  }

  const localized = await api.getLocalized(found.id, locale);
  if (!localized) {
    return Astro.redirect('/404');
  }

  puckData = localized.localized.content?.puckData;
  manifest = localized.localized.meta || {};
} catch (error) {
  console.error('[Page] Failed to load content:', error);
  return Astro.redirect('/404');
}
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{manifest.title || 'Page'}</title>
  </head>
  <body>
    <Render config={config} data={puckData} />
  </body>
</html>
`;
}

const PUCK_CONFIG_TEMPLATE = `import type { Config } from '@measured/puck';

// Define component props types
type Components = {
  h1: {
    text: string;
  };
  p: {
    text: string;
  };
};

// Simple component renderers
const H1 = ({ text }: { text: string }) => <h1 className="text-3xl font-bold mb-4">{text || 'Heading'}</h1>;
const P = ({ text }: { text: string }) => <p className="mb-4">{text || 'Paragraph'}</p>;

// Puck configuration
const puckConfig: Config<Components> = {
  components: {
    h1: {
      fields: {
        text: { type: 'text' },
      },
      defaultProps: {
        text: 'Heading',
      },
      render: H1,
    },
    p: {
      fields: {
        text: { type: 'textarea' },
      },
      defaultProps: {
        text: 'Paragraph text',
      },
      render: P,
    },
  },
};

export default puckConfig;
`;

export async function generateRoutes(projectPath: string = '.', siteName: string = 'default') {
  try {
    const absolutePath = resolve(projectPath);

    // Create src/pages directory if it doesn't exist
    const pagesDir = join(absolutePath, 'src', 'pages');
    await mkdir(pagesDir, { recursive: true });

  // Write the [...slug].astro file
  const slugFilePath = join(pagesDir, '[...slug].astro');
  await writeFile(slugFilePath, getSlugRouteTemplate(siteName), 'utf-8');
  console.log(`✅ Created dynamic route: ${slugFilePath} (site: ${siteName})`);

    // Check if puck.config.tsx exists, if not create it
    const puckConfigPath = join(absolutePath, 'src', 'puck.config.tsx');
    try {
      await readFile(puckConfigPath);
      console.log(`ℹ️  Puck config already exists: ${puckConfigPath}`);
    } catch {
      await writeFile(puckConfigPath, PUCK_CONFIG_TEMPLATE, 'utf-8');
      console.log(`✅ Created Puck config: ${puckConfigPath}`);
    }

    console.log('\\n✨ Route generation complete!');
    console.log('\\nNext steps:');
    console.log('1. Customize the [...slug].astro file to add your layout');
    console.log('2. Add more component types to your puck.config.tsx');
    console.log('3. Start your dev server and visit /__cms to edit pages');
  } catch (error) {
    console.error('❌ Error generating routes:', error);
    throw error;
  }
}
