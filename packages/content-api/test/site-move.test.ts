import { describe, expect, test } from 'bun:test';
import type { ContentAPI } from '../src/content-api.interface.js';
import { Site } from '../src/site.js';
import { SiteIndex } from '../src/site-index.js';
import type { UpdateResult } from '../src/types.js';

/**
 * A move is an update of the page's path, so a backend may refuse it with an
 * update's reasons. A move reports anything already taken as `already_exists`,
 * the one reason its callers handle, whether a page uses the path or
 * redirects from it.
 */
function siteWhoseUpdatesAnswer(refusal: UpdateResult): Site {
  const api = {
    getLocalized: async () => ({ localized: { meta: { title: 'Team' }, etag: 'etag-1', pathname: '/team' } }),
    updateLocalized: async () => refusal,
  } as unknown as ContentAPI;
  return new Site('shop', api, new SiteIndex(['en']));
}

describe('Site.move refused by the update', () => {
  test('reports a path another page uses or redirects from, or any taken name, as already_exists', async () => {
    for (const reason of ['pathname_taken', 'pathname_in_redirects', 'name_taken'] as const) {
      const error = new Error(`refused: ${reason}`);
      const site = siteWhoseUpdatesAnswer({ success: false, reason, error });

      expect(await site.move('page-team', 'en', '/about')).toEqual({ moved: false, reason: 'already_exists', error });
    }
  });

  test('reports a malformed name, which it never sends, as write_error', async () => {
    const error = new Error('Invalid fragment name: a/b');
    const site = siteWhoseUpdatesAnswer({ success: false, reason: 'invalid_name', error });

    expect(await site.move('page-team', 'en', '/about')).toEqual({ moved: false, reason: 'write_error', error });
  });

  test('passes any other refusal through', async () => {
    const site = siteWhoseUpdatesAnswer({ success: false, reason: 'invalid_pathname' });

    expect(await site.move('page-team', 'en', '/About')).toEqual({ moved: false, reason: 'invalid_pathname' });
  });
});
