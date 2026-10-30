import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';

const CLI = join(import.meta.dir, '..', 'dist', 'conloca.js');

function astroConfig(puckConfigPath: string): string {
  return (
    "import { defineConfig } from 'astro/config';\nimport { conlocaCMS } from '@conloca/astro-cms';\n\n" +
    `export default defineConfig({ integrations: [conlocaCMS({ contentRoot: './content', puckConfigPath: ${puckConfigPath} })] });\n`
  );
}

describe('conloca components', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conloca-components-'));
    await Bun.write(join(dir, 'astro.config.mjs'), astroConfig("'./src/puck.config.ts'"));
    await Bun.write(
      join(dir, 'src', 'puck.config.ts'),
      "export default { components: { Hero: { fields: { title: { type: 'text' } }, render: () => null } } };\n",
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('--json prints the components and their fields', async () => {
    const manifest = JSON.parse((await $`${CLI} components --json ${dir}`.quiet()).stdout.toString());
    expect(manifest.components.Hero.fields.title).toEqual({ type: 'text' });
    expect(manifest.unresolved).toEqual([]);
  });

  test('prints one line per component with its fields', async () => {
    const out = (await $`${CLI} components ${dir}`.quiet()).stdout.toString();
    expect(out).toContain('Hero: title (text)');
  });

  test('a config that cannot be read is reported with its reason', async () => {
    await rm(join(dir, 'src', 'puck.config.ts'));
    const result = await $`${CLI} components --json ${dir}`.quiet();
    const manifest = JSON.parse(result.stdout.toString());
    expect(result.exitCode).toBe(0);
    expect(manifest.unreadable).toBe(true);
    expect(typeof manifest.unreadableReason).toBe('string');
  });

  test('fails when puckConfigPath is not a plain string', async () => {
    await Bun.write(join(dir, 'astro.config.mjs'), astroConfig('process.env.PUCK'));
    const result = await $`${CLI} components ${dir}`.quiet().nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain('puckConfigPath');
  });

  test('fails without an astro config', async () => {
    await rm(join(dir, 'astro.config.mjs'));
    const result = await $`${CLI} components ${dir}`.quiet().nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain('astro.config');
  });
});
