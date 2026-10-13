/// <reference lib="dom" />
/**
 * A page create the server refuses after the dialog said the path was free.
 *
 * The dialog closes as soon as Create is clicked, before the server answers.
 * The path can still be refused then: another tab or teammate took it between
 * the check and the click, or an existing page redirects from it. A remote
 * content-API route resolves that refusal as `{ success: false, reason }`
 * instead of throwing, and the page list used to report every one of them as
 * "Failed to create page. Please try again." — advice that can never work for
 * a taken path.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { type ContentAPIClient, getContentAPIClient } from '@conloca/content-api-client';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { PageList } from '../src/components/pages/PageList.js';
import { renderWithProviders, testApi } from './test-utils.js';

type CreateResult = Awaited<ReturnType<ContentAPIClient['createContent']>>;

let restoreCreateContent: (() => void) | undefined;

afterEach(() => {
  cleanup();
  testApi?.clear();
  restoreCreateContent?.();
  restoreCreateContent = undefined;
});

/** The shared test client resolves every create with `refusal`, as a remote route does. */
function refuseCreates(refusal: CreateResult) {
  const client = getContentAPIClient();
  const originalCreateContent = client.createContent.bind(client);
  client.createContent = async () => refusal;
  restoreCreateContent = () => {
    client.createContent = originalCreateContent;
  };
}

/** Create a page titled `title`; `afterCheck` runs once the dialog found its path free, before Create is clicked. */
async function createPageTitled(title: string, afterCheck?: () => Promise<unknown>) {
  fireEvent.click(await screen.findByTestId('new-page-button'));
  fireEvent.change(await screen.findByTestId('page-title-input'), { target: { value: title } });
  // Create waits for the path check; a plain boolean keeps each poll cheap.
  await waitFor(() => {
    expect((screen.getByTestId('create-page-submit') as HTMLButtonElement).disabled).toBe(false);
  });
  await afterCheck?.();
  fireEvent.click(screen.getByTestId('create-page-submit'));
}

describe('a page create the server refuses', () => {
  test('says the path is taken instead of asking the author to try again', async () => {
    renderWithProviders(<PageList />);
    refuseCreates({
      success: false,
      reason: 'pathname_taken',
      error: new Error('Pathname /team already exists'),
      existingId: 'vx-teammate',
    });

    await createPageTitled('Team');

    expect(await screen.findByText('That pathname is already in use. Please choose a different one.')).toBeDefined();
    expect(screen.queryByText('Failed to create page. Please try again.')).toBeNull();
  });

  test('says the path redirects to another page', async () => {
    renderWithProviders(<PageList />);
    refuseCreates({
      success: false,
      reason: 'pathname_in_redirects',
      error: new Error('Pathname /team is a redirect target'),
    });

    await createPageTitled('Team');

    expect(
      await screen.findByText('That pathname redirects to another page. Please choose a different one.'),
    ).toBeDefined();
  });
});

/**
 * The content-API router answers the same refusal with an error status, which the client throws.
 * The page list caught it as any other failure and said "Failed to create page. Please try again."
 */
describe('a page create the content-API router refuses', () => {
  test("says why, in the route's words", async () => {
    renderWithProviders(<PageList />);

    // A teammate creates '/team' after the dialog found it free.
    await createPageTitled('Team', () =>
      testApi.createContent({
        kind: 'page',
        site: 'default',
        collection: 'pages',
        type: 'puck',
        meta: { title: 'Team' },
        locales: {
          en: { pathname: '/team', meta: { title: 'Team' }, content: { puckData: { content: [], root: {} } } },
        },
      }),
    );

    expect(await screen.findByText('Pathname /team already exists')).toBeDefined();
    expect(screen.queryByText('Failed to create page. Please try again.')).toBeNull();
  });
});
