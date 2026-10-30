import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fail, withStdoutRedirected } from '../lib/cli-output.js';
import { contentRootOf } from '../lib/content-root.js';
import { readJsonInput } from '../lib/json-input.js';
import {
  isPuckData,
  type PageMetaFlags,
  PageWriteError,
  type PageWriteResult,
  type PuckPayload,
  writePage,
} from '../lib/page-write.js';
import { declaredPageCollections } from './doctor-astro.js';

/** The metadata flags `page create` and `page update` share, named as typed. */
export interface PageMetaOptions {
  description?: string;
  image?: string;
  canonical?: string;
  robots?: string;
}

export interface PageCreateOptions extends PageMetaOptions {
  site: string;
  collection: string;
  pathname: string;
  title: string;
  /** A Puck data file, or '-' for stdin. */
  content?: string;
  json: boolean;
}

/** The page-settings meta keys the metadata flags write. */
export function metaFlagsOf(options: PageMetaOptions): PageMetaFlags {
  return {
    description: options.description,
    ogImage: options.image,
    canonical: options.canonical,
    robots: options.robots,
  };
}

/** The Puck data `--content` points at, or undefined without the flag; refuses anything that is not Puck data. */
export async function readPuckContent(source: string | undefined): Promise<PuckPayload | undefined> {
  if (source === undefined) return undefined;
  const value = await readJsonInput(source, '--content');
  if (!isPuckData(value)) {
    throw new PageWriteError('invalid_input', '--content must be Puck data { root, content, zones }', '--content');
  }
  return value;
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

/**
 * A warning when the project's content config plainly does not declare
 * `collection`, so the build would fail on the new page; null when it does or
 * when its text cannot tell. The config is read as text, never run.
 */
async function undeclaredCollectionWarning(directory: string, collection: string): Promise<string | null> {
  // Lazy, as in doctor: only the commands that read a site's config load @conloca/astro-cms.
  const { findContentConfig } = await import('@conloca/astro-cms/checks');
  const configPath = findContentConfig(resolve(directory));
  const text = configPath === null ? null : await readFile(configPath, 'utf-8').catch(() => null);
  const declared = text === null ? null : declaredPageCollections(text);
  if (configPath === null || declared === null || declared.has(collection)) return null;
  return (
    `${relative(process.cwd(), configPath)} declares no page collection "${collection}", so the build fails on this page. ` +
    `Declare it with conlocaPages({ collection: '${collection}' }) and give it a route in conlocaCMS({ routing }).`
  );
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
    const puckData = await readPuckContent(options.content);
    written = await withStdoutRedirected(json, () =>
      writePage({
        contentRoot,
        site: options.site,
        collection: options.collection,
        pathname: options.pathname,
        title: options.title,
        puckData,
        meta: metaFlagsOf(options),
      }),
    );
  } catch (error) {
    if (error instanceof PageWriteError) {
      fail(json, toCliMessage(error, directory, options), error.field);
    }
    throw error;
  }

  const relPath = relative(process.cwd(), written.filePath);
  // Advisory only: the page is already written, so a failed check stays silent.
  const warning = await undeclaredCollectionWarning(directory, options.collection).catch(() => null);

  if (json) {
    console.log(
      JSON.stringify({ ok: true, id: written.id, path: relPath, ...(warning ? { warnings: [warning] } : {}) }),
    );
  } else {
    console.log(`✓ Created page ${written.pathname} (${written.id})`);
    console.log(`  File: ${relPath}`);
    console.log('The page is now editable in the CMS.');
  }
  if (warning) console.error(`Warning: ${warning}`);
}
