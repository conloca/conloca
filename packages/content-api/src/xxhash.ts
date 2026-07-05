/**
 * xxHash-64 for content etags — the single hashing chokepoint for this package.
 *
 * Uses `xxhash-wasm`, the one xxHash build with a purpose-built `workerd` export
 * (the WASM is imported as a module, not instantiated from an ArrayBuffer —
 * Cloudflare forbids the latter). It runs identically in workerd, the browser
 * (SPA editor), and Node/bun, so every consumer shares one implementation with
 * no per-target alias or shim.
 *
 * The WASM instance is created ONCE via top-level await, so the exported hashers
 * are SYNCHRONOUS — the etag pipeline (`JsonWhitespaceSkippingView`) streams
 * bytes through `update()` and reads `digest()` synchronously, and ESM guarantees
 * this module is fully evaluated (WASM ready) before any importer runs.
 *
 * This module performs exactly one top-level WASM instantiation, avoiding
 * workerd issue #1529, which requires two top-level WASM instantiations.
 *
 * XXH64, not XXH3 (xxhash-wasm ships XXH32/64): etags are opaque cache
 * validators, so the exact xxHash variant is irrelevant — only speed and a
 * stable 64-bit fingerprint matter.
 */
import xxhash from 'xxhash-wasm';

/** Streaming XXH64 hasher: the `update`/`digest` contract the etag pipeline drives. */
export interface Xxh64Hasher {
  update(input: Uint8Array): Xxh64Hasher;
  digest(): bigint;
}

const api = await xxhash();

/** Stateful streaming XXH64 hasher (seed 0). */
export function createXxh64(): Xxh64Hasher {
  return api.create64(0n);
}

/** One-shot XXH64 of a buffer (seed 0). */
export function xxh64(input: Uint8Array): bigint {
  return api.h64Raw(input);
}
