import { describe, expect, test } from 'bun:test';
import { buildSandboxSrcdoc, SANDBOX_FRAME_CSP, SANDBOX_FRAME_PATH } from './frame-runtime.js';

describe('sandbox frame runtime — srcdoc document', () => {
  test('never evals and closes structured-data egress, leaving only metadata channels', () => {
    expect(SANDBOX_FRAME_CSP).not.toContain('unsafe-eval');
    expect(SANDBOX_FRAME_CSP).toContain("script-src 'unsafe-inline';");
    expect(SANDBOX_FRAME_CSP).toContain("default-src 'none'");
    // No connect-src: fetch/XHR/WebSocket/sendBeacon cannot post data out.
    expect(SANDBOX_FRAME_CSP).not.toContain('connect-src');
    // Passive img/font GETs to https: stay open for preview fidelity — a
    // metadata-only channel (as is inherent self-navigation), never privileged
    // content, since the opaque origin exposes nothing to exfiltrate.
    expect(SANDBOX_FRAME_CSP).toContain('img-src data: https: blob:');
    expect(SANDBOX_FRAME_CSP).toContain('font-src data: https:');
  });

  test('embeds the CSP meta and the serialized bootstrap, without privileged globals or an MDX evaluator', () => {
    const srcdoc = buildSandboxSrcdoc();
    expect(srcdoc).toContain('http-equiv="Content-Security-Policy"');
    expect(srcdoc).toContain(SANDBOX_FRAME_CSP);
    expect(srcdoc).toContain('__sandbox_root');
    // flow-root contains collapsing prose margins so height posts match paint
    expect(srcdoc).toContain('display:flow-root');
    // The frame document must never reference the privileged singletons.
    expect(srcdoc).not.toContain('__CONTENT_API_CLIENT__');
    expect(srcdoc).not.toContain('__QUERY_CLIENT__');
    // HTML is the only mode: nothing in the frame turns a string into code.
    expect(srcdoc).not.toContain('AsyncFunction');
  });

  test('exposes the well-known frame path for the SPA asset', () => {
    expect(SANDBOX_FRAME_PATH).toBe('/api/v1/mdx/sandbox-frame');
  });

  test('bootstrap defines __name so bundled Function#toString helpers do not crash', () => {
    const srcdoc = buildSandboxSrcdoc();
    expect(srcdoc).toContain('var __name=');
    // Simulate a bundler's keepNames annotation inside the serialized body.
    const withHelperUse = srcdoc.replace(
      'var __name=function(fn){return fn};',
      'var __name=function(fn){return fn}; var _x=/* @__PURE__ */ __name(function(){return 1}, "x");',
    );
    expect(withHelperUse).toContain('__name=function');
  });
});
