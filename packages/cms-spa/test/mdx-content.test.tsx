import { beforeEach, describe, expect, test } from 'bun:test';
import type { LocalizedEntry } from '@conloca/content-api-client';
import { MDXContent } from '../src/components/puck/MDXContent.js';
import { renderWithProviders, screen, setupTestAPI } from './test-utils.js';

function createFragmentEntry(mdx: string, etag = 'etag-1'): LocalizedEntry {
  return {
    id: 'fragment-1',
    kind: 'fragment',
    type: 'mdx',
    collection: 'heroes',
    localized: {
      locale: 'en',
      etag,
      created: '2026-03-31T00:00:00.000Z',
      modified: '2026-03-31T00:00:00.000Z',
      name: 'hero-fragment',
      meta: {
        title: 'Hero Fragment',
      },
      content: {
        mdx,
      },
    },
  };
}

describe('MDXContent', () => {
  beforeEach(() => {
    setupTestAPI();
  });

  test('delivers compiled MDX to an isolated sandbox, never mounting it in this document', async () => {
    renderWithProviders(<MDXContent entry={createFragmentEntry('# Hello fragment')} />, undefined, false);

    // The MDX renders in a sandboxed iframe, so the heading is NOT in the
    // privileged document tree — the isolation boundary is what we assert.
    const frame = (await screen.findByTitle('Sandboxed content preview')) as HTMLIFrameElement;
    expect(frame.tagName).toBe('IFRAME');
    const sandbox = frame.getAttribute('sandbox') ?? '';
    expect(sandbox).toBe('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin');
    expect(screen.queryByRole('heading', { name: 'Hello fragment' })).toBeNull();
  });

  test('shows a friendly error when MDX compilation fails', async () => {
    renderWithProviders(<MDXContent entry={createFragmentEntry('# Broken {', 'etag-2')} />, undefined, false);

    expect(await screen.findByText('Cannot Render Fragment Content')).toBeTruthy();
    expect(
      await screen.findByText("This fragment's MDX could not be compiled. Edit the fragment to fix the syntax."),
    ).toBeTruthy();
  });

  test('does not blame MDX syntax for compile service failures', async () => {
    const { fragmentRenderErrorHelper } = await import('../src/components/puck/MDXContent.js');
    expect(fragmentRenderErrorHelper(new Error('API error: 405 Method Not Allowed'), true)).toMatch(/compile service/i);
    expect(fragmentRenderErrorHelper(new Error('API error: 405 Method Not Allowed'), true)).not.toMatch(/syntax/i);
  });
});
