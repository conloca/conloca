import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { contentRootOf } from '../lib/content-root.js';
import { ensureSiteInSitesConfig } from '../lib/sites-config.js';

export async function init(directory: string, siteName: string): Promise<void> {
  const contentPath = contentRootOf(directory);

  try {
    // Create the directory structure
    const contentDirs = [contentPath, join(contentPath, siteName, 'pages'), join(contentPath, 'fragments', 'shared')];

    for (const dir of contentDirs) {
      await mkdir(dir, { recursive: true });
      console.log(`  Created: ${dir}`);
    }

    // Handle sites.json - either update existing or create new
    const sites = await ensureSiteInSitesConfig(contentPath, siteName);
    if (sites.existed) {
      console.log('  Found existing sites.json');
    }
    if (sites.added) {
      console.log(`  Updated: ${sites.path} (added site: ${siteName})`);
    } else {
      console.log(`  Site '${siteName}' already exists in sites.json`);
    }

    console.log(`\n✓ Initialized Conloca content structure for site '${siteName}' in ${contentPath}`);
    console.log('\nNext steps:');
    console.log(`  1. Create your first page in ${join(contentPath, siteName, 'pages')}`);
    console.log(`  2. Run 'conloca doctor' to check the setup`);
    console.log(`  3. Point the conlocaCMS() contentRoot option at ${contentPath}`);
  } catch (error) {
    console.error('Failed to initialize content structure');
    console.error(`  ${error}`);
    process.exit(1);
  }
}
