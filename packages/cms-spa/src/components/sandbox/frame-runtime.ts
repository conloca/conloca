/**
 * Re-export the sandboxed content boundary from @conloca/mdx so astro-cms, the
 * SPA and any other server of the frame share one frame document builder — the
 * sandbox boundary is defined in exactly one place.
 */
export {
  buildSandboxSrcdoc,
  createSandboxRuntime,
  runCompiledMdx,
  SANDBOX_FRAME_CSP,
  SANDBOX_FRAME_PATH,
  type SandboxOutboundMessage,
  type SandboxRenderMessage,
  sandboxFrameMain,
} from '@conloca/mdx/sandbox-frame';
