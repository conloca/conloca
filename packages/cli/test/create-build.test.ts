import { afterAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm, stat, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { $, type Subprocess } from 'bun';

const CLI = join(import.meta.dir, '..', 'dist', 'conloca.js');
const REPO_ROOT = join(import.meta.dir, '..', '..', '..');

/**
 * A created project borrows the example site's install instead of hitting npm: the two carry the
 * same dependency set (project-template.test.ts keeps the ranges equal) and `@conloca/*` resolves
 * to this repo's built packages.
 */
const EXAMPLE_NODE_MODULES = join(REPO_ROOT, 'example', 'website-with-cms', 'node_modules');

/**
 * Projects are created inside the repo rather than in os.tmpdir(). From a temp directory the
 * relative path back to the workspace packages climbs to the filesystem root, and Astro re-roots
 * that id onto the project — `<project>/Users/.../page-handler.astro` — so the build dies with
 * "No cached compile metadata found". A real project resolves `@conloca/*` inside its own
 * node_modules and never takes that path. `tmp/` is gitignored.
 */
const SCRATCH = join(REPO_ROOT, 'tmp');

type Server = Subprocess<'ignore', 'pipe', 'pipe'>;

function freePort(): number {
  const server = Bun.serve({ port: 0, fetch: () => new Response('') });
  const { port } = server;
  server.stop(true);
  // Only a unix-socket server reports no port; this one is bound to a TCP port by construction.
  if (port === undefined) throw new Error('Bun.serve reported no port');
  return port;
}

/** Polls until the server answers, surfacing its own output when it never does. */
async function waitForServer(server: Server, url: string, timeoutMs: number): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline && server.exitCode === null) {
    try {
      // Bounded by the deadline: a server that accepts the connection but never replies must not
      // hold the loop open past it, or the test dies on its own timeout printing nothing useful.
      return await fetch(url, { signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
    } catch (error) {
      last = error;
      await Bun.sleep(250);
    }
  }
  server.kill();
  await server.exited;
  const output = await new Response(server.stdout).text();
  const errors = await new Response(server.stderr).text();
  throw new Error(`${url} never answered: ${String(last)}\n${output}\n${errors}`);
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

/**
 * Removes a finished project and keeps removing until it stays gone. Vite's esbuild helper can
 * outlive the killed dev server and write a fresh `node_modules/.vite/deps_temp_*` after the delete
 * has already walked past, so one delete and one check is not enough: the directory has to still be
 * absent after a quiet window. The retries cover a file landing mid-walk, which would raise ENOTEMPTY.
 */
async function removeProject(parent: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    await rm(parent, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    await Bun.sleep(500);
    if (!(await exists(parent))) return;
  }
  throw new Error(`${parent} kept being recreated during cleanup`);
}

describe('a created project', () => {
  const servers: Server[] = [];
  const parents: string[] = [];
  afterAll(async () => {
    // Every server dies before any directory goes, so no live process can recreate one.
    for (const server of servers) {
      server.kill();
      await server.exited;
    }
    for (const parent of parents) {
      // One stuck removal must not strand the others.
      try {
        await removeProject(parent);
      } catch (error) {
        console.error(`could not remove ${parent}: ${String(error)}`);
      }
    }
  });

  /**
   * Scaffolds a project named `demo` and gives it a real node_modules whose entries each link into
   * the example's install. Symlinking node_modules wholesale instead would send every cache Vite and
   * Astro write — including the `deps_temp_*` scratch a dev server strands when it is killed
   * mid-prebundle — into the example's install, where nothing ever clears it. They belong to the
   * throwaway project, so that removing it removes them.
   */
  async function createProject(prefix: string): Promise<string> {
    // Loud failure, not a skip: the example site must be installed (bun install at the repo root).
    const entries = await readdir(EXAMPLE_NODE_MODULES);
    await mkdir(SCRATCH, { recursive: true });
    const parent = await mkdtemp(join(SCRATCH, prefix));
    parents.push(parent);

    const dir = join(parent, 'demo');
    const created = await $`${CLI} create --no-install --no-git --json ${dir}`.quiet();
    expect(JSON.parse(created.stdout.toString()).ok).toBe(true);

    const modules = join(dir, 'node_modules');
    await mkdir(modules);
    for (const entry of entries) {
      // `.bin` holds the astro launcher and has to come along; the other dot-entries are exactly
      // the caches this project must write for itself.
      if (entry.startsWith('.') && entry !== '.bin') continue;
      await symlink(join(EXAMPLE_NODE_MODULES, entry), join(modules, entry), 'dir');
    }
    return dir;
  }

  function startServer(dir: string, command: string[], env: Record<string, string> = {}): Server {
    const server = Bun.spawn(command, {
      cwd: dir,
      env: { ...process.env, ...env },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    servers.push(server);
    return server;
  }

  test('builds with astro and serves its home page', async () => {
    const dir = await createProject('conloca-create-build-');

    const build = await $`node ${join(dir, 'node_modules', '.bin', 'astro')} build`.cwd(dir).quiet().nothrow();
    if (build.exitCode !== 0) {
      console.error(build.stdout.toString(), build.stderr.toString());
    }
    expect(build.exitCode).toBe(0);
    expect((await stat(join(dir, 'dist', 'server', 'entry.mjs'))).isFile()).toBe(true);

    const port = freePort();
    const server = startServer(dir, ['node', join(dir, 'dist', 'server', 'entry.mjs')], {
      HOST: '127.0.0.1',
      PORT: String(port),
    });

    const home = await waitForServer(server, `http://127.0.0.1:${port}/`, 30_000);
    expect(home.status).toBe(200);
    expect(await home.text()).toContain('Welcome to demo');

    // The editor is deliberately absent from a production build: plugin-spa injects its routes
    // only when command === 'dev', and the generated skill doc says so outright. Pinned here so
    // the 404 reads as the contract it is rather than as a regression.
    const editor = await fetch(`http://127.0.0.1:${port}/__cms`);
    expect(editor.status).toBe(404);
  }, 180_000);

  test('serves the editor on the dev server with only scaffolded content', async () => {
    const dir = await createProject('conloca-create-dev-');

    const port = freePort();
    const command = [
      'node',
      join(dir, 'node_modules', '.bin', 'astro'),
      'dev',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
    ];
    // Astro 7 detaches `astro dev` into a background daemon when it detects an agent environment
    // (am-i-vibing), which would make the launcher exit at once and leave a server nobody kills.
    // ASTRO_DEV_BACKGROUND is Astro's own marker for the process that IS the server: it disables
    // the detection and keeps the dev server attached to this spawn on every machine.
    const server = startServer(dir, command, { ASTRO_DEV_BACKGROUND: '1' });

    const editor = await waitForServer(server, `http://127.0.0.1:${port}/__cms`, 60_000);
    expect(editor.status).toBe(200);
    expect(await editor.text()).toContain('<title>Conloca CMS</title>');
  }, 180_000);
});
