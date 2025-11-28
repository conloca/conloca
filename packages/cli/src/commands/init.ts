import type { SitesConfig } from '@conloca/content-api';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join, resolve } from 'path';

export async function init(directory: string, siteName: string): Promise<void> {
  const resolvedPath = resolve(directory);
  const contentPath = join(resolvedPath, 'content');

  try {
    // Create the directory structure
    const contentDirs = [contentPath, join(contentPath, siteName, 'pages'), join(contentPath, 'blocks', 'shared')];

    for (const dir of contentDirs) {
      await mkdir(dir, { recursive: true });
      console.log(`  Created: ${dir}`);
    }

    // Handle sites.json - either update existing or create new
    const sitesJsonPath = join(contentPath, 'sites.json');
    let sitesConfig: SitesConfig = {
      sites: {},
      globalLocales: ['en', 'nl', 'de', 'fr'],
    };

    try {
      const existingContent = await readFile(sitesJsonPath, 'utf-8');
      const parsed = JSON.parse(existingContent);
      // Handle old format (direct site entries) or new format (with sites property)
      if (parsed.sites) {
        sitesConfig = parsed;
      } else {
        // Migrate old format to new format
        sitesConfig.sites = parsed;
      }
      console.log('  Found existing sites.json');
    } catch (error) {
      // File doesn't exist or is invalid, start fresh
    }

    // Add or update the site configuration
    if (!sitesConfig.sites[siteName]) {
      sitesConfig.sites[siteName] = {
        locales: ['en', 'nl', 'de', 'fr'],
        defaultLocale: 'en',
      };
      await writeFile(sitesJsonPath, JSON.stringify(sitesConfig, null, 2) + '\n', 'utf-8');
      console.log(`  Updated: ${sitesJsonPath} (added site: ${siteName})`);
    } else {
      console.log(`  Site '${siteName}' already exists in sites.json`);
    }

    console.log(`\n✓ Initialized Conloca content structure for site '${siteName}' in ${resolvedPath}`);
    console.log('\nNext steps:');
    console.log(`  1. cd ${directory}`);
    console.log(`  2. Create your first page in content/${siteName}/pages/`);
    console.log(`  3. Run 'conloca verify content' to check your content`);
  } catch (error) {
    console.error('Failed to initialize content structure');
    console.error(`  ${error}`);
    process.exit(1);
  }
}
