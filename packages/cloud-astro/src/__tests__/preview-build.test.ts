import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { PREVIEW_BUILD_ENV_FLAG } from '../integration.js';
import {
  _spawnPreviewBuildWith,
  buildPreviewChildEnv,
  type PreviewBuildSpawn,
  previewBuildMode,
  previewChildMode,
  previewChildPrerendered,
  spawnPreviewBuild,
} from '../preview-build.js';

// ---------------------------------------------------------------------------
// Test scaffolding
// ---------------------------------------------------------------------------

type SpawnCall = {
  command: string;
  args: readonly string[];
  options: { env: NodeJS.ProcessEnv; stdio: 'inherit' };
};

/**
 * Returns a {@link PreviewBuildSpawn} that records every invocation and
 * returns a fake child whose `exit` event fires on the next microtask with
 * the supplied code. Letting the implementation depend on the narrow
 * {@link PreviewBuildSpawn} interface (rather than on `typeof spawn` from
 * `node:child_process`) means this fake is honestly typed — no casts.
 */
function makeRecordingSpawn(exitCode: number | null): { calls: SpawnCall[]; fn: PreviewBuildSpawn } {
  const calls: SpawnCall[] = [];
  const fn: PreviewBuildSpawn = (command, args, options) => {
    calls.push({ command, args, options });
    const exitHandlers: ((code: number | null) => void)[] = [];
    queueMicrotask(() => {
      for (const h of exitHandlers) h(exitCode);
    });
    return {
      on(event, listener) {
        if (event === 'exit') exitHandlers.push(listener);
        return undefined;
      },
    };
  };
  return { calls, fn };
}

const ORIGINAL_FLAG = process.env[PREVIEW_BUILD_ENV_FLAG];
function restoreFlag(): void {
  if (ORIGINAL_FLAG === undefined) delete process.env[PREVIEW_BUILD_ENV_FLAG];
  else process.env[PREVIEW_BUILD_ENV_FLAG] = ORIGINAL_FLAG;
}

// ---------------------------------------------------------------------------
// previewBuildMode — the opt-in and the adapters it refuses.
// ---------------------------------------------------------------------------

function d4Refused(name: string): string {
  return (
    `@conloca/cloud-astro: previewBuild.separate is not supported with ${name}: the separate preview build would ` +
    `write its output where ${name} deploys the live site. Remove separate: true; with ${name} drafts render in ` +
    "the site's own build."
  );
}

describe('previewBuildMode', () => {
  it('is off unless previewBuild is given as an object', () => {
    expect(previewBuildMode(undefined, '@astrojs/cloudflare')).toBe('off');
    expect(previewBuildMode(false, '@astrojs/cloudflare')).toBe('off');
    // A Vercel or Netlify site that never opted in still builds.
    expect(previewBuildMode(undefined, '@astrojs/vercel')).toBe('off');
    expect(previewBuildMode(false, '@astrojs/netlify')).toBe('off');
  });

  const adapters = [
    undefined,
    '@astrojs/node',
    '@astrojs/vercel',
    '@astrojs/netlify',
    '@astrojs/cloudflare',
    '@example/deno',
  ];
  const adapterRefused =
    "@conloca/cloud-astro: previewBuild.adapter has no effect: drafts render in the site's own build, through the " +
    'adapter in astro.config. Remove previewBuild.adapter.';

  for (const adapter of adapters) {
    it(`chooses the mode for ${adapter ?? 'no adapter'}`, () => {
      expect(previewBuildMode({}, adapter)).toBe(adapter === undefined ? 'd3' : 'd8');
      if (adapter === '@astrojs/vercel' || adapter === '@astrojs/netlify') {
        expect(() => previewBuildMode({ separate: true }, adapter)).toThrow(d4Refused(adapter));
      } else {
        expect(previewBuildMode({ separate: true }, adapter)).toBe('d4');
      }
      expect(() => previewBuildMode({}, adapter, '@astrojs/node')).toThrow(adapterRefused);
    });
  }
});

describe('previewChildMode', () => {
  it('takes D3 from the parent, and reads anything else, the retired D2 included, as a separate preview deploy (D4)', () => {
    expect(previewChildMode({ CONLOCA_PREVIEW_MODE: 'd3' })).toBe('d3');
    expect(previewChildMode({ CONLOCA_PREVIEW_MODE: 'd2' })).toBe('d4');
    expect(previewChildMode({})).toBe('d4');
    expect(previewChildMode({ CONLOCA_PREVIEW_MODE: 'd4' })).toBe('d4');
  });
});

describe('previewChildPrerendered', () => {
  it("hands a D3 child the routes the site's own build prerendered", () => {
    const env = buildPreviewChildEnv({}, 'd3', ['src/pages/rss.xml.js', 'src/pages/blog/[slug].astro']);
    expect([...previewChildPrerendered(env)]).toEqual(['src/pages/rss.xml.js', 'src/pages/blog/[slug].astro']);
  });

  it('reads nothing from a D4 child, or from a value that is not a list of names', () => {
    expect(previewChildPrerendered({ CONLOCA_PREVIEW_PRERENDERED: '["src/pages/a.astro"]' }).size).toBe(0);
    expect(previewChildPrerendered({ CONLOCA_PREVIEW_PRERENDERED: '{"a":1}' }).size).toBe(0);
    expect(previewChildPrerendered({ CONLOCA_PREVIEW_PRERENDERED: 'not json' }).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildPreviewChildEnv — pure env merge.
// ---------------------------------------------------------------------------

describe('buildPreviewChildEnv', () => {
  it('sets CONLOCA_PREVIEW_BUILD=1 — the recursion guard contract', () => {
    expect(buildPreviewChildEnv({}, 'd3')[PREVIEW_BUILD_ENV_FLAG]).toBe('1');
  });

  it('adds CONLOCA_PREVIEW_BUILD=1 and the mode to the parent environment', () => {
    expect(buildPreviewChildEnv({ PATH: '/bin', CF_PAGES_BRANCH: 'main' }, 'd3')).toEqual({
      PATH: '/bin',
      CF_PAGES_BRANCH: 'main',
      CONLOCA_PREVIEW_BUILD: '1',
      CONLOCA_PREVIEW_MODE: 'd3',
      CONLOCA_PREVIEW_PRERENDERED: '[]',
    });
  });

  it('inherits parent env entries (PATH, credentials, host vars)', () => {
    const parent = { PATH: '/usr/bin', CF_PAGES_BRANCH: 'main' };
    const child = buildPreviewChildEnv(parent, 'd3');
    expect(child.PATH).toBe('/usr/bin');
    expect(child.CF_PAGES_BRANCH).toBe('main');
  });

  it('overrides a stale build flag (own injection wins)', () => {
    expect(buildPreviewChildEnv({ [PREVIEW_BUILD_ENV_FLAG]: 'stale' }, 'd3')[PREVIEW_BUILD_ENV_FLAG]).toBe('1');
  });
});

// ---------------------------------------------------------------------------
// Recursion guard — the load-bearing contract of the build:done pipeline.
// ---------------------------------------------------------------------------

describe('spawnPreviewBuild — recursion guard', () => {
  beforeEach(() => {
    delete process.env[PREVIEW_BUILD_ENV_FLAG];
  });
  afterEach(restoreFlag);

  it('does not spawn a child when CONLOCA_PREVIEW_BUILD=1 is already set', async () => {
    process.env[PREVIEW_BUILD_ENV_FLAG] = '1';
    const { calls, fn } = makeRecordingSpawn(0);
    await _spawnPreviewBuildWith(fn, {}, 'd3');
    expect(calls).toHaveLength(0);
  });

  it('treats values other than the exact "1" as unset and DOES spawn', async () => {
    // Defensive: any non-"1" value must not block the first level of recursion.
    process.env[PREVIEW_BUILD_ENV_FLAG] = 'true';
    const { calls, fn } = makeRecordingSpawn(0);
    await _spawnPreviewBuildWith(fn, {}, 'd3');
    expect(calls).toHaveLength(1);
  });

  it('spawns exactly once for a single primary build (no internal retries)', async () => {
    delete process.env[PREVIEW_BUILD_ENV_FLAG];
    const { calls, fn } = makeRecordingSpawn(0);
    await _spawnPreviewBuildWith(fn, {}, 'd3');
    expect(calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Child command + env — proves the recursive build can run and self-guard.
// ---------------------------------------------------------------------------

describe('spawnPreviewBuild — child command and environment', () => {
  beforeEach(() => {
    delete process.env[PREVIEW_BUILD_ENV_FLAG];
  });
  afterEach(restoreFlag);

  it('invokes the resolved astro binary directly (never npx/bunx/bun x — those auto-fetch)', async () => {
    const { calls, fn } = makeRecordingSpawn(0);
    await _spawnPreviewBuildWith(fn, {}, 'd3');
    // The pattern: resolve the CLI binary out of node_modules/.bin and spawn
    // it directly, instead of relying on a package-runner shim. Asserting the
    // *shape* (endsWith) keeps the test stable across different repo roots.
    expect(calls[0].command).toMatch(/[/\\]node_modules[/\\]\.bin[/\\]astro$/);
    expect(calls[0].args).toEqual(['build']);
    // Explicitly pin the "no bunx" invariant against accidental regressions.
    expect(calls[0].command).not.toBe('bun');
    expect(calls[0].command).not.toBe('bunx');
    expect(calls[0].command).not.toBe('npx');
  });

  it('passes CONLOCA_PREVIEW_BUILD=1 in the child env — the recursion guard contract', async () => {
    const { calls, fn } = makeRecordingSpawn(0);
    await _spawnPreviewBuildWith(fn, {}, 'd3');
    expect(calls[0].options.env[PREVIEW_BUILD_ENV_FLAG]).toBe('1');
  });

  it('inherits the parent environment so PATH and credentials reach the child', async () => {
    process.env.CONLOCA_TEST_INHERIT = 'inherited-value';
    try {
      const { calls, fn } = makeRecordingSpawn(0);
      await _spawnPreviewBuildWith(fn, {}, 'd3');
      expect(calls[0].options.env.CONLOCA_TEST_INHERIT).toBe('inherited-value');
    } finally {
      delete process.env.CONLOCA_TEST_INHERIT;
    }
  });

  it('uses stdio inherit so child build output streams to the parent build log', async () => {
    const { calls, fn } = makeRecordingSpawn(0);
    await _spawnPreviewBuildWith(fn, {}, 'd3');
    expect(calls[0].options.stdio).toBe('inherit');
  });
});

// ---------------------------------------------------------------------------
// Exit-code handling — `required` semantics.
// ---------------------------------------------------------------------------

describe('spawnPreviewBuild — exit handling', () => {
  beforeEach(() => {
    delete process.env[PREVIEW_BUILD_ENV_FLAG];
  });
  afterEach(restoreFlag);

  it('resolves on exit code 0', async () => {
    const { fn } = makeRecordingSpawn(0);
    await Promise.resolve(expect(_spawnPreviewBuildWith(fn, {}, 'd3')).resolves.toBeUndefined());
  });

  it('rejects on a non-zero exit, required: false included: the option is ignored', async () => {
    const { fn } = makeRecordingSpawn(2);
    await Promise.resolve(expect(_spawnPreviewBuildWith(fn, {}, 'd3')).rejects.toThrow(/preview build failed.*2/));
    const { fn: optional } = makeRecordingSpawn(7);
    await Promise.resolve(
      expect(_spawnPreviewBuildWith(optional, { required: false }, 'd3')).rejects.toThrow(/preview build failed.*7/),
    );
  });

  it('rejects on signal-style null exit when required (treated as failure)', async () => {
    // Spawned process killed by signal exits with code === null; that must
    // not silently look like success.
    const { fn } = makeRecordingSpawn(null);
    await Promise.resolve(expect(_spawnPreviewBuildWith(fn, {}, 'd3')).rejects.toThrow(/preview build failed/));
  });
});

// ---------------------------------------------------------------------------
// Public surface — `spawnPreviewBuild` wires up the real spawn.
// ---------------------------------------------------------------------------

describe('spawnPreviewBuild — public entrypoint', () => {
  it('exists as an async function and accepts (opts, mode)', () => {
    expect(typeof spawnPreviewBuild).toBe('function');
    // Length excludes optional params: the options and the mode are required positional.
    expect(spawnPreviewBuild.length).toBe(2);
  });

  it('short-circuits via the public entry without ever calling node:child_process when env=1', async () => {
    const original = process.env[PREVIEW_BUILD_ENV_FLAG];
    process.env[PREVIEW_BUILD_ENV_FLAG] = '1';
    try {
      // No spawn-fn injection here: if the recursion guard ever regresses, the
      // public entrypoint would attempt to spawn `bun x astro build` for real
      // and hang the test runner. Reaching `resolves` proves the short-circuit.
      await Promise.resolve(expect(spawnPreviewBuild({}, 'd3')).resolves.toBeUndefined());
    } finally {
      if (original === undefined) delete process.env[PREVIEW_BUILD_ENV_FLAG];
      else process.env[PREVIEW_BUILD_ENV_FLAG] = original;
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-boundary smoke — proves the env flag REALLY crosses to a child
// process. The unit tests above use an injected spawn fake; this one runs a
// real `node -e` child (NOT astro) and asserts the variable arrives. Without
// this, every other env-related test could pass while the contract silently
// breaks (e.g. if a future refactor dropped `env:` from the spawn options).
// ---------------------------------------------------------------------------

describe('spawnPreviewBuild — real-process env propagation (smoke)', () => {
  it('the env constructed by buildPreviewChildEnv reaches a real child process', () => {
    const env = buildPreviewChildEnv(process.env, 'd3');
    const result = spawnSync('node', ['-e', 'process.stdout.write(String(process.env.CONLOCA_PREVIEW_BUILD))'], {
      env,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    expect(result.status).toBe(0);
    expect(result.stdout.toString('utf8')).toBe('1');
  });
});
