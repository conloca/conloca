'use strict';

// Shared bootstrap of the managed Forgejo artifact actions (forgejo-upload-artifact, forgejo-download-artifact).
//
// Forgejo only resolves a step's `uses:` from a full URL or a name under DEFAULT_ACTIONS_URL, and its stock
// upload/download clients are the GHES-gated GitHub ones. The pinned code.forgejo.org clients lift that gate, so each
// wrapper action fetches its exact pinned commit into a private temporary directory and runs the original dist entry
// with the wrapper's own environment: the INPUT_* variables go in unchanged and the original action writes
// GITHUB_OUTPUT itself. Nothing here interprets, rewrites or defaults an input or an output.
//
// No dependencies beyond Node and git. No credential is persisted, and git cannot prompt.

const { spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');

const GIT_ENVIRONMENT_THAT_REDIRECTS_THE_REPOSITORY = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE'];

function fail(message, status = 1) {
  process.stderr.write('forgejo-artifact: ' + message + '\n');
  process.exitCode = status;
}
function describeExit(result) {
  if (result.error) return 'could not start: ' + result.error.message;
  if (result.signal) return 'was killed by signal ' + result.signal;
  return 'exited with status ' + result.status;
}

function gitEnvironment() {
  const environment = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  for (const name of GIT_ENVIRONMENT_THAT_REDIRECTS_THE_REPOSITORY) delete environment[name];
  return environment;
}

function git(directory, args, captureStdout = false) {
  const result = spawnSync('git', args, {
    cwd: directory,
    env: gitEnvironment(),
    encoding: 'utf8',
    stdio: ['ignore', captureStdout ? 'pipe' : 'inherit', 'inherit'],
  });
  if (result.error || result.status !== 0) {
    fail('git ' + args.join(' ') + ' ' + describeExit(result));
    return null;
  }
  return captureStdout ? result.stdout : '';
}

function checkout(directory, pin) {
  for (const args of [
    ['init', '--quiet', '--initial-branch=main'],
    ['fetch', '--quiet', '--depth=1', '--no-tags', pin.repository, pin.commit],
    ['-c', 'advice.detachedHead=false', 'checkout', '--quiet', '--detach', pin.commit],
  ]) {
    if (git(directory, args) === null) return false;
  }
  const revision = git(directory, ['rev-parse', 'HEAD'], true);
  if (revision === null) return false;
  const head = revision.trim();
  if (head !== pin.commit) {
    fail('checked out HEAD ' + head + ' is not the pinned commit ' + pin.commit);
    return false;
  }
  return true;
}

/** Run the pinned original action: {repository, commit, entry}. Sets process.exitCode; never throws. */
function run(pin) {
  process.exitCode = 0;
  const runnerTemp = process.env.RUNNER_TEMP;
  if (!runnerTemp) {
    fail('RUNNER_TEMP is not set, so there is nowhere private to fetch ' + pin.repository);
    return;
  }
  let directory;
  try {
    directory = mkdtempSync(join(runnerTemp, 'forgejo-artifact-'));
    if (!checkout(directory, pin)) return;
    const result = spawnSync(process.execPath, [join(directory, pin.entry)], { stdio: 'inherit' });
    if (result.error || result.status !== 0) {
      fail(
        pin.repository + '@' + pin.commit + ' ' + pin.entry + ' ' + describeExit(result),
        result.error || result.status === null ? 1 : result.status,
      );
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    if (directory !== undefined) {
      try {
        rmSync(directory, { recursive: true, force: true });
      } catch (error) {
        fail('could not remove ' + directory + ': ' + String(error), process.exitCode || 1);
      }
    }
  }
}

module.exports = { run };
