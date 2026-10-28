import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SITE_ID_RE } from '@conloca/content-api/editor-host';
import { PACKAGE_NAME } from './constants.js';

/**
 * Resolve the build's deployable-site id. STRICT: malformed input fails the
 * build — a silent mis-attach is the same "deployed, but the editor points at
 * the wrong content" miss, only at a different address. A cleanly-parsed
 * sites.json without a top-level siteId is the zero-config repo: implicit
 * 'default'.
 */
export function resolveBuildSiteId(opts: {
  /** process.env.CONLOCA_CONTENT_ROOT — the channel conlocaCMS already publishes. */
  contentRoot: string | undefined;
  /** options.siteId — advanced override for CMS-less builds. */
  override: string | undefined;
  /** Seam for tests; defaults to a utf8 readFileSync. */
  readFile?: (path: string) => string;
}): string {
  const read = opts.readFile ?? ((p: string) => readFileSync(p, 'utf8'));

  if (opts.contentRoot === undefined || opts.contentRoot === '') {
    // CMS channel absent — the override stands alone (a CMS-less build).
    if (opts.override === undefined) {
      throw new Error(
        `${PACKAGE_NAME}: cannot determine siteId — CONLOCA_CONTENT_ROOT is not set ` +
          '(is conlocaCMS installed?) and no siteId override is configured',
      );
    }
    assertSlug(opts.override, 'siteId override');
    return opts.override;
  }

  const path = join(opts.contentRoot, 'sites.json');
  let raw: string;
  try {
    raw = read(path);
  } catch {
    throw new Error(`${PACKAGE_NAME}: missing ${path} — the CMS content root must carry its sites.json`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${PACKAGE_NAME}: could not parse ${path} as JSON`);
  }
  const record = parsed as Record<string, unknown> | null;
  if (
    record === null ||
    typeof record !== 'object' ||
    record.sites === null ||
    typeof record.sites !== 'object' ||
    Array.isArray(record.sites)
  ) {
    throw new Error(`${PACKAGE_NAME}: ${path} has no "sites" object — refusing to build on a broken content model`);
  }

  let resolved: string;
  if ('siteId' in record) {
    if (typeof record.siteId !== 'string' || !SITE_ID_RE.test(record.siteId)) {
      throw new Error(`${PACKAGE_NAME}: invalid top-level siteId in ${path} (want ${SITE_ID_RE})`);
    }
    resolved = record.siteId;
  } else {
    resolved = 'default'; // zero-config repo — soft path, never a build failure
  }

  // The env channel is authoritative: an override that DIFFERS from either the
  // explicit id or the implicit default fails the build, never picks silently.
  if (opts.override !== undefined && opts.override !== resolved) {
    throw new Error(
      `${PACKAGE_NAME}: siteId override "${opts.override}" contradicts ${path} (resolved "${resolved}") — ` +
        'remove the override or fix sites.json',
    );
  }
  return resolved;
}

function assertSlug(value: string, label: string): void {
  if (!SITE_ID_RE.test(value)) {
    throw new Error(`${PACKAGE_NAME}: ${label} "${value}" is not a valid site slug (${SITE_ID_RE})`);
  }
}
