import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The URL the site serves its media folder at, which is what a stored image reference must say. */
export function deriveAssetRefBase(assetsPath: string, publicDir: URL, base: string): string {
  // Resolved against the working directory, as the asset API resolves it
  // when it writes an upload.
  const folder = resolve(assetsPath);
  const publicFolder = fileURLToPath(publicDir);
  const servedPath = pathWithin(publicFolder, folder) ?? pathThroughLink(publicFolder, folder);
  if (servedPath === undefined) {
    throw new Error(
      `[Conloca] The site does not serve assetsPath "${assetsPath}" (${folder}), so every image the editor ` +
        `stores from it would be a broken link. Move the folder inside publicDir (${publicFolder}), ` +
        'or keep it where it is and put a link to it (a symlink) directly inside publicDir.',
    );
  }
  const siteBase = base.replace(/\/+$/, '');
  return servedPath ? `${siteBase}/${servedPath.split(sep).join('/')}` : siteBase;
}

/** `path` relative to `folder` when it is `folder` or inside it. */
function pathWithin(folder: string, path: string): string | undefined {
  const rel = relative(folder, path);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined;
  return rel;
}

/**
 * The served path of `folder` when a link directly inside the public folder
 * points at it or at one of its parents, which is how a site exposes media it
 * keeps outside the public folder.
 */
function pathThroughLink(publicFolder: string, folder: string): string | undefined {
  // A folder that does not exist yet has no real location to compare, and a
  // missing public folder holds no links.
  if (!existsSync(folder) || !existsSync(publicFolder)) return undefined;
  const realFolder = realpathSync(folder);
  for (const entry of readdirSync(publicFolder, { withFileTypes: true })) {
    const link = join(publicFolder, entry.name);
    // A link to nothing cannot lead to a folder that exists.
    if (!entry.isSymbolicLink() || !existsSync(link)) continue;
    const rest = pathWithin(realpathSync(link), realFolder);
    if (rest !== undefined) return join(entry.name, rest);
  }
  return undefined;
}
