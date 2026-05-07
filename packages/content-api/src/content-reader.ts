import type { ContentAPIOptions } from './types';

export type ContentReaderOptions = ContentAPIOptions;

/**
 * Creates a read-oriented content API instance for build-time consumers.
 *
 * The filesystem implementation is loaded lazily so build tooling does not
 * eagerly traverse native hashing dependencies through the reader entrypoint.
 */
export async function createContentAPI(options: ContentReaderOptions) {
  const { FileSystemContentAPI: ReaderAPI } = await import('./filesystem-content-api');

  return ReaderAPI.create({
    ...options,
    canvasDir: options.canvasDir || './canvas',
  });
}
