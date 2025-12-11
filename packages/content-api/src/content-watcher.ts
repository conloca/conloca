import { normalize, resolve } from 'path';
import { FileSystemContentAPI } from './filesystem-content-api';

export interface ContentWatcherOptions {
  contentRoot: string;
  canvasDir?: string;
}

export interface WebSocketSender {
  send(payload: { type: string; event: string; data: any }): void;
}

/**
 * Creates a content API instance for the given options
 */
export async function createContentAPI(options: ContentWatcherOptions): Promise<FileSystemContentAPI> {
  return await FileSystemContentAPI.create({
    contentRoot: options.contentRoot,
    canvasDir: options.canvasDir || './canvas',
  });
}

/**
 * Creates file change handlers for content watching
 */
export function createContentWatchHandlers(
  contentApi: FileSystemContentAPI,
  options: ContentWatcherOptions,
  ws: WebSocketSender,
) {
  const handleFileChange = async (file: string, action: 'update' | 'create' | 'delete') => {
    // Only process content files (.mdx, .vxjson, and .json in data/ directory)
    const isContentFile = file.endsWith('.mdx') || file.endsWith('.vxjson');
    const isDataFile = file.endsWith('.json') && file.includes('/data/');
    if (!isContentFile && !isDataFile) {
      return;
    }

    // Normalize paths for consistent comparison
    const normalizedFile = normalize(resolve(file));
    const normalizedRoot = normalize(resolve(options.contentRoot));

    if (normalizedFile.startsWith(normalizedRoot)) {
      const relativePath = normalizedFile.replace(normalizedRoot + '/', '');
      console.log(`[Content] ${action}: ${relativePath}`);

      try {
        // Reindex the file
        const reindexOptions = action === 'delete' ? { handleDeletions: true } : undefined;
        const result = await contentApi.reindex([normalizedFile], reindexOptions);

        // Send updates for each changed locale
        for (const manifest of result.updated) {
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
        if (action === 'delete' && result.deleted) {
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
    }
  };

  return {
    onChange: (file: string) => handleFileChange(file, 'update'),
    onAdd: (file: string) => handleFileChange(file, 'create'),
    onUnlink: (file: string) => handleFileChange(file, 'delete'),
  };
}
