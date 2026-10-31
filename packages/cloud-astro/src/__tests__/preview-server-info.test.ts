import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emitPreviewServerInfo } from '../editor-page/emit.js';

let dir = '';
afterEach(async () => {
  if (dir !== '') await rm(dir, { recursive: true, force: true });
});

describe('emitPreviewServerInfo', () => {
  it('writes conloca.json alone, naming d4, so a release mismatch with the site shows', async () => {
    dir = await mkdtemp(join(tmpdir(), 'preview-server-info-'));
    const quiet = { info: () => undefined, warn: () => undefined };
    await emitPreviewServerInfo(dir, { root: dir, repoUri: 'acme/site', siteIdOverride: 'website', logger: quiet });
    const info = JSON.parse(await readFile(join(dir, '_conloca/editor/conloca.json'), 'utf8'));
    expect(info).toMatchObject({ repo: 'acme/site', siteId: 'website', preview: { mode: 'd4', protocol: 2 } });
    expect(info.builtWith).toMatch(/^@conloca\/cloud-astro@/);
    expect(existsSync(join(dir, '_conloca/editor/index.html'))).toBe(false);
  });
});
