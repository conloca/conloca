#!/usr/bin/env bun
/**
 * Invalidate the caches under target/ that remember a toolchain when it changes.
 *
 * cmake-rs keeps CMAKE_OSX_SYSROOT and the compilers in CMakeCache.txt from
 * the FIRST configure and only clears a build directory when the source path
 * moves. Every C/C++ build script's cache under target/ therefore encodes
 * whichever toolchain the shell had when it was first configured, and it
 * outlives every later fix to that shell: a nix-store sysroot cached on one
 * day kept failing `ld: library 'c++' not found` after the shell stopped
 * exporting it. Nx does not see this state either — it hashes inputs, not
 * what a cache under target/ remembers.
 *
 * Cargo's own `.rustc_info.json` (one per target directory) is the same trap.
 * It caches `rustc -vV` and `--print sysroot` under a key of the rustc path and
 * its mtime. The shell names rustc by the toolchain's store path
 * (devenv.smoo.nix), which a bump moves, but a git hook reaches it through the
 * devenv profile's `bin/rustc` (repo-path), which a lock bump never moves, and
 * every Nix store file has mtime 1, so that key survives a toolchain bump
 * unchanged: after rust-overlay moved 1.100.0-nightly
 * (2026-09-08) to 1.101.0-nightly (2026-10-03), `-Zbuild-std` compiled the OLD
 * nightly's rust-src with the NEW compiler (`unrecognized intrinsic function`
 * in core) because the cached sysroot still named the old store path.
 *
 * Runs at the end of shell entry, after the project's own enterShell resolved
 * SDKROOT and the compilers. It records the toolchain identity the shell
 * settled on and, when that identity differs from the recorded one, removes
 * exactly the cargo build-script directories that hold a CMakeCache.txt, so
 * cargo re-runs those scripts against the current toolchain, and every target
 * directory's `.rustc_info.json`, so cargo asks the current rustc again.
 * Nothing else under target/ is touched; a checkout without target/ has
 * nothing to do.
 */
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { $ } from 'bun';

const root = resolve(`${process.env.DEVENV_ROOT ?? process.cwd()}/../..`);
const target = join(root, 'target');
if (existsSync(target)) {
  const stamp = join(target, '.toolchain-stamp');
  const identity = await toolchainIdentity();
  const recorded = existsSync(stamp) ? readFileSync(stamp, 'utf8') : null;
  if (recorded !== identity) {
    const removed = removeCmakeBuildScriptDirs(target);
    if (removed > 0) {
      console.error(`devenv: toolchain identity changed; removed ${removed} cmake build-script cache(s) under target/`);
    }
    for (const info of rustcInfoCaches(target, 0)) {
      rmSync(info, { force: true });
    }
    writeFileSync(stamp, identity);
  }
}

async function toolchainIdentity(): Promise<string> {
  const rustc = await $`rustc -Vv`.quiet().nothrow().text();
  const cc = (await $`cc --version`.quiet().nothrow().text()).split('\n')[0] ?? '';
  return [
    rustc.trim(),
    `SDKROOT=${process.env.SDKROOT ?? ''}`,
    `DEVELOPER_DIR=${process.env.DEVELOPER_DIR ?? ''}`,
    cc,
  ].join('\n');
}

/**
 * Removes every cargo build-script directory (`…/build/<crate>-<hash>`) whose
 * `out/build/CMakeCache.txt` exists; returns the count. Only the `build/`
 * directories cargo creates under a profile are scanned - never the compiled
 * artifacts beside them - and the scan completes before anything is removed.
 */
function removeCmakeBuildScriptDirs(target: string): number {
  const stale: string[] = [];
  for (const buildDir of cargoBuildDirs(target, 0)) {
    for (const entry of readdirSync(buildDir, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(join(buildDir, entry.name, 'out', 'build', 'CMakeCache.txt'))) {
        stale.push(join(buildDir, entry.name));
      }
    }
  }
  for (const dir of stale) {
    rmSync(dir, { recursive: true, force: true });
  }
  return stale.length;
}

/** `target/[<lane>/][<triple>/]<profile>/build` - at most four levels below target/. */
function* cargoBuildDirs(dir: string, depth: number): Generator<string> {
  if (depth > 4) {
    return;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const path = join(dir, entry.name);
    if (entry.name === 'build' && depth > 0) {
      yield path;
    } else if (entry.name !== 'deps' && entry.name !== 'incremental' && entry.name !== '.fingerprint') {
      yield* cargoBuildDirs(path, depth + 1);
    }
  }
}

/**
 * Every `.rustc_info.json` cargo wrote at a target-directory root: target/
 * itself and the lanes nested in it (`target/<lane>`, and trybuild's
 * `target/tests/trybuild`) - at most two levels below target/.
 */
function* rustcInfoCaches(dir: string, depth: number): Generator<string> {
  const info = join(dir, '.rustc_info.json');
  if (existsSync(info)) {
    yield info;
  }
  if (depth === 2) {
    return;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      entry.name !== 'build' &&
      entry.name !== 'deps' &&
      entry.name !== 'incremental' &&
      entry.name !== '.fingerprint'
    ) {
      yield* rustcInfoCaches(join(dir, entry.name), depth + 1);
    }
  }
}
