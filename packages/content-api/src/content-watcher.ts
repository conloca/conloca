import { normalize, resolve } from 'node:path';
import { FileSystemContentAPI } from './filesystem-content-api.js';
import type { ContentAPIOptions } from './types.js';

export type ContentWatcherOptions = ContentAPIOptions;

export interface WebSocketSender {
  send(payload: { type: string; event: string; data: any }): void;
}

export interface ContentWatchEvent {
  file: string;
  action: 'update' | 'create' | 'delete';
  inMdxRoot: boolean;
  inContentRoot: boolean;
  /** The change is this process's own write, already known to the editor that made it. */
  ownWrite: boolean;
}

interface ReindexResultLike {
  updated: unknown[];
  deleted?: { id: string; locale: string; kind: 'page' | 'fragment' | 'data' }[];
}

interface ReindexableContentAPI {
  reindex(paths: string[], options?: { handleDeletions?: boolean }): Promise<ReindexResultLike>;
  /** Whether the file holds this process's own last write there. */
  isOwnWriteFile?(filePath: string): boolean;
}

/**
 * The files the content scanner indexes: .mdx and .vxjson, and .json only under the content root's data/ directory.
 * Other .json files under the content root, such as asset metadata records, are not content.
 */
export function isWatchedContentFile(file: string, options: { contentRoot: string }): boolean {
  const normalizedFile = normalize(resolve(file));
  if (normalizedFile.endsWith('.mdx') || normalizedFile.endsWith('.vxjson')) return true;
  return (
    normalizedFile.endsWith('.json') && normalizedFile.startsWith(`${normalize(resolve(options.contentRoot))}/data/`)
  );
}

/**
 * Creates a content API instance for the given options
 */
export async function createContentAPI(options: ContentWatcherOptions): Promise<FileSystemContentAPI> {
  return await FileSystemContentAPI.create({
    ...options,
    canvasDir: options.canvasDir || './canvas',
  });
}

/**
 * Creates file change handlers for content watching
 */
export function createContentWatchHandlers(
  contentApi: ReindexableContentAPI,
  options: ContentWatcherOptions,
  ws: WebSocketSender,
  onReindexed?: (event: ContentWatchEvent) => void | Promise<void>,
) {
  const handleFileChange = async (file: string, action: 'update' | 'create' | 'delete') => {
    // Normalize paths for consistent comparison
    const normalizedFile = normalize(resolve(file));
    const normalizedRoot = normalize(resolve(options.contentRoot));
    const normalizedMdxRoot = options.mdxPagesRoot ? normalize(resolve(options.mdxPagesRoot)) : null;

    if (!isWatchedContentFile(normalizedFile, options)) {
      return;
    }

    // Trailing-slash guard avoids prefix collisions
    // (e.g. `/foo/content-extra/...` matching root `/foo/content`).
    const inContentRoot = normalizedFile === normalizedRoot || normalizedFile.startsWith(`${normalizedRoot}/`);
    const inMdxRoot =
      !!normalizedMdxRoot &&
      (normalizedFile === normalizedMdxRoot || normalizedFile.startsWith(`${normalizedMdxRoot}/`));

    if (inContentRoot || inMdxRoot) {
      const matchedRoot = inContentRoot ? normalizedRoot : (normalizedMdxRoot as string);
      const relativePath = normalizedFile.replace(`${matchedRoot}/`, '');
      console.log(`[Content] ${action}: ${relativePath}`);
      // Judged when the event fires: the editor already holds its own write or delete, so announcing it would refetch
      // for nothing.
      const ownWrite = contentApi.isOwnWriteFile?.(normalizedFile) ?? false;

      try {
        // Reindex the file
        const reindexOptions = action === 'delete' ? { handleDeletions: true } : undefined;
        const result = await contentApi.reindex([normalizedFile], reindexOptions);

        // Send updates for each changed locale
        for (const manifest of ownWrite ? [] : result.updated) {
          const message = {
            type: 'custom',
            event: 'conloca:content-update',
            data: {
              action,
              manifest,
            },
          };
          ws.send(message);
        }

        // Send deletion updates
        if (action === 'delete' && !ownWrite && result.deleted) {
          for (const deletion of result.deleted) {
            ws.send({
              type: 'custom',
              event: 'conloca:content-update',
              data: {
                action: 'delete',
                ...deletion,
              },
            });
          }
        }
      } catch (error) {
        console.error('[Content Watcher] Reindex failed:', error);
        return;
      }

      try {
        await onReindexed?.({ file: normalizedFile, action, inMdxRoot, inContentRoot, ownWrite });
      } catch (error) {
        console.error('[Content Watcher] onReindexed callback failed:', error);
      }
    }
  };

  return {
    onChange: (file: string) => handleFileChange(file, 'update'),
    onAdd: (file: string) => handleFileChange(file, 'create'),
    onUnlink: (file: string) => handleFileChange(file, 'delete'),
  };
}
