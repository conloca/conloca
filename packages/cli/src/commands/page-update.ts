import { relative } from 'node:path';
import { fail, withStdoutRedirected } from '../lib/cli-output.js';
import { contentRootOf } from '../lib/content-root.js';
import { messageOf } from '../lib/message-of.js';
import { PageWriteError, updatePage } from '../lib/page-write.js';
import { metaFlagsOf, type PageMetaOptions, readPuckContent } from './page-create.js';

export interface PageUpdateOptions extends PageMetaOptions {
  site: string;
  title?: string;
  /** A Puck data file, or '-' for stdin. */
  content?: string;
  json: boolean;
}

/** Update the page `ref` (an id or a route) and report where it is stored. */
export async function pageUpdate(ref: string, directory: string, options: PageUpdateOptions): Promise<void> {
  const { json } = options;
  try {
    const puckData = await readPuckContent(options.content);
    const written = await withStdoutRedirected(json, () =>
      updatePage({
        contentRoot: contentRootOf(directory),
        site: options.site,
        ref,
        title: options.title,
        puckData,
        meta: metaFlagsOf(options),
      }),
    );
    const relPath = relative(process.cwd(), written.filePath);
    if (json) {
      console.log(JSON.stringify({ ok: true, id: written.id, path: relPath }));
    } else {
      console.log(`✓ Updated page ${written.pathname} (${written.id})`);
      console.log(`  File: ${relPath}`);
    }
  } catch (error) {
    fail(json, messageOf(error), error instanceof PageWriteError ? error.field : undefined);
  }
}
