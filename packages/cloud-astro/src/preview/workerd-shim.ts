/**
 * Strips the `[object process]` masquerade from workerd's nodejs_compat
 * `process` shim.
 *
 * Astro picks its response-body strategy with
 * `Object.prototype.toString.call(process) === '[object process]'`
 * (astro/dist/runtime/server/render/util.js). Under nodejs_compat at some
 * compatibility dates (observed broken at 2026-01-01, fixed by 2026-03-15)
 * workerd tags its emulated process exactly like Node's, so Astro takes the
 * Node branch and returns a bare async-iterable as the body — which the
 * Cloudflare Workers `Response` cannot consume and coerces to the literal string
 * "[object Object]" for every on-demand page.
 *
 * The Node branch is ALWAYS wrong on workerd, so the shim removes the tag —
 * on workerd only (identified by its fixed `navigator.userAgent`), before any
 * render runs. On real Node the tag is native and stays.
 */
export function untagWorkerdProcess(
  proc: unknown = (globalThis as { process?: unknown }).process,
  userAgent: string | undefined = (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent,
): boolean {
  if (userAgent !== 'Cloudflare-Workers') return false;
  if (typeof proc !== 'object' || proc === null) return false;
  if (Object.prototype.toString.call(proc) !== '[object process]') return false;
  try {
    delete (proc as Record<PropertyKey, unknown>)[Symbol.toStringTag];
  } catch {
    return false;
  }
  return Object.prototype.toString.call(proc) !== '[object process]';
}
