import { ContentAPIClient, setContentAPIClient } from '@conloca/content-api-client';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import '../../main.css';
import { ThemeProvider } from '../../hooks/useTheme.js';
import { CreatePageFlow } from './CreatePageFlow.js';

/**
 * The create-page dialog as the Dashboard and the Pages list open it. The content API answers in
 * memory with `taken` for the one path the stories name, and `available` for every other.
 */

const TAKEN_PATH = '/about';

async function respond(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
  const available = url.searchParams.get('pathname') !== TAKEN_PATH;
  return new Response(JSON.stringify({ available }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function CreatePageFlowStory() {
  const [queryClient] = useState(() => {
    setContentAPIClient(new ContentAPIClient({ fetch: Object.assign(respond, { preconnect: fetch.preconnect }) }));
    return new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  });
  const [open, setOpen] = useState(true);
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MemoryRouter>
          <CreatePageFlow open={open} onOpenChange={setOpen} site="default" />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

const meta = {
  component: CreatePageFlow,
  parameters: { layout: 'fullscreen' },
  args: { open: true, onOpenChange: fn(), site: 'default' },
  render: () => <CreatePageFlowStory />,
} satisfies Meta<typeof CreatePageFlow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Typing a title makes the path from it, and Create unlocks once the content API says that path is free. */
export const TitleUnlocksCreate: Story = {
  play: async () => {
    const dialog = within(document.body);
    await userEvent.type(await dialog.findByTestId('page-title-input'), 'Team');
    await expect(dialog.getByTestId('page-path-input')).toHaveValue('/team');
    await waitFor(() => expect(dialog.getByTestId('create-page-submit')).toBeEnabled());
  },
};

/** A title whose path another page already has leaves Create locked. */
export const TakenPathKeepsCreateLocked: Story = {
  play: async () => {
    const dialog = within(document.body);
    await userEvent.type(await dialog.findByTestId('page-title-input'), 'About');
    await expect(dialog.getByTestId('page-path-input')).toHaveValue(TAKEN_PATH);
    await expect(await dialog.findByText('This pathname is already in use')).toBeVisible();
    await expect(dialog.getByTestId('create-page-submit')).toBeDisabled();
  },
};
