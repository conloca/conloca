import { describe, expect, it } from 'bun:test';
import { untagWorkerdProcess } from '../preview/workerd-shim.js';

// Astro decides Node-vs-web streaming with
// `Object.prototype.toString.call(process) === '[object process]'`. Under
// workerd's nodejs_compat (compat dates around 2026-01) the emulated process
// carries that tag, so Astro takes the Node branch and hands the Cloudflare
// Workers Response an async-iterable object it cannot consume — every on-demand page renders as
// the literal string "[object Object]". The shim strips the tag ON WORKERD
// ONLY, before Astro's check ever runs.

function taggedProcess(): Record<PropertyKey, unknown> {
  const proc: Record<PropertyKey, unknown> = { env: {} };
  Object.defineProperty(proc, Symbol.toStringTag, { value: 'process', configurable: true });
  return proc;
}

describe('untagWorkerdProcess', () => {
  it('removes the [object process] tag when running on workerd', () => {
    const proc = taggedProcess();
    expect(Object.prototype.toString.call(proc)).toBe('[object process]');

    const untagged = untagWorkerdProcess(proc, 'Cloudflare-Workers');

    expect(untagged).toBe(true);
    expect(Object.prototype.toString.call(proc)).toBe('[object Object]');
  });

  it('leaves process untouched on a real Node runtime (no workerd user agent)', () => {
    const proc = taggedProcess();
    expect(untagWorkerdProcess(proc, undefined)).toBe(false);
    expect(untagWorkerdProcess(proc, 'Mozilla/5.0')).toBe(false);
    expect(Object.prototype.toString.call(proc)).toBe('[object process]');
  });

  it('is a safe no-op when process is absent or untagged', () => {
    // null, not undefined: an explicit undefined argument would fall back to
    // the parameter default (the runtime's real process).
    expect(untagWorkerdProcess(null, 'Cloudflare-Workers')).toBe(false);
    expect(untagWorkerdProcess({ env: {} }, 'Cloudflare-Workers')).toBe(false);
  });

  it('survives a non-configurable tag instead of throwing', () => {
    const proc: Record<PropertyKey, unknown> = {};
    Object.defineProperty(proc, Symbol.toStringTag, { value: 'process', configurable: false });
    expect(untagWorkerdProcess(proc, 'Cloudflare-Workers')).toBe(false);
  });
});
