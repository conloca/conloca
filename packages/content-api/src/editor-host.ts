import { isRecord } from './component-vocabulary.js';

/** The wire protocol an editor page built by this release speaks; the editor UI path is /host/v<this>/. */
export const EDITOR_HOST_PROTOCOL = 1;
/** Protocols the current editor UI accepts. */
export const EDITOR_HOST_PROTOCOLS = { min: 1, max: 1 } as const;
export const DEFAULT_EDITOR_ENDPOINT = 'https://app.conloca.com';
/** Where the editor page is served, below the site's base. */
export const EDITOR_PAGE_PATH = '/_conloca/editor/';
/** The deployable-site id grammar (moved here from cloud-astro's site-id.ts; the census imports it too). */
export const SITE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The parsed http(s) URL when its host is `app.` plus at least two non-empty labels, else null. */
function appUrl(url: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const labels = parsed.hostname.split('.');
  return labels.length >= 3 && labels[0] === 'app' && labels.every((label) => label !== '') ? parsed : null;
}

/** The editor UI origin for an endpoint, or null unless its host is `app.` plus at least two labels. */
export function editorUiOrigin(endpoint: string | undefined): string | null {
  return appUrl(endpoint ?? DEFAULT_EDITOR_ENDPOINT)?.origin ?? null;
}

/** The parent root for a URL on the editor UI origin (`app.conloca.com` → `conloca.com`), or null under the same rule. */
export function parentRoot(url: string): string | null {
  return appUrl(url)?.hostname.slice('app.'.length) ?? null;
}

/** Editor UI file per bare specifier the page's bundle keeps external, under `<origin>/host/v<protocol>/`. */
export const EDITOR_UI_MODULE_FILES = {
  react: 'react.js',
  'react-dom': 'react-dom.js',
  'react-dom/client': 'react-dom-client.js',
  'react/jsx-runtime': 'jsx-runtime.js',
  'react/jsx-dev-runtime': 'jsx-dev-runtime.js',
  '@puckeditor/core': 'puck.js',
} as const;

export type EditorHostStatus =
  | 'ready'
  | 'no-address'
  | 'blocked-address'
  | 'unreachable'
  | 'protected'
  | 'not-found'
  | 'invalid'
  | 'wrong-repo'
  | 'wrong-site'
  | 'unsupported-protocol'
  | 'frame-blocked';

export type EditorFrameFailure = 'handshake-timeout' | 'origin-rejected' | 'unsupported-protocol' | 'site-load-failed';

/** The page's inline JSON block, `<script type="application/json" id="conloca-editor-host">`. URLs are base-absolute. */
export interface EditorHostPageData {
  protocol: number;
  repo: string | null;
  siteId: string;
  site: string;
  css: string[];
  editorCss: string | null;
  sandboxFrame: string;
  info: string;
}

/** conloca.json: public facts about one deploy of the editor page. Grants nothing. */
export interface EditorPageInfo {
  protocol: number;
  repo: string | null;
  siteId: string;
  commit: string | null;
  branch: string | null;
  builtWith: string;
  /** `path` is relative to the editor folder. */
  componentManifest: { path: string; sha256: string } | null;
}

export const EDITOR_PAGE_INFO_FORMATS = {
  commit: /^[0-9a-f]{40}$/,
  builtWith: /^@conloca\/cloud-astro@\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/,
  repo: /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/,
  siteId: SITE_ID_RE,
  sha256: /^[0-9a-f]{64}$/,
  manifestPath: /^component-manifest\.[0-9a-f]{16}\.json$/,
} as const;

/** Where the host serves a build of every other branch, recorded by the production build. */
export type BranchDeploys = { host: 'cloudflare-pages'; project: string };

// One DNS label: the Pages project names the first label of its `pages.dev` address.
const PAGES_PROJECT_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** A parsed conloca.json object, whether or not it passed `isEditorPageInfo`, as the optional-field readers take it. */
export type ConlocaJson = EditorPageInfo | { branchDeploys?: unknown; contentPaths?: unknown };

/** conloca.json `branchDeploys`; `undefined` when absent or malformed, so a bad optional field never makes the page invalid. */
export function branchDeploysOf(info: ConlocaJson): BranchDeploys | undefined {
  const value: unknown = Reflect.get(info, 'branchDeploys');
  if (!isRecord(value) || value.host !== 'cloudflare-pages') return undefined;
  const { project } = value;
  return typeof project === 'string' && PAGES_PROJECT_RE.test(project)
    ? { host: 'cloudflare-pages', project }
    : undefined;
}

export const CONTENT_PATHS_MAX = 16;

/** '' (the repository root) or a relative path of plain segments, at most 255 characters. */
function isContentPath(path: unknown): path is string {
  if (path === '') return true;
  if (typeof path !== 'string' || path.length > 255 || path.includes('\\')) return false;
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/**
 * conloca.json `contentPaths`: repository paths the site's content lives under, duplicates removed;
 * `undefined` when absent or malformed, so a bad optional field never makes the page invalid.
 */
export function contentPathsOf(info: ConlocaJson): string[] | undefined {
  const value: unknown = Reflect.get(info, 'contentPaths');
  if (!Array.isArray(value) || value.length === 0 || value.length > CONTENT_PATHS_MAX) return undefined;
  if (!value.every(isContentPath)) return undefined;
  return [...new Set<string>(value)];
}

// `~^:?*[\`, `..`, `@{` and `//` anywhere (`git check-ref-format`); space and control characters are checked apart.
const BRANCH_FORBIDDEN_RE = /[~^:?*[\\]|\.\.|@\{|\/\//;

/** Git's ref-name rules for one branch name, at most 255 characters. */
export function isValidBranchName(name: string): boolean {
  if (name === '' || name.length > 255 || name === '@' || BRANCH_FORBIDDEN_RE.test(name)) return false;
  for (let index = 0; index < name.length; index++) {
    const code = name.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f) return false;
  }
  if (name.startsWith('-') || name.startsWith('/') || name.endsWith('/') || name.endsWith('.')) return false;
  return name.split('/').every((segment) => !segment.startsWith('.') && !segment.endsWith('.lock'));
}

/** Shape and field formats of a parsed conloca.json; null allowed where the type allows it. */
export function isEditorPageInfo(value: unknown): value is EditorPageInfo {
  if (!isRecord(value)) return false;
  const { protocol, repo, siteId, commit, branch, builtWith, componentManifest } = value;
  const formats = EDITOR_PAGE_INFO_FORMATS;
  return (
    typeof protocol === 'number' &&
    Number.isSafeInteger(protocol) &&
    (repo === null || (typeof repo === 'string' && formats.repo.test(repo))) &&
    typeof siteId === 'string' &&
    formats.siteId.test(siteId) &&
    (commit === null || (typeof commit === 'string' && formats.commit.test(commit))) &&
    (branch === null || (typeof branch === 'string' && isValidBranchName(branch))) &&
    typeof builtWith === 'string' &&
    formats.builtWith.test(builtWith) &&
    (componentManifest === null ||
      (isRecord(componentManifest) &&
        typeof componentManifest.path === 'string' &&
        formats.manifestPath.test(componentManifest.path) &&
        typeof componentManifest.sha256 === 'string' &&
        formats.sha256.test(componentManifest.sha256)))
  );
}

/** True when `location` is an absolute URL on vercel.com or a subdomain (Vercel's sign-in redirect). */
export function isVercelSignIn(location: string | null): boolean {
  if (location === null) return false;
  let host: string;
  try {
    host = new URL(location).hostname;
  } catch {
    return false;
  }
  return host === 'vercel.com' || host.endsWith('.vercel.com');
}

/** Any Vercel signal on an answer: an `x-vercel-*` header or a sign-in redirect. Feeds the classifier's `vercel`. */
export function isFromVercel(headers: Headers): boolean {
  for (const [name] of headers) if (name.startsWith('x-vercel-')) return true;
  return isVercelSignIn(headers.get('location'));
}

/** What one conloca.json answer means; `info` is the parsed file once it passed the format checks. */
export interface EditorHostVerdict {
  status: EditorHostStatus;
  reason?: 'repo-missing';
  info?: EditorPageInfo;
}

/**
 * One conloca.json answer → status; body is null when not read (non-200 or over the cap).
 * `vercel` (any Vercel signal) only picks the caller's message: an ordinary redirect on Vercel stays `invalid`.
 */
export function classifyEditorHostResponse(
  response: {
    status: number;
    contentType: string | null;
    location: string | null;
    vercel: boolean;
    body: string | null;
  },
  expected: { repoUri: string; siteId: string; protocols: { min: number; max: number } },
): EditorHostVerdict {
  const { status, contentType, body } = response;
  if (status >= 500 || status === 429) return { status: 'unreachable' };
  if (status === 401 || status === 403) return { status: 'protected' };
  if (status === 404) return { status: 'not-found' };
  if (status >= 300 && status < 400) return { status: isVercelSignIn(response.location) ? 'protected' : 'invalid' };
  if (status !== 200) return { status: 'invalid' };
  // A host serving its HTML fallback for unknown paths.
  if (contentType?.split(';')[0]?.trim().toLowerCase() === 'text/html') return { status: 'not-found' };
  if (body === null) return { status: 'invalid' };
  if (body.trimStart().startsWith('<')) return { status: 'not-found' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { status: 'invalid' };
  }
  if (!isEditorPageInfo(parsed)) return { status: 'invalid' };
  const info = parsed;
  if (info.protocol < expected.protocols.min || info.protocol > expected.protocols.max) {
    return { status: 'unsupported-protocol', info };
  }
  if (info.repo === null) return { status: 'wrong-repo', reason: 'repo-missing', info };
  if (info.repo.toLowerCase() !== expected.repoUri.toLowerCase()) return { status: 'wrong-repo', info };
  if (info.siteId !== expected.siteId) return { status: 'wrong-site', info };
  return { status: 'ready', info };
}

/** A CSP source expression compared as a token: case-insensitive, without a trailing `/`. */
function sourceToken(source: string): string {
  return source.toLowerCase().replace(/\/$/, '');
}

/**
 * Frame headers of the page → whether a workspace parent may frame it. `allowedAncestors` are the source expressions
 * that admit the workspace; `*` and `https:` always do. A `frame-ancestors` directive overrides X-Frame-Options.
 * shortcut: sources match as exact tokens, so a broader host wildcard (`https://*.com`) reads as blocked; parse
 * host patterns if a real site needs one.
 */
export function classifyFrameHeaders(
  headers: { xFrameOptions: string | null; csp: string | null },
  allowedAncestors: readonly string[],
): 'ok' | 'frame-blocked' {
  const admitting = new Set(['*', 'https:', ...allowedAncestors.map(sourceToken)]);
  // A combined header joins policies with commas; every policy is enforced on its own, by its first frame-ancestors.
  const ancestorLists = (headers.csp ?? '').split(',').flatMap((policy) => {
    const directive = policy
      .split(';')
      .map((part) => part.trim().split(/\s+/))
      .find(([name]) => name?.toLowerCase() === 'frame-ancestors');
    return directive ? [directive.slice(1)] : [];
  });
  if (ancestorLists.length > 0) {
    return ancestorLists.every((sources) => sources.some((source) => admitting.has(sourceToken(source))))
      ? 'ok'
      : 'frame-blocked';
  }
  const xfo = new Set((headers.xFrameOptions ?? '').split(',').map((value) => value.trim().toLowerCase()));
  return xfo.has('deny') || xfo.has('sameorigin') ? 'frame-blocked' : 'ok';
}
