import { relative } from 'node:path';
import { fail, withStdoutRedirected } from '../lib/cli-output.js';
import { contentRootOf } from '../lib/content-root.js';
import { PageWriteError, type PageWriteResult, writePage } from '../lib/page-write.js';

export interface PageCreateOptions {
  site: string;
  collection: string;
  pathname: string;
  title: string;
  json: boolean;
}

/**
 * The library names the input field it refused; the CLI names the flag the
 * user typed and the command that fixes the problem.
 */
function toCliMessage(error: PageWriteError, directory: string, options: PageCreateOptions): string {
  switch (error.reason) {
    case 'missing_leading_slash':
      return `--pathname must start with '/' (got '${options.pathname}')`;
    case 'no_sites_configured':
      return `${error.message} — run 'conloca init ${directory} ${options.site}' first`;
    default:
      return error.message;
  }
}

export async function pageCreate(directory: string, options: PageCreateOptions): Promise<void> {
  try {
    await createPage(directory, options);
  } catch (error) {
    fail(options.json, error instanceof Error ? error.message : String(error));
  }
}

async function createPage(directory: string, options: PageCreateOptions): Promise<void> {
  const contentRoot = contentRootOf(directory);
  const { json } = options;

  let written: PageWriteResult;
  try {
    written = await withStdoutRedirected(json, () =>
      writePage({
        contentRoot,
        site: options.site,
        collection: options.collection,
        pathname: options.pathname,
        title: options.title,
      }),
    );
  } catch (error) {
    if (error instanceof PageWriteError) {
      fail(json, toCliMessage(error, directory, options), error.field);
    }
    throw error;
  }

  const relPath = relative(process.cwd(), written.filePath);

  if (json) {
    console.log(JSON.stringify({ ok: true, id: written.id, path: relPath }));
    return;
  }
  console.log(`✓ Created page ${written.pathname} (${written.id})`);
  console.log(`  File: ${relPath}`);
  console.log('The page is now editable in the CMS.');
}
