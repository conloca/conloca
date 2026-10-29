/**
 * The imperative shell around cargo-fetch-bound.ts: it spawns the command in a process group of its own, reads its
 * output, keeps the clock, and kills the group when cargo-fetch-bound.ts says the deadline has passed, and again while
 * the group still has members. Every decision is that file's; this one only measures and acts.
 *
 * The command runs detached (`setsid`), so a signal that ends this process no longer reaches it the way a terminal's
 * would. The shell therefore ends the group itself when this process is ending (a SIGINT, SIGTERM or SIGHUP, or exit),
 * and a fetch never outlives the step that started it. Like secret-references.ts this is a managed raw script that
 * shell entry loads before anything is installed, so it imports only the runtime and its sibling.
 */
import { writeSync } from 'node:fs';
import { constants } from 'node:os';
import {
  DEADLINE_PATIENCE,
  describeTeardown,
  judgeBound,
  judgeReap,
  type Patience,
  TEARDOWN_PATIENCE,
} from './cargo-fetch-bound.ts';

/** The shell's two uses of time, so a caller can move it by hand. */
export interface Clock {
  /** Milliseconds on a scale that only moves forward; its differences are the elapsed time. */
  now(): number;
  /** Calls `wake` after `ms` milliseconds unless the returned function cancels it first. */
  after(ms: number, wake: () => void): () => void;
}

export const systemClock: Clock = {
  now: () => performance.now(),
  after: (ms, wake) => {
    const timer = setTimeout(wake, ms);
    return () => clearTimeout(timer);
  },
};

export interface BoundedCommand {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly deadlineMs: number;
  /** Copy the output to this process's own as it arrives, besides capturing it. */
  readonly echo: boolean;
}

export type BoundedOutcome =
  /** The command ended on its own; a signal that ended it is reported as a shell does, 128 plus its number. */
  | { readonly kind: 'exited'; readonly exitCode: number; readonly stdout: Uint8Array; readonly stderr: Uint8Array }
  /**
   * The deadline passed with the command still running: it and its process group were killed. The output is what was
   * read before the kill. `membersLeft` is whether the kernel still listed members of process group `group` when the
   * kill stopped signalling it: a member that left the group is beyond the kill's reach.
   */
  | {
      readonly kind: 'expired';
      readonly elapsedMs: number;
      readonly group: number;
      readonly membersLeft: boolean;
      readonly stdout: Uint8Array;
      readonly stderr: Uint8Array;
    };

/** The signals that end this process and so must end the command with it. */
const TEARDOWN_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;

/**
 * Runs `command` and returns how it ended. Failure to start it rejects; so does a failure to read its output, after
 * the group is killed. Whatever way this returns or throws, the group is killed on every path but the command ending
 * itself, and killed again while it still has members (`reapGroup`). What a kill on the way out leaves is said on
 * stderr, and what the deadline's leaves is in the outcome.
 */
export async function runBounded(command: BoundedCommand, clock: Clock = systemClock): Promise<BoundedOutcome> {
  const commandLine = command.argv.join(' ');
  let group: number | undefined;
  // The kill on the paths where nobody reads an outcome: this process is ending, or the call is failing. Nothing can be
  // awaited there, not even the leader's exit, and until this process reaps it the kernel lists the leader as a member
  // of its own group. So the kill cannot tell a member it missed from the leader, and what it leaves is said as listed,
  // not as running.
  const endGroup = (): void => {
    if (group === undefined) return;
    try {
      if (reapGroup(group, TEARDOWN_PATIENCE)) tell(describeTeardown({ command: commandLine, group }));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      tell(`${commandLine} could not be ended on the way out: ${reason}`);
    }
  };
  // The hooks come before the spawn: a signal that arrives from the spawn on runs its handler after this synchronous
  // body, by which time the group is known.
  const release = endWithThisProcess(endGroup);
  try {
    const child = Bun.spawn({
      cmd: [...command.argv],
      cwd: command.cwd,
      env: { ...command.env },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      detached: true,
    });
    group = child.pid;
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    const stdoutReader = child.stdout.getReader();
    const stderrReader = child.stderr.getReader();
    let finished = false;
    const done = Promise.all([
      child.exited,
      pump(stdoutReader, stdout, command.echo ? (chunk) => process.stdout.write(chunk) : null),
      pump(stderrReader, stderr, command.echo ? (chunk) => process.stderr.write(chunk) : null),
    ]).then(() => {
      finished = true;
    });
    const started = clock.now();
    for (;;) {
      const elapsedMs = clock.now() - started;
      const verdict = judgeBound({ deadlineMs: command.deadlineMs, elapsedMs, finished });
      switch (verdict.kind) {
        case 'finished':
          return {
            kind: 'exited',
            exitCode: statusOf(child),
            stdout: Buffer.concat(stdout),
            stderr: Buffer.concat(stderr),
          };
        case 'kill': {
          // Until it is reaped the leader is a member of its own group, and reapGroup looks for members the kill
          // missed: the leader's exit is awaited before the group is asked about.
          signalGroup(child.pid);
          await child.exited;
          const membersLeft = reapGroup(child.pid, DEADLINE_PATIENCE);
          return {
            kind: 'expired',
            elapsedMs,
            group: child.pid,
            membersLeft,
            stdout: Buffer.concat(stdout),
            stderr: Buffer.concat(stderr),
          };
        }
        case 'wait':
          await untilFinishedOrAfter(done, clock, verdict.forMs);
      }
    }
  } catch (error) {
    endGroup();
    throw error;
  } finally {
    release();
  }
}

/** Resolves when `done` does, or `ms` after now on `clock`, whichever is first, leaving no timer behind. */
async function untilFinishedOrAfter(done: Promise<void>, clock: Clock, ms: number): Promise<void> {
  const { promise: elapsed, resolve } = Promise.withResolvers<void>();
  const cancel = clock.after(ms, resolve);
  try {
    await Promise.race([done, elapsed]);
  } finally {
    cancel();
  }
}

/** What the shell asks of the reader of a piped stream: the part every typing of the runtime's readers shares. */
interface PipeReader {
  read(): Promise<{ readonly done: boolean; readonly value?: Uint8Array }>;
}

/** Copies a stream to `sink`, and to `echo` when there is one, until it ends. */
async function pump(reader: PipeReader, sink: Uint8Array[], echo: ((chunk: Uint8Array) => void) | null): Promise<void> {
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    if (value !== undefined) {
      sink.push(value);
      echo?.(value);
    }
  }
}

/** The exit status of a command that has exited: its own, or a shell's 128 plus the number of the signal that ended it. */
function statusOf(child: {
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | number | null;
}): number {
  if (child.exitCode !== null) return child.exitCode;
  const signal = child.signalCode;
  if (typeof signal === 'number') return 128 + signal;
  // invariant: a command that has exited has an exit code or the signal that ended it.
  if (signal === null) throw new Error('an exited command reports neither an exit code nor a signal');
  return 128 + constants.signals[signal];
}

/** The errno code of a failed system call, when it has one. */
function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}

/**
 * SIGKILL to every process of the group led by `pgid`. A group that is already gone is not an error, nor is one with no
 * member left that can be signalled. Nothing is asked to stop first: a fetch past its deadline is stalled, a member
 * that ignores SIGTERM would go on holding the package-cache lock, and a kill costs a fetch nothing it relies on (the
 * kernel drops the lock, and Cargo's caches tolerate being killed).
 */
function signalGroup(pgid: number): void {
  try {
    process.kill(-pgid, 'SIGKILL');
  } catch (error) {
    // ESRCH: the group is gone. EPERM: no member of it can be signalled, which is what a member that exited and has not
    // been reaped yet answers on macOS; groupHasMembers says whether any is left. Any other answer is a failure.
    const code = errorCode(error);
    if (code !== 'ESRCH' && code !== 'EPERM') throw error;
  }
}

/**
 * Whether the kernel lists a member of the group led by `pgid`. It is the probe the bounded-exec executor makes
 * (`processGroupHasMembers`), which this script cannot import because it runs before anything is installed. ESRCH
 * proves the group is empty. EPERM proves a member exists that this process may not signal, such as one that exited
 * and has not been reaped, which macOS reports that way. Any other answer proves neither and is a failure, not a
 * verdict. A group outlives its reaped leader for as long as one member does, and no process can take its id
 * meanwhile.
 */
function groupHasMembers(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ESRCH') return false;
    if (code === 'EPERM') return true;
    throw error;
  }
}

/**
 * Kills the group led by `pgid` and keeps killing it while it has members, as `judgeReap` in cargo-fetch-bound.ts says:
 * a group signal reaches the members that exist when it goes out, and macOS does not hold a fork back while it does, so
 * a member forked in that moment survives it. Each round signals once and then waits `patience.pauseMs`, blocking this
 * process: while a kill is being finished nothing else is wanted of it. Returns whether members were left when the
 * patience ran out.
 */
function reapGroup(pgid: number, patience: Patience): boolean {
  for (let round = 0; ; round += 1) {
    const verdict = judgeReap({ round, patience, members: groupHasMembers(pgid) });
    switch (verdict.kind) {
      case 'empty':
        return false;
      case 'members-left':
        return true;
      case 'signal':
        signalGroup(pgid);
        if (patience.pauseMs > 0) Bun.sleepSync(patience.pauseMs);
    }
  }
}

/**
 * Says `message` on stderr. Where stderr is gone there is nobody to tell, and a diagnostic must neither replace the
 * failure it accompanies nor stop the signal being given back.
 */
function tell(message: string): void {
  try {
    writeSync(2, `${message}\n`);
  } catch {
    // Nobody is left to tell.
  }
}

/**
 * Has `end` run when this process is ending: on exit, and on a SIGINT, SIGTERM or SIGHUP, which also gives the signal
 * back to the process afterwards so it still ends by that signal. A signal somebody already handles stays theirs.
 * Returns the function that takes the hooks away.
 */
function endWithThisProcess(end: () => void): () => void {
  const hooks: Array<readonly [NodeJS.Signals, () => void]> = [];
  const release = (): void => {
    process.removeListener('exit', end);
    for (const [signal, handler] of hooks) process.removeListener(signal, handler);
    hooks.length = 0;
  };
  process.on('exit', end);
  for (const signal of TEARDOWN_SIGNALS) {
    if (process.listenerCount(signal) !== 0) continue;
    const handler = (): void => {
      // The signal is given back whatever `end` does: this process must still end by it.
      try {
        end();
      } finally {
        release();
        process.kill(process.pid, signal);
      }
    };
    process.on(signal, handler);
    hooks.push([signal, handler]);
  }
  return release;
}
