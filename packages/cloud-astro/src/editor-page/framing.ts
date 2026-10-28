import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface FramingSnippets {
  /** `public/_headers` for Cloudflare Pages and Cloudflare Workers static assets; goes after any site-wide rule. */
  cloudflareHeaders: string;
  /** `public/_headers` for Netlify, which has no syntax for removing a header. */
  netlifyHeaders: string;
  /** The `headers` entries for `vercel.json`. */
  vercelHeaders: { source: string; headers: { key: string; value: string }[] }[];
}

const SANDBOX_FRAME_RULE = '/_conloca/editor/sandbox-frame.html\n  Content-Security-Policy: sandbox allow-scripts\n';

/** The /_conloca/editor/ header rules that let the workspace editor frame the page (§3.6). */
export function framingSnippets(editorRoot: string): FramingSnippets {
  const frameAncestors = `frame-ancestors 'self' https://*.${editorRoot}`;
  const detach = '  ! X-Frame-Options\n  ! Content-Security-Policy\n';
  const pathRule = (removals: string) =>
    `/_conloca/editor/*\n${removals}  Content-Security-Policy: ${frameAncestors}\n\n${SANDBOX_FRAME_RULE}`;
  return {
    cloudflareHeaders: pathRule(detach),
    netlifyHeaders: pathRule(''),
    vercelHeaders: [
      { source: '/_conloca/editor/:path*', headers: [{ key: 'Content-Security-Policy', value: frameAncestors }] },
      {
        source: '/_conloca/editor/sandbox-frame.html',
        headers: [{ key: 'Content-Security-Policy', value: 'sandbox allow-scripts' }],
      },
    ],
  };
}

export interface FramingBlocker {
  file: 'public/_headers' | 'netlify.toml' | 'vercel.json';
  header: 'X-Frame-Options' | 'frame-ancestors';
}

const HEADER_FILES: readonly FramingBlocker['file'][] = ['public/_headers', 'netlify.toml', 'vercel.json'];
const FRAMING_HEADERS: readonly FramingBlocker['header'][] = ['X-Frame-Options', 'frame-ancestors'];

/** Committed header files that forbid framing, when none of them carries a /_conloca/editor/ rule. */
export async function findFramingBlockers(projectRoot: string): Promise<FramingBlocker[]> {
  // shortcut: text match, not a parse of each format; doctor --live checks the real headers.
  // shortcut: a site-wide CSP with frame-ancestors still blocks on Netlify and Vercel once the rule exists, since a
  // second CSP header cannot loosen the first; this reports nothing then, and doctor --live finds it.
  const texts = await Promise.all(
    HEADER_FILES.map((file) =>
      readFile(join(projectRoot, file), 'utf8').then(
        (text) => text.toLowerCase(),
        () => undefined,
      ),
    ),
  );
  // connect may add the rule to a different file than the one that blocks (public/_headers for a netlify.toml rule).
  if (texts.some((text) => text?.includes('/_conloca/editor/'))) return [];
  return HEADER_FILES.flatMap((file, index) => {
    const text = texts[index];
    if (text === undefined) return [];
    return FRAMING_HEADERS.filter((header) => text.includes(header.toLowerCase())).map((header) => ({ file, header }));
  });
}
