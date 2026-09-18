import { describe, expect, it } from 'bun:test';
import type { RegistrationFetch, RegistrationInput } from '../register.js';
import { _postRegistrationWith, _registrationRetryDelays } from '../register.js';

// ---------------------------------------------------------------------------
// Test scaffolding
// ---------------------------------------------------------------------------

const NO_DELAYS: readonly number[] = [0, 0];

function validInput(overrides: Partial<RegistrationInput> = {}): RegistrationInput {
  return {
    endpoint: 'https://cms.example.test',
    buildToken: `cbt_org-1.${'A'.repeat(43)}`,
    repoUri: 'acme/site',
    gitSha: 'deadbeefdeadbeef',
    branch: 'main',
    siteId: 'default',
    editorBundleUrl: 'https://site.example.test/_conloca/editor-bundle.0123456789abcdef.js',
    bundleHash: 'f'.repeat(64),
    ...overrides,
  };
}

interface RecordedCall {
  url: string;
  init: Parameters<RegistrationFetch>[1];
}

/**
 * Sequential fetch stub: each entry is either a Response to return or an
 * Error to reject with. Records every call so tests can assert the request
 * shape and the retry count.
 */
function makeFetch(script: (Response | Error)[]): { fetchFn: RegistrationFetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchFn: RegistrationFetch = async (url, init) => {
    calls.push({ url, init });
    const next = script.shift();
    if (next === undefined) throw new Error('fetch stub exhausted');
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetchFn, calls };
}

function okResponse(previewSecret = 'preview-secret-43chars'): Response {
  return new Response(JSON.stringify({ previewSecret }), { status: 200 });
}

// ---------------------------------------------------------------------------
// Happy path — request shape per the endpoint's contract
// ---------------------------------------------------------------------------

describe('postRegistration — request shape', () => {
  it('POSTs the registration body with bearer auth and returns the preview secret', async () => {
    const { fetchFn, calls } = makeFetch([okResponse('s3cret')]);
    const result = await _postRegistrationWith(fetchFn, validInput(), NO_DELAYS);

    expect(result).toEqual({ previewSecret: 's3cret' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://cms.example.test/api/v1/registrations');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers['content-type']).toBe('application/json');
    expect(calls[0].init.headers.authorization).toBe(`Bearer cbt_org-1.${'A'.repeat(43)}`);
    expect(JSON.parse(calls[0].init.body)).toEqual({
      repoUri: 'acme/site',
      gitSha: 'deadbeefdeadbeef',
      branch: 'main',
      siteId: 'default',
      editorBundleUrl: 'https://site.example.test/_conloca/editor-bundle.0123456789abcdef.js',
      bundleHash: 'f'.repeat(64),
    });
  });

  it('forwards the canvas stylesheet URL + hash when the bundle emitted one', async () => {
    const { fetchFn, calls } = makeFetch([okResponse()]);
    await _postRegistrationWith(
      fetchFn,
      validInput({
        stylesheetUrl: 'https://site.example.test/_conloca/editor-bundle.fedcba9876543210.css',
        stylesheetHash: 'a'.repeat(64),
      }),
      NO_DELAYS,
    );
    expect(JSON.parse(calls[0].init.body)).toMatchObject({
      stylesheetUrl: 'https://site.example.test/_conloca/editor-bundle.fedcba9876543210.css',
      stylesheetHash: 'a'.repeat(64),
    });
  });

  it('forwards the optional deployment fields when present', async () => {
    const { fetchFn, calls } = makeFetch([okResponse()]);
    await _postRegistrationWith(
      fetchFn,
      validInput({ deploymentUrl: 'https://abc.pages.test', deploymentProvider: 'cloudflare-pages', buildId: 'b-1' }),
      NO_DELAYS,
    );
    expect(JSON.parse(calls[0].init.body)).toMatchObject({
      deploymentUrl: 'https://abc.pages.test',
      deploymentProvider: 'cloudflare-pages',
      buildId: 'b-1',
    });
  });

  it('forwards the client version when present', async () => {
    const { fetchFn, calls } = makeFetch([okResponse()]);
    await _postRegistrationWith(fetchFn, validInput({ clientVersion: '0.1.0' }), NO_DELAYS);
    expect(JSON.parse(calls[0].init.body)).toMatchObject({ clientVersion: '0.1.0' });
  });

  it('rejects a 2xx response that is missing previewSecret', async () => {
    const { fetchFn } = makeFetch([new Response(JSON.stringify({}), { status: 200 })]);
    await expect(_postRegistrationWith(fetchFn, validInput(), NO_DELAYS)).rejects.toThrow(/previewSecret/);
  });
});

// ---------------------------------------------------------------------------
// Retry behaviour — network errors and 5xx retry; 4xx never does
// ---------------------------------------------------------------------------

describe('postRegistration — retries', () => {
  it('retries on a 500 and succeeds on the next attempt', async () => {
    const { fetchFn, calls } = makeFetch([new Response('boom', { status: 500 }), okResponse('after-retry')]);
    const result = await _postRegistrationWith(fetchFn, validInput(), NO_DELAYS);
    expect(result.previewSecret).toBe('after-retry');
    expect(calls).toHaveLength(2);
  });

  it('retries on a network error and succeeds on the next attempt', async () => {
    const { fetchFn, calls } = makeFetch([new TypeError('fetch failed'), okResponse()]);
    const result = await _postRegistrationWith(fetchFn, validInput(), NO_DELAYS);
    expect(result.previewSecret).toBe('preview-secret-43chars');
    expect(calls).toHaveLength(2);
  });

  it('gives up when the supplied retry schedule is exhausted', async () => {
    const { fetchFn, calls } = makeFetch([
      new Response('down', { status: 503 }),
      new Response('down', { status: 503 }),
      new Response('down', { status: 503 }),
    ]);
    await expect(_postRegistrationWith(fetchFn, validInput(), NO_DELAYS)).rejects.toThrow(/503/);
    expect(calls).toHaveLength(3);
  });

  it('throws immediately with the response body on 403 (no retry)', async () => {
    const body = 'repository is not covered by this workspace’s GitHub installation';
    const { fetchFn, calls } = makeFetch([new Response(body, { status: 403 })]);
    await expect(_postRegistrationWith(fetchFn, validInput(), NO_DELAYS)).rejects.toThrow(
      /403.*repository is not covered/,
    );
    expect(calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Default retry schedule — an endpoint that has just been set up can answer
// 503 for a while; the schedule must outlast that window.
// ---------------------------------------------------------------------------

describe('postRegistration — default retry schedule', () => {
  it('doubles from one second to a thirty-second ceiling', () => {
    expect(_registrationRetryDelays()).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000, 30_000]);
  });

  it('stops before the waits alone would pass three minutes', () => {
    const total = _registrationRetryDelays().reduce((sum, delay) => sum + delay, 0);
    expect(total).toBeLessThanOrEqual(180_000);
    expect(total + 30_000).toBeGreaterThan(180_000);
  });

  it('attempts once per scheduled delay plus the first try before giving up on a persistent 503', async () => {
    const schedule = _registrationRetryDelays().map(() => 0);
    const { fetchFn, calls } = makeFetch(
      Array.from({ length: schedule.length + 1 }, () => new Response('ingesting', { status: 503 })),
    );
    await expect(_postRegistrationWith(fetchFn, validInput(), schedule)).rejects.toThrow(/failed after 10 attempts/);
    expect(calls).toHaveLength(10);
  });

  it('recovers when the endpoint settles late in the schedule', async () => {
    const schedule = _registrationRetryDelays().map(() => 0);
    const { fetchFn, calls } = makeFetch([
      ...Array.from({ length: schedule.length }, () => new Response('ingesting', { status: 503 })),
      okResponse('settled'),
    ]);
    const result = await _postRegistrationWith(fetchFn, validInput(), schedule);
    expect(result.previewSecret).toBe('settled');
    expect(calls).toHaveLength(10);
  });
});

// ---------------------------------------------------------------------------
// Property test (numRuns: 50): for any random valid input the
// POSTed body parses back to the expected shape — required fields survive and
// undefined optionals drop. A self-contained deterministic generator keeps the
// test dependency-free; the seed makes failures reproducible.
// ---------------------------------------------------------------------------

const NUM_RUNS = 50;

/** Small deterministic PRNG (mulberry32) so a failing run is reproducible. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

function randomValidInput(rng: () => number): RegistrationInput {
  const hex = (length: number): string => {
    let out = '';
    for (let i = 0; i < length; i++) out += '0123456789abcdef'[Math.floor(rng() * 16)];
    return out;
  };
  const word = (): string => {
    const length = 1 + Math.floor(rng() * 8);
    let out = '';
    for (let i = 0; i < length; i++) out += 'abcdefghijklmnopqrstuvwxyz'[Math.floor(rng() * 26)];
    return out;
  };
  // Each optional field is present roughly half the time, so the 50 runs span
  // every present/absent combination of the four optionals.
  const maybe = (value: string): string | undefined => (rng() < 0.5 ? value : undefined);
  return {
    endpoint: `https://${word()}.example.test`,
    buildToken: `cbt_org-${word()}.${hex(43)}`,
    repoUri: `${word()}/${word()}`,
    gitSha: hex(40),
    branch: word(),
    siteId: word(),
    editorBundleUrl: `https://${word()}.example.test/_conloca/editor-bundle.${hex(16)}.js`,
    bundleHash: hex(64),
    deploymentUrl: maybe(`https://${word()}.pages.test`),
    deploymentProvider: maybe('cloudflare-pages'),
    buildId: maybe(`b-${hex(8)}`),
    clientVersion: maybe(`0.${hex(1)}.${hex(1)}`),
  };
}

describe('postRegistration — body round-trip property', () => {
  it('round-trips the POST body to the same shape for any random valid input', async () => {
    const rng = makeRng(0x5eed);
    for (let run = 0; run < NUM_RUNS; run++) {
      const input = randomValidInput(rng);
      const { fetchFn, calls } = makeFetch([okResponse()]);
      await _postRegistrationWith(fetchFn, input, NO_DELAYS);

      // The body the endpoint receives must JSON round-trip unchanged.
      const sentBody = calls[0].init.body;
      const parsed = JSON.parse(sentBody);
      expect(JSON.parse(JSON.stringify(parsed))).toEqual(parsed);

      // Required fields always survive.
      expect(parsed).toMatchObject({
        repoUri: input.repoUri,
        gitSha: input.gitSha,
        branch: input.branch,
        siteId: input.siteId,
        editorBundleUrl: input.editorBundleUrl,
        bundleHash: input.bundleHash,
      });

      // Each optional appears exactly when defined and is absent otherwise —
      // JSON.stringify drops undefined, matching the endpoint's "absent" reading.
      for (const key of ['deploymentUrl', 'deploymentProvider', 'buildId', 'clientVersion'] as const) {
        if (input[key] === undefined) {
          expect(key in parsed).toBe(false);
        } else {
          expect(parsed[key]).toBe(input[key]);
        }
      }

      // endpoint/buildToken are transport config, never part of the body.
      expect('endpoint' in parsed).toBe(false);
      expect('buildToken' in parsed).toBe(false);
      expect('orgId' in parsed).toBe(false);
    }
  });
});

describe('registration body', () => {
  it('carries the component manifest URL + hash', async () => {
    const { fetchFn, calls } = makeFetch([new Response(JSON.stringify({ previewSecret: 'sek' }), { status: 200 })]);
    await _postRegistrationWith(
      fetchFn,
      validInput({
        componentManifestUrl: 'https://site.example.test/_conloca/component-manifest.0123456789abcdef.json',
        componentManifestHash: 'd'.repeat(64),
      }),
      NO_DELAYS,
    );
    const body = JSON.parse(calls[0].init.body);
    expect(body.componentManifestUrl).toBe(
      'https://site.example.test/_conloca/component-manifest.0123456789abcdef.json',
    );
    expect(body.componentManifestHash).toBe('d'.repeat(64));
  });
});
