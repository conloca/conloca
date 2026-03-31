import { beforeEach, describe, expect, test } from 'bun:test';
import type { LocalizedEntry } from '@conloca/content-api-client';
import { MDXContent } from '../src/components/puck/MDXContent';
import { renderWithProviders, screen, setupTestAPI } from './test-utils';

function createBlockEntry(mdx: string, etag = 'etag-1'): LocalizedEntry {
  return {
    id: 'block-1',
    kind: 'block',
    type: 'mdx',
    collection: 'heroes',
    localized: {
      locale: 'en',
      etag,
      created: '2026-03-31T00:00:00.000Z',
      modified: '2026-03-31T00:00:00.000Z',
      name: 'hero-block',
      meta: {
        title: 'Hero Block',
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

  test('renders compiled MDX content through the API client', async () => {
    renderWithProviders(<MDXContent entry={createBlockEntry('# Hello block')} />, undefined, false);

    expect(await screen.findByRole('heading', { name: 'Hello block' })).toBeTruthy();
  });

  test('shows a friendly error when MDX compilation fails', async () => {
    renderWithProviders(<MDXContent entry={createBlockEntry('# Broken {', 'etag-2')} />, undefined, false);

    expect(await screen.findByText('Cannot Render Block Content')).toBeTruthy();
    expect(
      await screen.findByText(
        'The block content contains invalid MDX syntax. Please edit the block to fix any syntax errors.',
      ),
    ).toBeTruthy();
  });
});
