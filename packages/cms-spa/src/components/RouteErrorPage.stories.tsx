import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import '../main.css';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { expect, within } from 'storybook/test';
import { ThemeProvider } from '../hooks/useTheme.js';
import { RouteErrorPage } from './RouteErrorPage.js';

function BrokenScreen(): never {
  throw new Error("Cannot read properties of undefined (reading 'schema')");
}

/** The error page as the router renders it: through the `errorElement` of a route that failed. */
function ErrorPageHarness({ entry }: { entry: string }) {
  const [router] = useState(() =>
    createMemoryRouter([{ path: '/broken', element: <BrokenScreen />, errorElement: <RouteErrorPage /> }], {
      initialEntries: [entry],
    }),
  );
  return (
    <ThemeProvider>
      <div style={{ height: '100vh' }}>
        <RouterProvider router={router} />
      </div>
    </ThemeProvider>
  );
}

const meta = {
  title: 'Layout/RouteErrorPage',
  component: RouteErrorPage,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof RouteErrorPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ScreenFailedToRender: Story = {
  render: () => <ErrorPageHarness entry="/broken" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('heading', { name: 'Something went wrong' })).toBeVisible();
    await expect(canvas.getByText(/reading 'schema'/)).toBeInTheDocument();
    await expect(canvas.queryByText(/Unexpected Application Error/)).toBeNull();
  },
};

export const UnknownAddress: Story = {
  render: () => <ErrorPageHarness entry="/no-such-screen" />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole('heading', { name: 'Page not found' })).toBeVisible();
  },
};
