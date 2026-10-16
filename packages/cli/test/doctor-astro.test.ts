import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';

const CLI = join(import.meta.dir, '..', 'dist', 'conloca.js');

const VALID_SITES = JSON.stringify({
  sites: { default: { locales: ['en'], defaultLocale: 'en' } },
  globalLocales: ['en'],
});

const VALID_PAGE = JSON.stringify({
  id: 'home',
  type: 'puck',
  created: '2026-01-01T00:00:00.000Z',
  modified: '2026-01-01T00:00:00.000Z',
  meta: { title: 'Home' },
  content: {},
});

const GOOD_ASTRO_CONFIG = `import react from '@astrojs/react';
import { conlocaCMS } from '@conloca/astro-cms/node';
import { defineConfig } from 'astro/config';

export default defineConfig({
  // site: 'https://example.com' — commented out on purpose: scanners must ignore comments
  integrations: [
    react(),
    conlocaCMS({
      contentRoot: './content',
      puckConfigPath: './src/puck.config.tsx',
      routing: {
        routes: {
          pages: { pattern: '/[...slug]', collection: 'pages', layout: './src/layouts/Layout.astro' },
        },
        siteName: 'default',
      },
    }),
  ],
});
`;

const WIRED_CONTENT_CONFIG = `import { conlocaFragments, conlocaPages } from '@conloca/astro-cms/node/content';

export const collections = {
  pages: conlocaPages(),
  ...conlocaFragments(),
};
`;

const GOOD_TSCONFIG = `{
  // JSONC on purpose: doctor must tolerate comments and trailing commas
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": {
    "jsx": "react-jsx",
  },
}
`;

const GOOD_PACKAGE_JSON = JSON.stringify({
  name: 'doctor-fixture-site',
  type: 'module',
  dependencies: {
    '@astrojs/react': '^4.0.0',
    '@conloca/astro-cms': '^0.1.0',
    astro: '^6.0.0',
    react: '^19.0.0',
    'react-dom': '^19.0.0',
  },
  devDependencies: {
    '@vitejs/plugin-react': '^5.0.0',
  },
});

async function makeAstroProject(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  await Bun.write(join(dir, 'content', 'sites.json'), VALID_SITES);
  await Bun.write(join(dir, 'content', 'default', 'pages', 'home.en.vxjson'), VALID_PAGE);
  await Bun.write(join(dir, 'astro.config.mjs'), GOOD_ASTRO_CONFIG);
  await Bun.write(join(dir, 'package.json'), GOOD_PACKAGE_JSON);
  await Bun.write(join(dir, 'tsconfig.json'), GOOD_TSCONFIG);
  await Bun.write(join(dir, 'src', 'content.config.ts'), WIRED_CONTENT_CONFIG);
  return dir;
}

async function runDoctor(dir: string): Promise<{ exitCode: number; stdout: string }> {
  const result = await $`${CLI} doctor ${dir}`.quiet().nothrow();
  return { exitCode: result.exitCode, stdout: result.stdout.toString() };
}

describe('conloca doctor astro checks', () => {
  test('every astro check is skipped on a content-only project', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conloca-astro-none-'));
    try {
      await Bun.write(join(dir, 'content', 'sites.json'), VALID_SITES);
      await Bun.write(join(dir, 'content', 'default', 'pages', 'home.en.vxjson'), VALID_PAGE);
      const { exitCode, stdout } = await runDoctor(dir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('(skipped: no astro.config found)');
      for (const id of ['C1', 'C2', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11']) {
        expect(stdout).toContain(id);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('a fully wired astro project passes every astro check', async () => {
    const dir = await makeAstroProject('conloca-astro-ok-');
    try {
      const { exitCode, stdout } = await runDoctor(dir);
      expect(stdout).toContain('No problems');
      expect(exitCode).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('C1: a missing content config is an error carrying the fix snippet', async () => {
    const dir = await makeAstroProject('conloca-astro-c1-missing-');
    try {
      await rm(join(dir, 'src', 'content.config.ts'));
      const { exitCode, stdout } = await runDoctor(dir);
      expect(exitCode).toBe(1);
      expect(stdout).toContain('content.config');
      expect(stdout).toContain('conlocaPages');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('C1: a content config that never registers Conloca collections is an error', async () => {
    const dir = await makeAstroProject('conloca-astro-c1-unwired-');
    try {
      await Bun.write(join(dir, 'src', 'content.config.ts'), 'export const collections = {};\n');
      const { exitCode, stdout } = await runDoctor(dir);
      expect(exitCode).toBe(1);
      expect(stdout).toContain('@conloca/astro-cms/node/content');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('C2: a siteName with no sites.json entry is an error naming both', async () => {
    const dir = await makeAstroProject('conloca-astro-c2-');
    try {
      await Bun.write(
        join(dir, 'astro.config.mjs'),
        GOOD_ASTRO_CONFIG.replace("siteName: 'default'", "siteName: 'blog'"),
      );
      const { exitCode, stdout } = await runDoctor(dir);
      expect(exitCode).toBe(1);
      expect(stdout).toContain('blog');
      expect(stdout).toContain('sites.json');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('C2: a computed siteName is a warning, never a silent pass', async () => {
    const dir = await makeAstroProject('conloca-astro-c2-dyn-');
    try {
      await Bun.write(
        join(dir, 'astro.config.mjs'),
        GOOD_ASTRO_CONFIG.replace("siteName: 'default'", 'siteName: process.env.SITE_NAME'),
      );
      const { exitCode, stdout } = await runDoctor(dir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('could not determine');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('C5: importing conlocaCMS from the package root is an error naming the fix', async () => {
    const dir = await makeAstroProject('conloca-astro-c5-');
    try {
      await Bun.write(
        join(dir, 'astro.config.mjs'),
        GOOD_ASTRO_CONFIG.replace("from '@conloca/astro-cms/node';", "from '@conloca/astro-cms';"),
      );
      const { exitCode, stdout } = await runDoctor(dir);
      expect(exitCode).toBe(1);
      expect(stdout).toContain("'@conloca/astro-cms/node'");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('C6: a missing puckConfigPath option is an error naming it', async () => {
    const dir = await makeAstroProject('conloca-astro-c6-');
    try {
      await Bun.write(
        join(dir, 'astro.config.mjs'),
        GOOD_ASTRO_CONFIG.replace("puckConfigPath: './src/puck.config.tsx',", ''),
      );
      const { exitCode, stdout } = await runDoctor(dir);
      expect(exitCode).toBe(1);
      expect(stdout).toContain('puckConfigPath');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('options passed as a variable degrade to could-not-determine warnings', async () => {
    const dir = await makeAstroProject('conloca-astro-dynopts-');
    try {
      const config = `import react from '@astrojs/react';
import { conlocaCMS } from '@conloca/astro-cms/node';
import { defineConfig } from 'astro/config';
import { cmsOptions } from './options.mjs';

export default defineConfig({
  integrations: [react(), conlocaCMS(cmsOptions)],
});
`;
      await Bun.write(join(dir, 'astro.config.mjs'), config);
      const { exitCode, stdout } = await runDoctor(dir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('could not determine');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('C7: react() after conlocaCMS() is an error about the order', async () => {
    const dir = await makeAstroProject('conloca-astro-c7-order-');
    try {
      const config = GOOD_ASTRO_CONFIG.replace('react(),\n    conlocaCMS({', 'conlocaCMS({').replace(
        '    }),\n  ],',
        '    }),\n    react(),\n  ],',
      );
      await Bun.write(join(dir, 'astro.config.mjs'), config);
      const { exitCode, stdout } = await runDoctor(dir);
      expect(exitCode).toBe(1);
      expect(stdout).toContain('before conlocaCMS');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('C7: a missing react() integration is an error', async () => {
    const dir = await makeAstroProject('conloca-astro-c7-noreact-');
    try {
      await Bun.write(join(dir, 'astro.config.mjs'), GOOD_ASTRO_CONFIG.replace('react(),\n    ', ''));
      const { exitCode, stdout } = await runDoctor(dir);
      expect(exitCode).toBe(1);
      expect(stdout).toContain('react()');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('C7: @astrojs/react missing from package.json is an error', async () => {
    const dir = await makeAstroProject('conloca-astro-c7-nodep-');
    try {
      const pkg = JSON.parse(GOOD_PACKAGE_JSON);
      delete pkg.dependencies['@astrojs/react'];
      await Bun.write(join(dir, 'package.json'), JSON.stringify(pkg));
      const { exitCode, stdout } = await runDoctor(dir);
      expect(exitCode).toBe(1);
      expect(stdout).toContain('@astrojs/react');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('C8: a missing peer dependency is an error naming it', async () => {
    const dir = await makeAstroProject('conloca-astro-c8-');
    try {
      const pkg = JSON.parse(GOOD_PACKAGE_JSON);
      delete pkg.devDependencies['@vitejs/plugin-react'];
      await Bun.write(join(dir, 'package.json'), JSON.stringify(pkg));
      const { exitCode, stdout } = await runDoctor(dir);
      expect(exitCode).toBe(1);
      expect(stdout).toContain('@vitejs/plugin-react');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('C9: jsx preserve is advisory — a warning naming react-jsx, exit 0', async () => {
    const dir = await makeAstroProject('conloca-astro-c9-');
    try {
      await Bun.write(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'preserve' } }));
      const { exitCode, stdout } = await runDoctor(dir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('warn');
      expect(stdout).toContain('react-jsx');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('C9: a missing jsx field warns instead of failing — working sites inherit preserve', async () => {
    const dir = await makeAstroProject('conloca-astro-c9-nojsx-');
    try {
      await Bun.write(join(dir, 'tsconfig.json'), JSON.stringify({ extends: 'astro/tsconfigs/strict' }));
      const { exitCode, stdout } = await runDoctor(dir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('warn');
      expect(stdout).toContain('react-jsx');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('C9: an unparseable tsconfig is a warning, never a silent pass', async () => {
    const dir = await makeAstroProject('conloca-astro-c9-broken-');
    try {
      await Bun.write(join(dir, 'tsconfig.json'), '{ this is not json');
      const { exitCode, stdout } = await runDoctor(dir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('could not');
      expect(stdout).toContain('tsconfig');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('C10: output server flags pages without prerender by name', async () => {
    const dir = await makeAstroProject('conloca-astro-c10-');
    try {
      await Bun.write(
        join(dir, 'astro.config.mjs'),
        GOOD_ASTRO_CONFIG.replace('integrations: [', "output: 'server',\n  integrations: ["),
      );
      await Bun.write(join(dir, 'src', 'pages', 'about.astro'), '<h1>About</h1>\n');
      await Bun.write(join(dir, 'src', 'pages', 'ok.astro'), '---\nexport const prerender = true;\n---\n<h1>Ok</h1>\n');
      const { exitCode, stdout } = await runDoctor(dir);
      expect(exitCode).toBe(1);
      expect(stdout).toContain('about.astro');
      expect(stdout).not.toContain('ok.astro');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('C10: an unreadable output value is a warning, never a silent pass', async () => {
    const dir = await makeAstroProject('conloca-astro-c10-dyn-');
    try {
      await Bun.write(
        join(dir, 'astro.config.mjs'),
        GOOD_ASTRO_CONFIG.replace('integrations: [', 'output: process.env.OUTPUT_MODE,\n  integrations: ['),
      );
      const { exitCode, stdout } = await runDoctor(dir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('could not');
      expect(stdout).toContain('output');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('C11: index.astro alongside a catch-all route is a warning naming the shadow', async () => {
    const dir = await makeAstroProject('conloca-astro-c11-');
    try {
      await Bun.write(join(dir, 'src', 'pages', 'index.astro'), '<h1>Home</h1>\n');
      const { exitCode, stdout } = await runDoctor(dir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('index.astro');
      expect(stdout).toContain('C11');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('--json carries the astro check ids in problems', async () => {
    const dir = await makeAstroProject('conloca-astro-json-');
    try {
      await Bun.write(
        join(dir, 'astro.config.mjs'),
        GOOD_ASTRO_CONFIG.replace("from '@conloca/astro-cms/node';", "from '@conloca/astro-cms';"),
      );
      const pkg = JSON.parse(GOOD_PACKAGE_JSON);
      delete pkg.devDependencies['@vitejs/plugin-react'];
      await Bun.write(join(dir, 'package.json'), JSON.stringify(pkg));

      const result = await $`${CLI} doctor --json ${dir}`.quiet().nothrow();
      expect(result.exitCode).toBe(1);
      const report = JSON.parse(result.stdout.toString());
      expect(report.ok).toBe(false);
      const ids = report.problems.map((problem: { check: string }) => problem.check);
      expect(ids).toContain('C5');
      expect(ids).toContain('C8');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
