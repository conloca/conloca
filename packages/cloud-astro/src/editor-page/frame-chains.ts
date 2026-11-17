import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type EditorDataBindings, isContentPublished } from '@conloca/content-api';
import { FileSystemContentAPI, type Site } from '@conloca/content-api/node';
import { runnerImport, type UserConfig } from 'vite';
import { PACKAGE_NAME } from '../constants.js';
import { type AncestorElement, ancestorChain } from '../doctor/ancestor-chain.js';
import { messageOf } from '../message-of.js';
import { cleanPagePath } from '../preview/preview-path.js';

const VIRTUAL_ID = 'virtual:conloca-frame-chains';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

/**
 * What `_conloca/editor/frames.json` holds: each framed route's published page, at the path the site serves it at,
 * and the elements its frame wraps it in.
 */
export interface FramesFile {
  version: 1;
  entries: { route: string; pathname: string; chain: AncestorElement[] }[];
}

/**
 * Renders each route's frame around a page-root marker with the site's React, through the site's Vite plugins, and
 * reads the elements between `<body>` and the marker. Each frame loads in its own runner (the runner closes once the
 * import settles), so a frame that fails costs only its route, under `failures`.
 */
export async function renderFrameChains(input: {
  root: string;
  vite: UserConfig;
  frames: Record<string, string>;
  pathnames: Record<string, string>;
}): Promise<{ chains: Record<string, AncestorElement[]>; failures: Record<string, string> }> {
  const chains: Record<string, AncestorElement[]> = {};
  const failures: Record<string, string> = {};
  for (const [route, path] of Object.entries(input.frames)) {
    const code = [
      "import { createElement } from 'react';",
      "import { renderToStaticMarkup } from 'react-dom/server';",
      `import Frame from ${JSON.stringify(path)};`,
      'export function render(route, pathname) {',
      "  return renderToStaticMarkup(createElement(Frame, { pathname }, createElement('div', { 'data-conloca-page-root': '' })));",
      '}',
      '',
    ].join('\n');
    try {
      // One frame at a time: each runner loads the site's Vite plugins, and a failure must cost only its route.
      // oxlint-disable-next-line eslint/no-await-in-loop -- see above.
      const { module } = await runnerImport<{ render: (route: string, pathname: string) => string }>(VIRTUAL_ID, {
        ...input.vite,
        configFile: false,
        root: input.root,
        logLevel: 'warn',
        plugins: [
          ...(input.vite.plugins ?? []),
          {
            name: 'conloca-frame-chains',
            resolveId: (id) => (id === VIRTUAL_ID ? RESOLVED_ID : undefined),
            load: (id) => (id === RESOLVED_ID ? code : undefined),
          },
        ],
      });
      const chain = ancestorChain(`<body>${module.render(route, input.pathnames[route] ?? '/')}</body>`);
      if (chain === undefined) failures[route] = 'the frame did not render its children';
      else chains[route] = chain;
    } catch (error) {
      failures[route] = messageOf(error);
    }
  }
  return { chains, failures };
}

/**
 * Writes `<folder>/frames.json` when a routing entry declares an editor frame: per framed entry, the first page of its
 * collection that is published at build time in the default locale, and its frame's chain. The page's path gets the
 * trailing slash Astro's `trailingSlash` and `build.format` give it, so CC30 fetches it without a redirect. Never
 * fails the build.
 */
export async function emitFrameChains(input: {
  folder: string;
  root: string;
  vite: UserConfig;
  editorFrames: Record<string, string> | undefined;
  dataBindings: EditorDataBindings | undefined;
  contentRoot: string | undefined;
  buildTime?: Date;
  trailingSlash: 'always' | 'never' | 'ignore';
  buildFormat: 'directory' | 'file' | 'preserve';
  logger: { info(message: string): void; warn(message: string): void };
}): Promise<void> {
  const { dataBindings, logger } = input;
  const framed = (dataBindings?.entries ?? []).flatMap((entry) => {
    const path = entry.frame === undefined ? undefined : input.editorFrames?.[entry.frame];
    return path === undefined ? [] : [{ route: entry.name, collection: entry.collection, path }];
  });
  if (framed.length === 0 || dataBindings === undefined) return;
  if (input.contentRoot === undefined) {
    logger.info('no content root, so frames.json is not written');
    return;
  }
  const buildTime = input.buildTime ?? new Date();
  let site: Site | null;
  try {
    site = (await FileSystemContentAPI.create({ contentRoot: input.contentRoot })).getSite(dataBindings.siteName);
  } catch (error) {
    logger.warn(`${PACKAGE_NAME}: the content could not be read, so frames.json is not written: ${messageOf(error)}`);
    return;
  }
  const frames: Record<string, string> = {};
  const pathnames: Record<string, string> = {};
  for (const { route, collection, path } of framed) {
    // Scheduled pages are left out: frames.json is public.
    let pathname: string | undefined;
    for (const manifest of site?.listContent({ collection, locales: [dataBindings.locale] }) ?? []) {
      const localized = manifest.locales[dataBindings.locale];
      if (localized && !localized.unpublished && isContentPublished(localized, buildTime)) {
        pathname = localized.pathname;
        break;
      }
    }
    if (pathname === undefined) {
      logger.info(`route ${route} has no published page, so frames.json leaves its editor frame out`);
      continue;
    }
    frames[route] = path;
    pathnames[route] = pathname;
  }
  if (Object.keys(frames).length === 0) return;
  const { chains, failures } = await renderFrameChains({ root: input.root, vite: input.vite, frames, pathnames });
  for (const [route, message] of Object.entries(failures)) {
    logger.warn(
      `${PACKAGE_NAME}: the editor frame of route ${route} (${frames[route]}) failed to render, so frames.json leaves it out: ${message}`,
    );
  }
  const entries = Object.keys(chains).map((route) => ({
    route,
    pathname: cleanPagePath(pathnames[route], input.trailingSlash, input.buildFormat),
    chain: chains[route],
  }));
  if (entries.length === 0) return;
  const file: FramesFile = { version: 1, entries };
  await writeFile(join(input.folder, 'frames.json'), `${JSON.stringify(file, null, 2)}\n`);
}
