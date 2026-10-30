import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AssetOperations } from '@conloca/content-api/node';
import { fail, withStdoutRedirected } from '../lib/cli-output.js';
import { callOptions, stringLiteral, stripComments } from '../lib/config-text.js';
import { ASTRO_CONFIG_FILES, readAstroOption } from '../lib/connect/astro-config.js';
import { contentRootOf } from '../lib/content-root.js';
import { messageOf } from '../lib/message-of.js';
import { ensureDataWiring } from './data.js';

export interface AssetAddOptions {
  folder?: string;
  alt?: string;
  install: boolean;
  json: boolean;
}

/** The site's `assetsPath`, `publicDir` and `base` as plain strings; exits through `fail` when the config computes one. */
async function readMediaOptions(
  projectDir: string,
  json: boolean,
): Promise<{ assetsPath: string; publicDir: string; base: string }> {
  const configFile = ASTRO_CONFIG_FILES.map((name) => join(projectDir, name)).find((path) => existsSync(path));
  if (configFile === undefined) fail(json, `no astro.config in ${projectDir}`);
  const text = await readFile(configFile, 'utf8');
  const options = callOptions(stripComments(text), 'conlocaCMS');
  const assetsPath = options.state === 'literal' ? stringLiteral(options.entries.get('assetsPath') ?? '') : null;
  if (assetsPath === null)
    fail(json, 'astro.config sets assetsPath in a way asset add cannot read; set it to a plain string');
  const publicDir = readAstroOption(text, 'publicDir');
  if (publicDir === undefined) fail(json, 'astro.config computes publicDir; asset add needs a plain value');
  const base = readAstroOption(text, 'base');
  if (base === undefined) fail(json, 'astro.config computes base; asset add needs a plain value');
  return { assetsPath, publicDir: publicDir ?? './public', base: base ?? '/' };
}

/**
 * Copy the image `file` into the site's media folder, wiring the folder first when the site has none, and print the
 * reference a field stores.
 */
export async function assetAdd(file: string, directory: string, options: AssetAddOptions): Promise<void> {
  const { json } = options;
  try {
    const projectDir = resolve(directory);
    // Before the wiring, so a mistyped file name leaves the site untouched.
    const bytes = await readFile(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') fail(json, `no file ${file}`);
      throw error;
    });
    const image = new File([bytes], basename(file));
    // Outside withStdoutRedirected: it may fail, and fail's --json report belongs on stdout.
    const wiring = await ensureDataWiring(projectDir, options);
    // Read after the wiring: it may just have added assetsPath.
    const { assetsPath, publicDir, base } = await readMediaOptions(projectDir, json);
    const assetsFolder = resolve(projectDir, assetsPath);
    // Lazy, as in page create: only the commands that read a site's config load @conloca/astro-cms.
    const { deriveAssetRefBase } = await import('@conloca/astro-cms/checks');
    const refBase = deriveAssetRefBase(assetsFolder, pathToFileURL(`${resolve(projectDir, publicDir)}/`), base);

    const assets = new AssetOperations({ assetsPath: assetsFolder, contentRoot: contentRootOf(directory) });
    const uploaded = await withStdoutRedirected(json, () =>
      assets.upload(image, { alt: options.alt, folder: options.folder }),
    );
    if (!uploaded.success) fail(json, uploaded.error);

    // upload always sets the folder: '/' for the media folder itself, '/team' for one inside it.
    const { filename, folder = '/' } = uploaded.asset;
    const stored = folder === '/' ? filename : `${folder.slice(1)}/${filename}`;
    const ref = `${refBase}/${stored}`;
    const path = relative(process.cwd(), join(assetsFolder, stored));
    if (json) {
      console.log(
        JSON.stringify({
          ok: true,
          ref,
          path,
          ...(wiring.files.length > 0 ? { wired: wiring.files } : {}),
          ...(wiring.command === undefined ? {} : { command: wiring.command }),
        }),
      );
    } else {
      if (wiring.files.length > 0) console.log(`✓ Wired data schemas: ${wiring.files.join(', ')}`);
      if (wiring.command !== undefined) console.log(`  Add their packages: ${wiring.command}`);
      console.log(`✓ Added ${ref}`);
      console.log(`  File: ${path}`);
    }
  } catch (error) {
    fail(json, messageOf(error));
  }
}
