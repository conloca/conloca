/**
 * Runs `work` with everything it logs to stdout (console.log/info/debug)
 * rerouted to stderr. In --json mode stdout must stay a single JSON object;
 * the filesystem API and the setup scaffold both report progress on stdout.
 */
export async function withStdoutRedirected<T>(redirect: boolean, work: () => Promise<T>): Promise<T> {
  if (!redirect) return work();
  const original = { log: console.log, info: console.info, debug: console.debug };
  const toStderr = (...args: unknown[]) => console.error(...args);
  console.log = toStderr;
  console.info = toStderr;
  console.debug = toStderr;
  try {
    return await work();
  } finally {
    console.log = original.log;
    console.info = original.info;
    console.debug = original.debug;
  }
}

/** Report one failure in the requested output mode and exit 1. */
export function fail(json: boolean, message: string, field?: string): never {
  if (json) {
    console.log(JSON.stringify({ ok: false, error: message, ...(field ? { field } : {}) }));
  } else {
    console.error(`Error: ${message}${field ? ` (field: ${field})` : ''}`);
  }
  process.exit(1);
}
