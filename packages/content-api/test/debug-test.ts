import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemContentAPI } from '../src/filesystem-content-api.js';

async function debug() {
  const tempDir = await mkdtemp(join(tmpdir(), 'conloca-debug-'));
  const contentRoot = join(tempDir, 'content');
  const canvasDir = join(tempDir, 'canvas');

  const contentApi = await FileSystemContentAPI.create({
    contentRoot,
    canvasDir,
  });

  console.log('Creating content...');
  const result = await contentApi.createContent({
    kind: 'page',
    site: 'shop',
    collection: 'pages',
    type: 'puck',
    locales: {
      nl: {
        meta: { title: 'Home', pathname: '/home' },
        content: { puckData: { root: {} } },
      },
    },
  });
  console.log('Result:', result);

  if (result.success) {
    console.log('Checking files in pages directory...');
    const collectionPath = join(contentRoot, 'shop', 'pages');
    try {
      const files = await readdir(collectionPath);
      console.log('Files found:', files);
    } catch (e) {
      console.log('Error reading directory:', e);
    }
  }

  await rm(tempDir, { recursive: true, force: true });
}

debug().catch(console.error);
