/// <reference lib="dom" />
/**
 * A page-settings save whose new path the server refuses.
 *
 * The path the author typed may already belong to another page, or another
 * page may redirect from it. A remote content-API route resolves that refusal
 * as `{ success: false, reason }` with its message as plain text. The Puck
 * editor threw that text as it came, so the dialog fell back to "Saving
 * failed. Your changes are still here — try again.", advice that can never
 * work for a taken path; the MDX editor only showed the reason code. Both now
 * say why, as the page list does when a new page is refused.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { type ContentAPIClient, ErrorCodes, getContentAPIClient } from '@conloca/content-api-client';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { API_ROUTES, mockAPIError, renderAppWithDataRouter, setupTestAPI, testApi } from './test-utils.js';

type UpdateResult = Awaited<ReturnType<ContentAPIClient['updateLocalized']>>;

const TAKEN = 'That pathname is already in use. Please choose a different one.';
const REDIRECTS = 'That pathname redirects to another page. Please choose a different one.';

let restoreUpdateLocalized: (() => void) | undefined;

afterEach(() => {
  cleanup();
  testApi?.clear();
  restoreUpdateLocalized?.();
  restoreUpdateLocalized = undefined;
});

/** A refusal as a remote route resolves it: the message arrives as plain text, not an `Error`. */
function refusal(reason: UpdateResult['reason'], message: string): UpdateResult {
  return { success: false, reason, error: message as unknown as Error };
}

/** Open the page's settings with every update refused as `refused`, then press Save. */
async function saveRefusedSettings(type: 'puck' | 'mdx', refused: UpdateResult) {
  setupTestAPI();
  const created = await testApi.createContent({
    kind: 'page',
    site: 'default',
    collection: 'pages',
    type,
    meta: { title: 'Team' },
    locales: {
      en: {
        pathname: '/team',
        meta: { title: 'Team' },
        content: type === 'mdx' ? { mdx: 'Our team.' } : { puckData: { content: [], root: { props: {} } } },
      },
    },
  });
  // The shared test client is swapped for the refusal and restored in afterEach.
  const client = getContentAPIClient();
  const originalUpdateLocalized = client.updateLocalized.bind(client);
  client.updateLocalized = async () => refused;
  restoreUpdateLocalized = () => {
    client.updateLocalized = originalUpdateLocalized;
  };

  renderAppWithDataRouter([`/pages/${created.id}`], undefined, false);
  fireEvent.click(await screen.findByRole('button', { name: /page settings/i }));
  fireEvent.click(await screen.findByRole('button', { name: /^save$/i }));
}

describe('a page-settings save the server refuses for its path', () => {
  test('says the path is taken on a Puck page, in the dialog', async () => {
    await saveRefusedSettings('puck', refusal('pathname_taken', 'Pathname /about already exists'));

    expect((await screen.findByRole('alert')).textContent).toBe(TAKEN);
  });

  test('says the path redirects to another page on a Puck page', async () => {
    await saveRefusedSettings('puck', refusal('pathname_in_redirects', 'Pathname /about-us is a redirect target'));

    expect((await screen.findByRole('alert')).textContent).toBe(REDIRECTS);
  });

  test('says the path is taken on an MDX page', async () => {
    await saveRefusedSettings('mdx', refusal('pathname_taken', 'Pathname /about already exists'));

    await waitFor(() => expect(screen.getByText(TAKEN)).toBeDefined());
  });
});

/**
 * The content-API router answers the same refusal with an error status, which the client throws. The
 * Puck editor lets it reach the dialog, which shows its message; the MDX editor replaced it with
 * "Failed to save page settings", which says nothing about the path.
 */
describe('a page-settings save the content-API router refuses for its path', () => {
  /** Open the settings of a page at '/team', served by the content-API router; its id. */
  async function openTeamPageSettings(type: 'puck' | 'mdx'): Promise<string> {
    setupTestAPI();
    const created = await testApi.createContent({
      kind: 'page',
      site: 'default',
      collection: 'pages',
      type,
      meta: { title: 'Team' },
      locales: {
        en: {
          pathname: '/team',
          meta: { title: 'Team' },
          content: type === 'mdx' ? { mdx: 'Our team.' } : { puckData: { content: [], root: { props: {} } } },
        },
      },
    });
    const id = created.id ?? '';
    renderAppWithDataRouter([`/pages/${id}`], undefined, false);
    fireEvent.click(await screen.findByRole('button', { name: /page settings/i }));
    return id;
  }

  test('says why on an MDX page', async () => {
    const id = await openTeamPageSettings('mdx');
    const refused = 'Pathname /about already exists';
    mockAPIError(API_ROUTES.CONTENT_BY_ID(id), 409, ErrorCodes.PATHNAME_TAKEN, refused);

    fireEvent.click(await screen.findByRole('button', { name: /^save$/i }));

    expect(await screen.findByText(refused)).toBeDefined();
    expect(screen.queryByText('Failed to save page settings')).toBeNull();
  });

  for (const type of ['puck', 'mdx'] as const) {
    test(`says why a malformed path was refused on a ${type === 'mdx' ? 'MDX' : 'Puck'} page`, async () => {
      // The path names the page's file, so '/../escaped' would put it outside the content
      // folder. The route took it; it now refuses it as a create does.
      const id = await openTeamPageSettings(type);

      fireEvent.change(await screen.findByLabelText(/^Pathname/), { target: { value: '/../escaped' } });
      fireEvent.click(await screen.findByRole('button', { name: /^save$/i }));

      expect(
        await screen.findByText('Invalid pathname for locale en: Path cannot contain `.` or `..` segments'),
      ).toBeDefined();
      expect(testApi.getSite('default')?.getByPathname('/team', 'en')?.id).toBe(id);
    });
  }
});
