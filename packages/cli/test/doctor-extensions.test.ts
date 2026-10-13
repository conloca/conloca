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

const EXT = 'fake-doctor-ext';
const EXT_MANIFEST = { name: EXT, version: '1.0.0', type: 'module', conloca: { doctor: './doctor.mjs' } };

interface FakeExtension {
  /** Replaces the default manifest, which points doctor at doctor.mjs. */
  manifest?: Record<string, unknown>;
  source: string;
  /** File inside the package that receives `source`; the manifest must point at it. */
  entry?: string;
  /** Which package.json section declares the dependency. */
  field?: 'dependencies' | 'devDependencies';
}

/** A healthy content-only project depending on `fake-doctor-ext`, a package assembled from `extension`. */
async function makeProject(prefix: string, extension: FakeExtension): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  await Bun.write(join(dir, 'content', 'sites.json'), VALID_SITES);
  await Bun.write(join(dir, 'content', 'default', 'pages', 'home.en.vxjson'), VALID_PAGE);
  const field = extension.field ?? 'dependencies';
  await Bun.write(join(dir, 'package.json'), JSON.stringify({ name: 'proj', [field]: { [EXT]: '1.0.0' } }));
  const pkgDir = join(dir, 'node_modules', EXT);
  await Bun.write(join(pkgDir, 'package.json'), JSON.stringify(extension.manifest ?? EXT_MANIFEST));
  await Bun.write(join(pkgDir, extension.entry ?? 'doctor.mjs'), extension.source);
  return dir;
}

const ECHO_SOURCE = `export default async (ctx) => ({
  contractVersion: ctx.contractVersion,
  checks: [{ id: 'X1', label: 'extension check', detail: 'live=' + ctx.live + ' root=' + ctx.contentRoot, problems: [] }],
});`;

const FAILING_SOURCE = `export default async () => ({
  contractVersion: 1,
  checks: [{ id: 'X2', label: 'extension failure', problems: [{ check: 'X2', level: 'error', message: 'boom from extension' }] }],
});`;

const PARTIAL_SOURCE = `export default async () => ({
  contractVersion: 1,
  checks: [
    { id: 'X3', label: 'well-formed check', problems: [] },
    { id: 1 },
    { id: 'X9', label: 'x', problems: [{ check: 'X9', level: 'info', message: 'm' }] },
  ],
});`;

const COMMONJS_SOURCE = `module.exports = async (ctx) => ({
  contractVersion: ctx.contractVersion,
  checks: [{ id: 'X4', label: 'commonjs check', problems: [] }],
});`;

describe('conloca doctor extensions', () => {
  test('runs a dependency-declared extension resolved from the project and merges its checks', async () => {
    const dir = await makeProject('conloca-doctor-ext-ok-', { source: ECHO_SOURCE });
    try {
      const result = await $`${CLI} doctor ${dir}`.quiet();
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toContain(`✓ X1 extension check (live=false root=${join(dir, 'content')})`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('--live reaches the extension', async () => {
    const dir = await makeProject('conloca-doctor-ext-live-', { source: ECHO_SOURCE });
    try {
      const result = await $`${CLI} doctor --live ${dir}`.quiet();
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toContain('live=true');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('an extension error fails doctor and appears in --json like a built-in problem', async () => {
    const dir = await makeProject('conloca-doctor-ext-err-', { source: FAILING_SOURCE });
    try {
      const human = await $`${CLI} doctor ${dir}`.quiet().nothrow();
      expect(human.exitCode).toBe(1);
      expect(human.stdout.toString()).toContain('✗ X2 extension failure');
      expect(human.stdout.toString()).toContain('error: boom from extension');
      const json = await $`${CLI} doctor --json ${dir}`.quiet().nothrow();
      const report = JSON.parse(json.stdout.toString()) as {
        ok: boolean;
        problems: { check: string; level: string; message: string }[];
      };
      expect(report.ok).toBe(false);
      expect(report.problems).toContainEqual({ check: 'X2', level: 'error', message: 'boom from extension' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('a contract-version mismatch is one warning naming both versions, never a crash', async () => {
    const dir = await makeProject('conloca-doctor-ext-ver-', {
      source: 'export default async () => ({ contractVersion: 2, checks: [] });',
    });
    try {
      const result = await $`${CLI} doctor ${dir}`.quiet();
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toContain(
        `warn: extension ${EXT} speaks doctor contract 2, this CLI speaks 1 — update the older side`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('a load failure is a warning naming the package, never a silent skip', async () => {
    const dir = await makeProject('conloca-doctor-ext-load-', { source: "throw new Error('cannot load');" });
    try {
      const result = await $`${CLI} doctor ${dir}`.quiet();
      expect(result.exitCode).toBe(0);
      const out = result.stdout.toString();
      expect(out).toContain(`! EXT doctor extension ${EXT}`);
      expect(out).toContain('could not be loaded');
      expect(out).toContain('cannot load');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('a malformed result is a warning naming the package', async () => {
    const dir = await makeProject('conloca-doctor-ext-shape-', { source: 'export default async () => 42;' });
    try {
      const result = await $`${CLI} doctor ${dir}`.quiet();
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toContain(`${EXT}'s doctor extension returned an unexpected shape`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('a dependency without a conloca.doctor field is ignored', async () => {
    const dir = await makeProject('conloca-doctor-ext-none-', {
      manifest: { name: EXT, version: '1.0.0', type: 'module' },
      source: ECHO_SOURCE,
    });
    try {
      const result = await $`${CLI} doctor ${dir}`.quiet();
      expect(result.stdout.toString()).not.toContain('X1');
      expect(result.stdout.toString()).not.toContain(EXT);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('a dependency whose exports map hides package.json is still discovered', async () => {
    const dir = await makeProject('conloca-doctor-ext-exports-', {
      manifest: { ...EXT_MANIFEST, exports: { '.': './index.mjs' } },
      source: ECHO_SOURCE,
    });
    try {
      const result = await $`${CLI} doctor ${dir}`.quiet();
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toContain('✓ X1 extension check');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('a dependency declared under devDependencies is discovered', async () => {
    const dir = await makeProject('conloca-doctor-ext-dev-', { source: ECHO_SOURCE, field: 'devDependencies' });
    try {
      const result = await $`${CLI} doctor ${dir}`.quiet();
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toContain('✓ X1 extension check');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('a CommonJS entry exporting the function as module.exports works', async () => {
    const dir = await makeProject('conloca-doctor-ext-cjs-', {
      manifest: { name: EXT, version: '1.0.0', conloca: { doctor: './doctor.cjs' } },
      entry: 'doctor.cjs',
      source: COMMONJS_SOURCE,
    });
    try {
      const result = await $`${CLI} doctor ${dir}`.quiet();
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toContain('✓ X4 commonjs check');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('malformed entries are dropped with one trailing warning while well-formed ones still run', async () => {
    const dir = await makeProject('conloca-doctor-ext-partial-', { source: PARTIAL_SOURCE });
    try {
      const result = await $`${CLI} doctor ${dir}`.quiet();
      expect(result.exitCode).toBe(0);
      const out = result.stdout.toString();
      expect(out).toContain('✓ X3 well-formed check');
      expect(out).toContain(`warn: 2 result(s) from ${EXT}'s doctor extension were malformed and ignored`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('an extension that throws at run time is a warning naming the package, never a crash', async () => {
    const dir = await makeProject('conloca-doctor-ext-throw-', {
      source: "export default async () => { throw new Error('runtime boom'); };",
    });
    try {
      const result = await $`${CLI} doctor ${dir}`.quiet();
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toContain(`warn: ${EXT}'s doctor extension failed: runtime boom`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('doctor --help documents --live', async () => {
    const result = await $`${CLI} doctor --help`.quiet();
    expect(result.stdout.toString()).toContain('--live');
  });
});
