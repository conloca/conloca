import { FileSystemContentAPI } from '@conloca/content-api/node';
import { stat } from 'fs/promises';
import { resolve } from 'path';

export async function verify(directory: string): Promise<void> {
  const resolvedPath = resolve(directory);

  // Check if directory exists
  try {
    const stats = await stat(resolvedPath);
    if (!stats.isDirectory()) {
      console.error('Directory not found');
      process.exit(1);
    }
  } catch {
    console.error('Directory not found');
    process.exit(1);
  }

  try {
    // Initialize the filesystem content API
    const contentApi = await FileSystemContentAPI.create({
      contentRoot: resolvedPath,
    });

    // Try to list all content to verify it loads correctly
    let contentCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    for (const manifest of contentApi.listAllContent()) {
      contentCount++;

      // Get all locales for this content
      for (const locale of Object.keys(manifest.locales)) {
        try {
          // Loading the content will trigger repairs if needed
          const content = await contentApi.getLocalized(manifest.id, locale);
          if (!content) {
            errorCount++;
            errors.push(`Failed to load content ${manifest.id} for locale ${locale}`);
          } else {
            console.log(`  Processed: ${manifest.id} (${locale})`);
          }
        } catch (error: unknown) {
          errorCount++;
          errors.push(`Error loading ${manifest.id} (${locale}): ${error}`);
        }
      }
    }

    if (errorCount > 0) {
      console.error('Content verification failed');
      for (const error of errors) {
        console.error(`  - ${error}`);
      }
      process.exit(1);
    }

    console.log('✓ Content verification successful');
    console.log(`  Verified ${contentCount} content items`);
    console.log(
      '\nNote: Files missing required fields (id, created, modified) are automatically repaired during loading.',
    );
  } catch (error: unknown) {
    console.error('Content verification failed');
    console.error(`  ${error}`);
    process.exit(1);
  }
}
