import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { PREVIEW_BUILD_ENV_FLAG } from '../integration.js';
import {
  _spawnPreviewBuildWith,
  buildPreviewChildEnv,
  PREVIEW_SECRET_ENV_FLAG,
  type PreviewBuildSpawn,
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
// buildPreviewChildEnv — pure env merge.
// ---------------------------------------------------------------------------

describe('buildPreviewChildEnv', () => {
  it('sets CONLOCA_PREVIEW_BUILD=1 — the recursion guard contract', () => {
    expect(buildPreviewChildEnv({}, 'sec')[PREVIEW_BUILD_ENV_FLAG]).toBe('1');
  });

  it('sets CONLOCA_PREVIEW_SECRET to the supplied secret verbatim', () => {
    expect(buildPreviewChildEnv({}, 'sec-XYZ-123')[PREVIEW_SECRET_ENV_FLAG]).toBe('sec-XYZ-123');
  });

  it('inherits parent env entries (PATH, credentials, host vars)', () => {
    const parent = { PATH: '/usr/bin', CF_PAGES_BRANCH: 'main' };
    const child = buildPreviewChildEnv(parent, 'sec');
    expect(child.PATH).toBe('/usr/bin');
    expect(child.CF_PAGES_BRANCH).toBe('main');
  });

  it('overrides any pre-existing build/secret env entries (own injection wins)', () => {
    const child = buildPreviewChildEnv(
      { [PREVIEW_BUILD_ENV_FLAG]: 'stale', [PREVIEW_SECRET_ENV_FLAG]: 'old' },
      'fresh',
    );
    expect(child[PREVIEW_BUILD_ENV_FLAG]).toBe('1');
    expect(child[PREVIEW_SECRET_ENV_FLAG]).toBe('fresh');
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
    await _spawnPreviewBuildWith(fn, 'secret-abc', {});
    expect(calls).toHaveLength(0);
  });

  it('treats values other than the exact "1" as unset and DOES spawn', async () => {
    // Defensive: any non-"1" value must not block the first level of recursion.
    process.env[PREVIEW_BUILD_ENV_FLAG] = 'true';
    const { calls, fn } = makeRecordingSpawn(0);
    await _spawnPreviewBuildWith(fn, 'secret-abc', {});
    expect(calls).toHaveLength(1);
  });

  it('spawns exactly once for a single primary build (no internal retries)', async () => {
    delete process.env[PREVIEW_BUILD_ENV_FLAG];
    const { calls, fn } = makeRecordingSpawn(0);
    await _spawnPreviewBuildWith(fn, 'secret-abc', {});
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
    await _spawnPreviewBuildWith(fn, 'secret-abc', {});
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
    await _spawnPreviewBuildWith(fn, 'secret-abc', {});
    expect(calls[0].options.env[PREVIEW_BUILD_ENV_FLAG]).toBe('1');
  });

  it('passes the per-branch preview secret to the child as CONLOCA_PREVIEW_SECRET', async () => {
    const { calls, fn } = makeRecordingSpawn(0);
    await _spawnPreviewBuildWith(fn, 'sec-XYZ-123', {});
    expect(calls[0].options.env[PREVIEW_SECRET_ENV_FLAG]).toBe('sec-XYZ-123');
  });

  it('inherits the parent environment so PATH and credentials reach the child', async () => {
    process.env.CONLOCA_TEST_INHERIT = 'inherited-value';
    try {
      const { calls, fn } = makeRecordingSpawn(0);
      await _spawnPreviewBuildWith(fn, 'secret', {});
      expect(calls[0].options.env.CONLOCA_TEST_INHERIT).toBe('inherited-value');
    } finally {
      delete process.env.CONLOCA_TEST_INHERIT;
    }
  });

  it('uses stdio inherit so child build output streams to the parent build log', async () => {
    const { calls, fn } = makeRecordingSpawn(0);
    await _spawnPreviewBuildWith(fn, 'secret', {});
    expect(calls[0].options.stdio).toBe('inherit');
  });

  it('rejects an empty preview secret — without it the child cannot mount the secret-scoped route', async () => {
    const { fn } = makeRecordingSpawn(0);
    await expect(_spawnPreviewBuildWith(fn, '', {})).rejects.toThrow(/preview secret/i);
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

  it('resolves on exit code 0 regardless of `required`', async () => {
    const { fn: required } = makeRecordingSpawn(0);
    const { fn: optional } = makeRecordingSpawn(0);
    await expect(_spawnPreviewBuildWith(required, 'secret', { required: true })).resolves.toBeUndefined();
    await expect(_spawnPreviewBuildWith(optional, 'secret', { required: false })).resolves.toBeUndefined();
  });

  it('rejects on non-zero exit when required (default)', async () => {
    const { fn } = makeRecordingSpawn(2);
    // Default `required` is true.
    await expect(_spawnPreviewBuildWith(fn, 'secret', {})).rejects.toThrow(/preview build failed.*2/);
  });

  it('rejects on non-zero exit when required: true explicitly', async () => {
    const { fn } = makeRecordingSpawn(1);
    await expect(_spawnPreviewBuildWith(fn, 'secret', { required: true })).rejects.toThrow(/preview build failed.*1/);
  });

  it('resolves on non-zero exit when required: false', async () => {
    const { fn } = makeRecordingSpawn(7);
    await expect(_spawnPreviewBuildWith(fn, 'secret', { required: false })).resolves.toBeUndefined();
  });

  it('rejects on signal-style null exit when required (treated as failure)', async () => {
    // Spawned process killed by signal exits with code === null; that must
    // not silently look like success.
    const { fn } = makeRecordingSpawn(null);
    await expect(_spawnPreviewBuildWith(fn, 'secret', {})).rejects.toThrow(/preview build failed/);
  });
});

// ---------------------------------------------------------------------------
// Public surface — `spawnPreviewBuild` wires up the real spawn.
// ---------------------------------------------------------------------------

describe('spawnPreviewBuild — public entrypoint', () => {
  it('exists as an async function and accepts (secret, opts)', () => {
    expect(typeof spawnPreviewBuild).toBe('function');
    // Length excludes optional/destructured params; both args are required positional.
    expect(spawnPreviewBuild.length).toBe(2);
  });

  it('short-circuits via the public entry without ever calling node:child_process when env=1', async () => {
    const original = process.env[PREVIEW_BUILD_ENV_FLAG];
    process.env[PREVIEW_BUILD_ENV_FLAG] = '1';
    try {
      // No spawn-fn injection here: if the recursion guard ever regresses, the
      // public entrypoint would attempt to spawn `bun x astro build` for real
      // and hang the test runner. Reaching `resolves` proves the short-circuit.
      await expect(spawnPreviewBuild('secret', {})).resolves.toBeUndefined();
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
    const env = buildPreviewChildEnv(process.env, 'real-secret-42');
    const result = spawnSync(
      'node',
      ['-e', 'process.stdout.write(process.env.CONLOCA_PREVIEW_BUILD + "|" + process.env.CONLOCA_PREVIEW_SECRET)'],
      { env, stdio: ['ignore', 'pipe', 'inherit'] },
    );
    expect(result.status).toBe(0);
    expect(result.stdout.toString('utf8')).toBe('1|real-secret-42');
  });
});
