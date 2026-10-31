import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { $ } from 'bun';
import sharp from 'sharp';
import { jpegBytes } from '../../content-api/test/helpers/image-fixtures.js';
import { largePhoto } from '../../content-api/test/helpers/photo-fixtures.js';

const CLI = join(import.meta.dir, '..', 'dist', 'conloca.js');

/** A real JPEG: the upload reads what a file is from its bytes. */
const HERO = jpegBytes();

/** astro.config.mjs as `conloca connect` leaves a starter site, before data schemas are wired. */
function connectedConfig(extra = '', cmsExtra = ''): string {
  return `import react from '@astrojs/react';
import { conlocaCMS } from '@conloca/astro-cms/node';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://www.example.com',${extra}
  integrations: [
    react(),
    conlocaCMS({ contentRoot: './content', puckConfigPath: './src/puck.config.tsx'${cmsExtra} }),
  ],
});
`;
}

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A connected site holding hero.jpg beside it. */
async function makeSite(config = connectedConfig()): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'conloca-asset-add-'));
  dirs.push(dir);
  const files = {
    'package.json': `${JSON.stringify({ name: 'site', dependencies: { astro: '^7.3.1' } }, null, 2)}\n`,
    'astro.config.mjs': config,
    'src/content.config.ts': `import { conlocaPages } from '@conloca/astro-cms/node/content';

export const collections = { pages: conlocaPages() };
`,
    'content/sites.json': JSON.stringify({
      sites: { default: { locales: ['en'], defaultLocale: 'en' } },
      globalLocales: ['en'],
    }),
    'hero.jpg': HERO,
  };
  await Promise.all(
    Object.entries(files).map(async ([path, text]) => {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), text);
    }),
  );
  return dir;
}

async function addJson(dir: string, file: string, ...flags: string[]) {
  const result = await $`${CLI} asset add ${join(dir, file)} ${dir} --no-install --json ${flags}`.quiet().nothrow();
  return { exitCode: result.exitCode, report: JSON.parse(result.stdout.toString()) };
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

describe('conloca asset add', () => {
  test('copies the image into the media folder and prints the reference the editor stores', async () => {
    const dir = await makeSite();
    const result = await $`${CLI} asset add ${join(dir, 'hero.jpg')} ${dir} --no-install`.quiet();
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain('✓ Added /media/hero.jpg');
    expect(result.stdout.toString()).toContain(join('public', 'media', 'hero.jpg'));
    expect(new Uint8Array(await readFile(join(dir, 'public', 'media', 'hero.jpg')))).toEqual(HERO);
  });

  test('keeps an existing file and stores the new one as hero-1.jpg', async () => {
    const dir = await makeSite();
    expect((await addJson(dir, 'hero.jpg')).report.ref).toBe('/media/hero.jpg');
    const { exitCode, report } = await addJson(dir, 'hero.jpg');
    expect(exitCode).toBe(0);
    expect(report).toMatchObject({ ok: true, ref: '/media/hero-1.jpg' });
    expect(report.path).toEndWith(join('public', 'media', 'hero-1.jpg'));
    expect(await exists(join(dir, 'public', 'media', 'hero.jpg'))).toBe(true);
  });

  test('prints the stored name when the upload renames the file', async () => {
    const dir = await makeSite();
    await writeFile(join(dir, 'Hero Shot.JPG'), HERO);
    const { report } = await addJson(dir, 'Hero Shot.JPG');
    expect(report.ref).toBe('/media/hero-shot.jpg');
    expect(new Uint8Array(await readFile(join(dir, 'public', 'media', 'hero-shot.jpg')))).toEqual(HERO);
  });

  test('stores My_Photo.JPG as my_photo.jpg', async () => {
    const dir = await makeSite();
    await writeFile(join(dir, 'My_Photo.JPG'), HERO);
    const { report } = await addJson(dir, 'My_Photo.JPG');
    expect(report.ref).toBe('/media/my_photo.jpg');
  });

  test('shrinks a 4000 px photo to <name>.webp and prints its reference', async () => {
    const dir = await makeSite();
    await writeFile(join(dir, 'Office.jpg'), await largePhoto(4000, 3000));
    const { exitCode, report } = await addJson(dir, 'Office.jpg');
    expect(exitCode).toBe(0);
    expect(report.ref).toBe('/media/office.webp');
    const stored = await sharp(join(dir, 'public', 'media', 'office.webp')).metadata();
    expect(stored).toMatchObject({ format: 'webp', width: 2560, height: 1920 });
  });

  test('prefixes the site base', async () => {
    const dir = await makeSite(connectedConfig("\n  base: '/docs',"));
    expect((await addJson(dir, 'hero.jpg')).report.ref).toBe('/docs/media/hero.jpg');
  });

  test('puts the image in --folder', async () => {
    const dir = await makeSite();
    const { report } = await addJson(dir, 'hero.jpg', '--folder', 'team', '--alt', 'The team');
    expect(report.ref).toBe('/media/team/hero.jpg');
    expect(new Uint8Array(await readFile(join(dir, 'public', 'media', 'team', 'hero.jpg')))).toEqual(HERO);
  });

  test('refuses a file that is not an image', async () => {
    const dir = await makeSite();
    await writeFile(join(dir, 'notes.txt'), 'notes');
    const { exitCode, report } = await addJson(dir, 'notes.txt');
    expect(exitCode).toBe(1);
    expect(report).toMatchObject({ ok: false, error: expect.stringMatching(/^notes\.txt is not an image the editor/) });
  });

  test('refuses a missing file before it wires the site', async () => {
    const dir = await makeSite();
    const { exitCode, report } = await addJson(dir, 'typo.jpg');
    expect(exitCode).toBe(1);
    expect(report.error).toBe(`no file ${join(dir, 'typo.jpg')}`);
    expect(await readFile(join(dir, 'astro.config.mjs'), 'utf-8')).toBe(connectedConfig());
    expect(await exists(join(dir, 'public', 'media'))).toBe(false);
  });

  test('wires the media folder first on a site that has none', async () => {
    const dir = await makeSite();
    const { exitCode, report } = await addJson(dir, 'hero.jpg');
    expect(exitCode).toBe(0);
    expect(await readFile(join(dir, 'astro.config.mjs'), 'utf-8')).toContain("assetsPath: './public/media'");
    expect(report.ref).toBe('/media/hero.jpg');
  });

  test('refuses a computed publicDir', async () => {
    const config = connectedConfig("\n  publicDir: resolve('static'),", ", assetsPath: './static/media'");
    const dir = await makeSite(`import { resolve } from 'node:path';\n${config}`);
    const { exitCode, report } = await addJson(dir, 'hero.jpg');
    expect(exitCode).toBe(1);
    expect(report.error).toMatch(/computes publicDir/);
    expect(await exists(join(dir, 'static', 'media', 'hero.jpg'))).toBe(false);
  });
});
