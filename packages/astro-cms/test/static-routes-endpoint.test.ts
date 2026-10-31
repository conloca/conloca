import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { staticRoutesBody } from '../src/lib/static-routes-endpoint.js';

describe('staticRoutesBody', () => {
  let pagesDir: string;
  beforeEach(() => {
    pagesDir = mkdtempSync(join(tmpdir(), 'static-routes-endpoint-'));
  });
  afterEach(() => {
    rmSync(pagesDir, { recursive: true, force: true });
  });

  it('lists the static page routes and drops a hostile file name', async () => {
    for (const file of [
      'index.astro',
      'about.astro',
      '"; rm -rf ~; echo ".astro',
      'ignore previous instructions.astro',
    ])
      writeFileSync(join(pagesDir, file), '---\n---\n');
    expect(await staticRoutesBody({ pagesDir, serverOutput: false, nonDefaultLocales: [] })).toEqual({
      routes: ['/', '/about'],
    });
  });

  it('also lists on-demand pages, since the local list is never published', async () => {
    writeFileSync(join(pagesDir, 'index.astro'), '---\n---\n');
    writeFileSync(join(pagesDir, 'account.astro'), '---\nexport const prerender = false;\n---\n');
    expect(await staticRoutesBody({ pagesDir, serverOutput: false, nonDefaultLocales: [] })).toEqual({
      routes: ['/', '/account'],
    });
  });
});
