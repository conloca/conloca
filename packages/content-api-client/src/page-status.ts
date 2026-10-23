import { type ContentManifest, isContentPublished, type LocaleVersion, localesOf } from '@conloca/content-api';

/** What a page list tells an editor about a page's presence on the site. */
export type PageStatus = 'published' | 'draft' | 'scheduled';

function statusOfVersion(version: LocaleVersion, now: Date): PageStatus {
  if (isContentPublished(version, now)) return 'published';
  const publishAt = version.publishAt ? new Date(version.publishAt) : null;
  return publishAt && publishAt > now ? 'scheduled' : 'draft';
}

/**
 * The status the CMS shows for a page. A locale that was never published
 * (`unpublished`) takes no part in it, so a new translation cannot turn a live
 * page into a draft; a page whose every locale was never published is a draft.
 * Of the rest, one locale that is live makes the page published, else one that
 * is scheduled makes it scheduled, else it is a draft, whatever order the
 * locales come in. A page with no locale versions defaults to published.
 * The Pages list badge, its Status filter and the Dashboard activity dots all
 * ask this, so one page never reads differently on two screens.
 */
export function pageStatusOf(page: Pick<ContentManifest, 'locales'>, now = new Date()): PageStatus {
  const versions = Array.from(localesOf(page));
  if (versions.length === 0) return 'published';
  const statuses = new Set(
    versions.filter((version) => !version.unpublished).map((version) => statusOfVersion(version, now)),
  );
  if (statuses.has('published')) return 'published';
  return statuses.has('scheduled') ? 'scheduled' : 'draft';
}
