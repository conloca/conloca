import { type AssetUsage, ContentAPIClient, setContentAPIClient } from '@conloca/content-api-client';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, fn, waitFor, within } from 'storybook/test';
import '../../main.css';
import { AssetUsageList } from './AssetUsageList.js';

/**
 * The pages linking an image, listed in the move and delete dialogs before the person confirms. The content-API client
 * answers the usage of each path in memory.
 */

const USAGE = new Map<string, AssetUsage[]>([
  [
    'library/team.png',
    [
      { page: '/about (en)', field: 'content.mdx' },
      { page: '/team (en)', field: 'meta.featuredImage' },
    ],
  ],
]);

class UsageClient extends ContentAPIClient {
  override async getAssetUsage(path: string): Promise<AssetUsage[]> {
    return USAGE.get(path) ?? [];
  }
}

const meta = {
  component: AssetUsageList,
  args: { paths: ['library/team.png'], onSettled: fn() },
  decorators: [
    (Story) => {
      setContentAPIClient(new UsageClient({}));
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
      });
      return (
        <QueryClientProvider client={queryClient}>
          <Story />
        </QueryClientProvider>
      );
    },
  ],
} satisfies Meta<typeof AssetUsageList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Both pages are listed with the field that links the image, and the caller learns the list is complete. */
export const UsedByTwoPages: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('/about (en)')).toBeVisible();
    await expect(canvas.getByText('/team (en)')).toBeVisible();
    await expect(canvas.getByText(/Their links are not changed/)).toBeVisible();
    // The settled report is a passive effect, flushed after the commit that shows the rows.
    await waitFor(() => expect(args.onSettled).toHaveBeenLastCalledWith(true));
  },
};
