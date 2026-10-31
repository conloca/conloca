import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { expect, fn, within } from 'storybook/test';
import '../../main.css';
import { configureUI, getUIConfig } from '../../ui-config.js';
import { NoPagesYet } from './NoPagesYet.js';

/**
 * The empty page list. The boundary is `configureUI`: the page conversion facts
 * the workspace editor sends (with the site's routes) and whether the account
 * may write.
 */

function NoPagesYetStory({ onCreatePage }: { onCreatePage: () => void }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={queryClient}>
      <NoPagesYet onCreatePage={onCreatePage} />
    </QueryClientProvider>
  );
}

const meta = {
  component: NoPagesYet,
  args: { onCreatePage: fn() },
  parameters: { layout: 'fullscreen' },
  // The UI config is module state shared with every other story in the same
  // Storybook preview, so put back whatever was installed rather than defaults.
  beforeEach: () => {
    const previous = getUIConfig();
    configureUI({
      ...previous,
      hosted: true,
      readOnly: undefined,
      pageConversion: { cliVersion: '0.3.0', site: 'default', routes: ['/', '/pricing', '/about/team'] },
    });
    return () => configureUI(previous);
  },
  render: (args) => <NoPagesYetStory onCreatePage={args.onCreatePage} />,
} satisfies Meta<typeof NoPagesYet>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A site whose pages are all still Astro files offers to convert one or to create one. */
export const WithAstroPages: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'No Conloca pages yet' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Make an existing page editable' })).toBeEnabled();
    await expect(canvas.getByRole('button', { name: 'Create a new page' })).toBeEnabled();
  },
};
