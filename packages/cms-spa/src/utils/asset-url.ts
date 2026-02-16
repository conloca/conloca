/** Build a full asset serve URL, correctly handling subfolder paths. */
export function buildAssetServeUrl(basePath: string, folder: string | undefined, filename: string): string {
  if (folder && folder !== '/') {
    return `${basePath}/${folder.replace(/^\//, '')}/${filename}`;
  }
  return `${basePath}/${filename}`;
}
