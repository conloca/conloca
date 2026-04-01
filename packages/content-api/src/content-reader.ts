export interface ContentReaderOptions {
  contentRoot: string;
  canvasDir?: string;
}

/**
 * Creates a read-oriented content API instance for build-time consumers.
 *
 * The filesystem implementation is loaded lazily so build tooling does not
 * eagerly traverse native hashing dependencies through the reader entrypoint.
 */
export async function createContentAPI(options: ContentReaderOptions) {
  const { FileSystemContentAPI: ReaderAPI } = await import('./filesystem-content-api');

  return ReaderAPI.create({
    contentRoot: options.contentRoot,
    canvasDir: options.canvasDir || './canvas',
  });
}
