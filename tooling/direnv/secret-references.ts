/**
 * Provider-neutral local secret resolution for smoo-managed repositories.
 *
 * Reads the root package.json `smoo.secrets` map and `smoo.remoteCache` block
 * — the bootstrap twins of `PackageSecretCommand`, `PackageSmooConfig.secrets`
 * and `PackageRemoteCacheConfig` in packages/cli/src/lib/json.ts. This file is
 * a managed raw script: it runs from `tooling/direnv/setup-environment.ts`
 * BEFORE `bun install`, when no workspace package and no Typia transform exist
 * yet, so both shapes are hand-validated here against exactly what json.ts
 * declares. Keep them aligned; smoo's Typia validation fails the manifest at
 * generation time for anything this file would reject at runtime.
 *
 * THE RULE: shell entry resolves the `shell` group and nothing else. Every
 * other group belongs to the command that needs it:
 * `smoo secrets run <group> <command...>`.
 *
 * Shell entry happens on every direnv reload and every `devenv shell --
 * <command>`, and a provider authorises per requesting process lineage, which
 * is new each time — so a provider command placed there is a credential
 * prompt on every one of them: dozens an hour for a developer, one more for
 * every scripted subprocess. A credential whose only consumer is a deliberate
 * command therefore belongs to that command.
 *
 * A group is NOT a fourth thing to declare. It is derived from the
 * declarations a repository already carries, and an explicit `group` on the
 * entry is only for what those cannot say. Derivation, per variable:
 *
 *  - `nx-cache` — the variable `smoo.remoteCache.tokenSecret` names. A remote
 *    cache is an optimization: Nx reads NX_SELF_HOSTED_REMOTE_CACHE_SERVER
 *    and _ACCESS_TOKEN from the environment it runs in — CI injects them, a
 *    developer exports the token once in the terminal that wants the cache —
 *    and every nested shell inherits them. Absent, Nx keeps to its local
 *    cache.
 *  - `registry` — a variable `.npmrc` interpolates as `${VAR}`. An installed
 *    checkout contacts no registry at all (measured: `bun install --dry-run`
 *    succeeds in 14ms with the token absent), while a request that does
 *    contact one answers 401 without it.
 *  - `shell` — everything else: what the shell itself is for, resolved at
 *    entry because that is when it is needed.
 *
 * An explicit `group` wins over the derivation, and no group is privileged in
 * code: a repository may name one of its own and run it the same way. Only
 * the shape is validated, so a new group needs no new smoo release.
 *
 * Routing per declared variable, in first-match order:
 *
 *  1. An existing nonempty environment value wins; no command runs.
 *  2. For the requested group, and for a group the request depends on (see
 *     below), a context that cannot run a provider command at all decides
 *     before the group does:
 *     a. CI (`CI` set): variables must be injected from the CI secret store;
 *        provider commands never run there. Missing variables refuse with
 *        injected-secret guidance instead of a confusing auth failure later.
 *     b. A `registry` variable inside a cowshed workspace
 *        (`COWSHED_WORKSPACE_TOKEN` set) refuses with names-only
 *        gateway-enrollment guidance: such a workspace holds no provider
 *        session, and the gateway exists to be the thing that does.
 *  3. A variable outside the requested group is deferred — named in the
 *     result, not resolved, and not a failure.
 *  4. Otherwise the command argv executes directly, without a shell; stdout
 *     with one terminal newline trimmed becomes the value.
 *
 * A request DEPENDS ON a group when the operation being resolved for reads
 * that group's own declaration. Shell entry runs `bun install`, and
 * `bun install` reads `.npmrc` — so `registry` is an input to shell entry
 * that shell entry deliberately does not resolve. That dependency is what
 * keeps rule 2 honest in a context which cannot honour a deferral: CI has no
 * later command to run and a cowshed workspace has no provider session, so
 * both refuse by name rather than promising that `smoo secrets run` would
 * fix it. Nothing shell entry runs reads `smoo.remoteCache`, so an
 * `nx-cache` variable is deferred in every context and blocks nothing.
 *
 * A deferred variable is a value in the result rather than a silent omission,
 * and there is no fallback that resolves it anyway: a fallback would
 * reinstate the prompt this rule removes, at the least predictable moment.
 * The caller names the variable and the command that supplies it when the
 * operation that needed it fails.
 *
 * Failures aggregate so a single direnv reload surfaces every problem.
 * Error text names variables, groups and exit codes only: secret values,
 * provider stdout/stderr, and command arguments are never echoed.
 * A resolved value still reaches the environment of the install its caller
 * runs next, so `maskSecretValues` redacts those values out of any captured
 * child output that caller replays.
 *
 * Zero prompts, as an option and not a recommendation: a declared `command`
 * may point at the OS keychain instead of at the provider. On macOS, populate
 * the item once from the 1Password item (`security add-generic-password -s
 * <name> -a <account> -w`) and declare
 * `["security", "find-generic-password", "-w", "-s", "<name>"]`. macOS
 * authorises a keychain item per calling binary, so the first approval covers
 * every later read by that binary: rule 4 then answers without prompting and
 * the deferral above never has to be paid. 1Password stays the source of
 * truth and the keychain is a session cache of it — but the trade-off is
 * exactly that, a second copy of the credential now lives on disk, outside
 * the provider's rotation and revocation, and nothing here refreshes it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Which operation resolves a declared secret. Open by construction: the three
 * below are the DERIVED defaults, not the permitted values, so a repository
 * that declares `"group": "deploy"` needs no smoo release to run it.
 */
export type SecretGroup = string;

/** Resolved at shell entry, because that is the operation that needs it. */
export const SHELL_GROUP: SecretGroup = 'shell';

/** Derived for a variable `.npmrc` interpolates as `${VAR}`. */
export const REGISTRY_GROUP: SecretGroup = 'registry';

/** Derived for the variable `smoo.remoteCache.tokenSecret` names. */
export const NX_CACHE_GROUP: SecretGroup = 'nx-cache';

export interface SecretSpec {
  /** Executed directly, without a shell; stdout supplies the secret value. */
  readonly command: readonly [string, ...string[]];
  /**
   * Overrides the derived group. Declared only for what the repository's own
   * declarations cannot say — a credential no `.npmrc` reference and no cache
   * token identifies, or one whose derivation is deliberately overridden.
   */
  readonly group?: SecretGroup;
}

/** A declared secret with its group settled: explicit if stated, derived otherwise. */
export interface GroupedSecret {
  readonly name: string;
  /** The group that resolves it: `spec.group` when declared, `derivedGroup` otherwise. */
  readonly group: SecretGroup;
  /**
   * What this repository's own declarations imply, kept beside the effective
   * group so an override is a visible fact rather than a silent one. Equal to
   * `group` unless the entry declares a different one.
   */
  readonly derivedGroup: SecretGroup;
  readonly spec: SecretSpec;
}

export type SecretCommandRunner = (argv: readonly string[]) => Promise<string>;

export interface SecretResolutionRequest {
  /** Every declared secret of the repository, each with its group settled. */
  readonly secrets: readonly GroupedSecret[];
  /** The one group to resolve. No default: the wrong one is a credential prompt. */
  readonly group: SecretGroup;
  /** Environment consulted for existing values and mode flags; read, never written. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Overrides the default direct-argv runner (test seam). */
  readonly runCommand?: SecretCommandRunner;
}

export interface SecretResolutionOptions {
  /** Repository root holding package.json and .npmrc. */
  readonly root: string;
  /** The one group to resolve. No default: the wrong one is a credential prompt. */
  readonly group: SecretGroup;
  /** Environment to consult; defaults to process.env. Read, never written. */
  readonly env?: Record<string, string | undefined>;
  /** Overrides the default direct-argv runner (test seam). */
  readonly runCommand?: SecretCommandRunner;
}

/** A declared secret this request declined to resolve, and how to supply it. */
export interface DeferredSecret {
  readonly name: string;
  readonly group: SecretGroup;
  readonly guidance: string;
}

/**
 * The resolution as a value: what belongs in a child's environment, and what
 * was deliberately left out of it. Every declared secret appears in exactly
 * one of `values`, `deferred`, or neither — the environment already carried
 * it.
 */
export interface SecretResolution {
  readonly values: Readonly<Record<string, string>>;
  readonly deferred: readonly DeferredSecret[];
}

/**
 * The env name pattern every shell accepts, so the same regex classifies
 * declared names and `.npmrc` references without echoing values.
 */
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * A group label's shape, and only its shape. It is one argv word of
 * `smoo secrets run <group> <command...>`, so whitespace would make the
 * command unwritable; every other value is the repository's business.
 */
const GROUP_NAME = /^\S+$/;

/** The `.npmrc` interpolations Bun substitutes while reading auth and registry config. */
const NPMRC_ENV_REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * The command that resolves one group for exactly one child process. Every
 * deferral names it, so what a developer reads is the command to run next
 * rather than a description of one.
 */
const ON_DEMAND_COMMAND = 'smoo secrets run';

/**
 * Groups an operation depends on without resolving them, keyed by the group
 * it does resolve. Shell entry runs `bun install`, which reads `.npmrc` —
 * the declaration that derives `registry`. This is a dependency edge, not an
 * exclusion: it makes CI and a cowshed workspace refuse a registry credential
 * they cannot supply later, where a group nothing depends on stays silent.
 */
const DEPENDENT_GROUPS: Readonly<Record<string, readonly SecretGroup[]>> = {
  [SHELL_GROUP]: [REGISTRY_GROUP],
};

/** Groups a request for `group` needs supplied but does not resolve itself. */
export function dependentGroups(group: SecretGroup): readonly SecretGroup[] {
  return DEPENDENT_GROUPS[group] ?? [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonemptyEnvValue(value: string | undefined): value is string {
  return value !== undefined && value.length > 0;
}

/**
 * Validates the `smoo.secrets` map out of an already-parsed package.json.
 * Absent `smoo` or `smoo.secrets` is an empty map; a malformed declaration
 * throws naming the offending variable — never a value.
 */
export function parseSmooSecrets(packageJson: unknown): Readonly<Record<string, SecretSpec>> {
  if (!isRecord(packageJson)) return {};
  const smoo = packageJson.smoo;
  if (!isRecord(smoo)) return {};
  const secrets = smoo.secrets;
  if (secrets === undefined) return {};
  if (!isRecord(secrets)) {
    throw new Error('smoo.secrets must map environment variable names to { command: [string, ...] }');
  }
  const parsed: Record<string, SecretSpec> = {};
  for (const [name, spec] of Object.entries(secrets)) {
    parsed[name] = parseSecretSpec(name, spec);
  }
  return parsed;
}

function parseSecretSpec(name: string, spec: unknown): SecretSpec {
  if (!ENV_NAME.test(name)) {
    throw new Error(
      `smoo.secrets: "${name}" is not a valid environment variable name (expected [A-Za-z_][A-Za-z0-9_]*)`,
    );
  }
  if (!isRecord(spec)) {
    throw new Error(`smoo.secrets.${name}: each entry must be an object with a command array`);
  }
  const raw = spec.command;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`smoo.secrets.${name}.command: must be an array of at least one string`);
  }
  for (const part of raw) {
    if (typeof part !== 'string') {
      throw new Error(`smoo.secrets.${name}.command: must be an array of at least one string`);
    }
  }
  const [first, ...rest] = raw;
  const group = spec.group;
  if (group === undefined) {
    return { command: [first, ...rest] };
  }
  if (typeof group !== 'string' || !GROUP_NAME.test(group)) {
    throw new Error(
      `smoo.secrets.${name}.group: must be a nonempty label without whitespace, so \`${ON_DEMAND_COMMAND} <group>\` can name it`,
    );
  }
  return { command: [first, ...rest], group };
}

/**
 * The declared remote cache as a local shell needs it. `internalServer` is
 * deliberately absent: it is the address a managed runner reaches inside its
 * own network, and a shell that loads this file is by definition outside it,
 * so a developer machine always takes the public `server`.
 */
export interface RemoteCacheSpec {
  readonly server: string;
  /** Variable holding the cache token: an ambient value, or a `smoo.secrets` entry in group `nx-cache`. */
  readonly tokenSecret: string;
}

/**
 * Validates the `smoo.remoteCache` block out of an already-parsed
 * package.json. Absent `smoo` or `smoo.remoteCache` is no cache; a malformed
 * declaration throws naming the field.
 */
export function parseSmooRemoteCache(packageJson: unknown): RemoteCacheSpec | null {
  if (!isRecord(packageJson)) return null;
  const smoo = packageJson.smoo;
  if (!isRecord(smoo)) return null;
  const remoteCache = smoo.remoteCache;
  if (remoteCache === undefined) return null;
  if (!isRecord(remoteCache)) {
    throw new Error('smoo.remoteCache must be an object with { server, tokenSecret }');
  }
  const server = remoteCache.server;
  const tokenSecret = remoteCache.tokenSecret;
  // A trailing slash is refused rather than trimmed: Nx appends
  // `/v1/cache/<hash>`, so the doubled slash is a route that answers 404
  // forever, and silently repairing the manifest here would leave managed CI
  // — which reads the same field — disagreeing with this shell.
  if (typeof server !== 'string' || server.length === 0 || server.endsWith('/')) {
    throw new Error(
      'smoo.remoteCache.server must be an origin with no trailing slash, e.g. https://nx-cache.example.net',
    );
  }
  if (typeof tokenSecret !== 'string' || !ENV_NAME.test(tokenSecret)) {
    throw new Error('smoo.remoteCache.tokenSecret must name the environment variable holding the cache token');
  }
  return { server, tokenSecret };
}

/** Every `${VAR}` referenced from `.npmrc` text; an absent file contributes nothing. */
export function registryAuthEnvNames(npmrcText: string | null): ReadonlySet<string> {
  const names = new Set<string>();
  if (npmrcText === null) return names;
  for (const match of npmrcText.matchAll(NPMRC_ENV_REFERENCE)) {
    names.add(match[1]);
  }
  return names;
}

/** What a repository's own declarations say about one variable, before any override. */
export interface GroupDerivationContext {
  /** Env names referenced from `.npmrc`: which declared secrets a registry request needs. */
  readonly registryIntentEnvs: ReadonlySet<string>;
  /** The variable `smoo.remoteCache.tokenSecret` names, or null when no cache is declared. */
  readonly cacheTokenEnv: string | null;
}

/**
 * The group a repository's existing declarations already imply for one
 * variable. The cache token is checked first: a variable that is both the
 * declared cache token and `.npmrc`-referenced was excluded from shell entry
 * outright before groups existed, and `nx-cache` is the group that keeps that
 * true.
 */
export function deriveSecretGroup(name: string, context: GroupDerivationContext): SecretGroup {
  if (context.cacheTokenEnv === name) return NX_CACHE_GROUP;
  if (context.registryIntentEnvs.has(name)) return REGISTRY_GROUP;
  return SHELL_GROUP;
}

/** Every declared secret with its group settled, in declaration order. */
export function groupSecrets(
  secrets: Readonly<Record<string, SecretSpec>>,
  context: GroupDerivationContext,
): readonly GroupedSecret[] {
  return Object.entries(secrets).map(([name, spec]) => {
    const derivedGroup = deriveSecretGroup(name, context);
    return { name, group: spec.group ?? derivedGroup, derivedGroup, spec };
  });
}

type SecretOutcome =
  | { readonly name: string; readonly group: SecretGroup; readonly kind: 'env-wins' }
  | { readonly name: string; readonly group: SecretGroup; readonly kind: 'resolved'; readonly value: string }
  | { readonly name: string; readonly group: SecretGroup; readonly kind: 'deferred'; readonly guidance: string }
  | { readonly name: string; readonly group: SecretGroup; readonly kind: 'failed'; readonly guidance: string };

/**
 * One variable's routing, the four rules in the header applied in order. It
 * is a value rather than a throw so each caller presents the result in its
 * own terms: an install refuses, the remote cache turns itself off, and a
 * deferred credential is named only if something then needs it.
 */
async function routeSecret(
  secret: GroupedSecret,
  context: {
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly group: SecretGroup;
    readonly dependsOn: readonly SecretGroup[];
    readonly run: SecretCommandRunner;
  },
): Promise<SecretOutcome> {
  const { env } = context;
  const { name, group } = secret;
  if (isNonemptyEnvValue(env[name])) {
    return { name, group, kind: 'env-wins' };
  }
  const requested = group === context.group;
  if (requested || context.dependsOn.includes(group)) {
    if (isNonemptyEnvValue(env.CI)) {
      return {
        name,
        group,
        kind: 'failed',
        guidance:
          'CI does not run secret provider commands — inject this variable into the job environment from the CI secret store',
      };
    }
    if (group === REGISTRY_GROUP && isNonemptyEnvValue(env.COWSHED_WORKSPACE_TOKEN)) {
      return {
        name,
        group,
        kind: 'failed',
        guidance:
          'a registry credential absent in this cowshed workspace — enroll registry credentials through the cowshed gateway; gateway-managed workspaces never resolve a registry credential via a local provider command',
      };
    }
  }
  if (!requested) {
    return {
      name,
      group,
      kind: 'deferred',
      guidance: `in group \`${group}\`, which a \`${context.group}\` request does not resolve — run \`${ON_DEMAND_COMMAND} ${group} <command>\` to supply it to that one command`,
    };
  }
  try {
    const value = (await context.run(secret.spec.command)).replace(/\r?\n$/, '');
    if (value.length === 0) {
      return {
        name,
        group,
        kind: 'failed',
        guidance:
          'provider command produced no output — run it locally to see why (its arguments and output are never logged here)',
      };
    }
    return { name, group, kind: 'resolved', value };
  } catch (error) {
    return { name, group, kind: 'failed', guidance: describeCommandFailure(error) };
  }
}

export async function resolveSecrets(request: SecretResolutionRequest): Promise<SecretResolution> {
  const context = {
    env: request.env,
    group: request.group,
    dependsOn: dependentGroups(request.group),
    run: request.runCommand ?? runSecretCommand,
  };
  const outcomes = await Promise.all(request.secrets.map(async (secret) => routeSecret(secret, context)));
  const failures = outcomes.filter(
    (outcome): outcome is Extract<SecretOutcome, { kind: 'failed' }> => outcome.kind === 'failed',
  );
  if (failures.length > 0) {
    throw new Error(
      [
        'smoo secret resolution failed:',
        ...failures.map((failure) => `- ${failure.name} (${failure.group}): ${failure.guidance}`),
      ].join('\n'),
    );
  }
  const values: Record<string, string> = {};
  const deferred: DeferredSecret[] = [];
  for (const outcome of outcomes) {
    if (outcome.kind === 'resolved') {
      values[outcome.name] = outcome.value;
    } else if (outcome.kind === 'deferred') {
      deferred.push({ name: outcome.name, group: outcome.group, guidance: outcome.guidance });
    }
  }
  return { values, deferred };
}

class SecretCommandExitError extends Error {
  constructor(readonly exitCode: number) {
    super('secret provider command failed');
  }
}

class SecretCommandStartError extends Error {
  constructor() {
    super('secret provider command could not be started');
  }
}

function describeCommandFailure(error: unknown): string {
  if (error instanceof SecretCommandExitError) {
    return `provider command exited with code ${error.exitCode}; its arguments and output are suppressed — run it locally to debug`;
  }
  if (error instanceof SecretCommandStartError) {
    return 'provider command could not be started — check that its program exists and is executable, then run it locally to debug';
  }
  // Foreign runner errors may carry argv or provider output; only the generic
  // suppression note survives.
  return 'provider command failed — its arguments and output are suppressed; run it locally to debug';
}

/** The program name is committed config, but an argument may embed a credential, so argv is never echoed. */
function startSecretCommand(argv: readonly string[]) {
  try {
    return Bun.spawn({
      cmd: [...argv],
      stdin: 'ignore',
      stdout: 'pipe',
      // Provider stderr can quote arguments or the secret itself; it is never surfaced.
      stderr: 'ignore',
    });
  } catch {
    throw new SecretCommandStartError();
  }
}

const runSecretCommand: SecretCommandRunner = async (argv) => {
  const child = startSecretCommand(argv);
  const stdout = await new Response(child.stdout).text();
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new SecretCommandExitError(exitCode);
  }
  return stdout;
};

/** '*', the byte a redacted secret leaves behind. */
const MASK_BYTE = 0x2a;

/**
 * A copy of captured child output with every resolved secret value replaced
 * by the same number of `*` bytes.
 *
 * setup-environment.ts puts the values this file resolves into the
 * environment of the install it then runs, and replays that child's captured
 * stdout/stderr verbatim when it fails. Whatever the child echoes — a prepare
 * script printing its environment, a registry URL carrying an inline
 * credential — would otherwise walk straight past the suppression the rest of
 * this file maintains. Redaction is byte-exact and same-length, so the
 * failure being reported stays legible and every offset in it still lines up.
 * Output with nothing to redact is returned as it came in, so the path that
 * has no secrets to hide copies nothing.
 */
export function maskSecretValues(output: Uint8Array, values: Iterable<string>): Uint8Array {
  const encoder = new TextEncoder();
  let masked: Uint8Array | undefined;
  for (const value of values) {
    const needle = encoder.encode(value);
    if (needle.length === 0 || needle.length > output.length) {
      continue;
    }
    for (let from = 0; from + needle.length <= output.length; ) {
      const at = indexOfBytes(masked ?? output, needle, from);
      if (at < 0) {
        break;
      }
      // `new Uint8Array`, not `.slice()`: a captured child's output arrives as
      // a node Buffer, whose `slice` is `subarray` — a view. Masking through
      // one would rewrite the caller's own captured bytes.
      masked ??= new Uint8Array(output);
      masked.fill(MASK_BYTE, at, at + needle.length);
      from = at + needle.length;
    }
  }
  return masked ?? output;
}

/** First occurrence of `needle` in `haystack` at or after `from`, or -1. */
function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, from: number): number {
  const first = needle[0];
  if (first === undefined) {
    return -1;
  }
  const last = haystack.length - needle.length;
  for (let at = haystack.indexOf(first, from); at >= 0 && at <= last; at = haystack.indexOf(first, at + 1)) {
    let matches = true;
    for (let offset = 1; offset < needle.length; offset += 1) {
      if (haystack[at + offset] !== needle[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return at;
    }
  }
  return -1;
}

/**
 * Every declared secret of the repository at `root`, each with its group
 * settled from that repository's own declarations. The listing
 * `smoo secrets run` prints and the routing below read the same value, so the
 * groups a developer is offered are exactly the groups that resolve.
 */
export function readSecretGroups(root: string): readonly GroupedSecret[] {
  const packageJson = readPackageJson(root);
  return groupSecrets(parseSmooSecrets(packageJson), {
    registryIntentEnvs: registryAuthEnvNames(readNpmrcText(root)),
    cacheTokenEnv: parseSmooRemoteCache(packageJson)?.tokenSecret ?? null,
  });
}

/**
 * The declared secrets of `options.group`, resolved before the thing that
 * needs them runs. Everything outside that group comes back deferred: named,
 * unresolved, and not a failure — except where rule 2 applies, which is a
 * context that could not honour the deferral anyway.
 */
export async function resolveSecretEnvironment(options: SecretResolutionOptions): Promise<SecretResolution> {
  return resolveSecrets({
    secrets: readSecretGroups(options.root),
    group: options.group,
    env: options.env ?? process.env,
    runCommand: options.runCommand,
  });
}

function readPackageJson(root: string): unknown {
  const packageJsonPath = join(root, 'package.json');
  let text: string;
  try {
    text = readFileSync(packageJsonPath, 'utf8');
  } catch (error) {
    throw new Error(
      `smoo secrets: cannot read ${packageJsonPath} (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `smoo secrets: ${packageJsonPath} is not valid JSON (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  return parsed;
}
function readNpmrcText(root: string): string | null {
  const npmrcPath = join(root, '.npmrc');
  if (!existsSync(npmrcPath)) return null;
  return readFileSync(npmrcPath, 'utf8');
}
