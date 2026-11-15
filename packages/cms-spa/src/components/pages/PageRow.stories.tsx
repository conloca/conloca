import type { Meta, StoryObj } from '@storybook/react-vite';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, fn, spyOn, userEvent, waitFor, within } from 'storybook/test';
import '../../main.css';
import type { Page } from '../../types.js';
import { PageRow } from './PageRow.js';

/** Storybook mounts PageRow inside its table and router; action clicks must stay on the list. */
const page: Page = {
  id: 'home',
  title: 'Home',
  path: '/home',
  type: 'mdx',
  status: 'published',
  modified: new Date('2026-01-10T09:00:00.000Z'),
  locales: ['en'],
};

const meta = {
  component: PageRow,
  args: { page, selectedLocale: 'en', isMultiLocale: false, onPreview: fn(), onDelete: fn() },
  decorators: [
    (Story) => (
      <MemoryRouter initialEntries={['/pages']}>
        <Routes>
          <Route
            path="/pages"
            element={
              <table>
                <tbody>
                  <Story />
                </tbody>
              </table>
            }
          />
          <Route path="/pages/:id" element={<h1>Page editor</h1>} />
        </Routes>
      </MemoryRouter>
    ),
  ],
} satisfies Meta<typeof PageRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OpensEditor: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText('MDX page')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Home' }));
    await expect(canvas.getByRole('heading', { name: 'Page editor' })).toBeVisible();
  },
};

export const PreviewStaysOnList: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Preview Home' }));
    await expect(args.onPreview).toHaveBeenCalledTimes(1);
    await expect(args.onPreview).toHaveBeenCalledWith('/home');
    await expect(args.onDelete).not.toHaveBeenCalled();
    await expect(canvas.getByRole('button', { name: 'Home' })).toBeVisible();
    await expect(canvas.queryByRole('heading', { name: 'Page editor' })).not.toBeInTheDocument();
  },
};

export const DeleteOneLocale: Story = {
  args: { page: { ...page, locales: ['en', 'nl'] }, selectedLocale: 'all', isMultiLocale: true },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByTestId('locale-indicator').map((label) => label.textContent)).toEqual(['en', 'nl']);
    await userEvent.click(canvas.getByTestId('page-actions-home'));
    const body = within(document.body);
    await expect((await body.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual([
      'Delete',
      'Delete en version',
      'Delete nl version',
    ]);
    await userEvent.click(body.getByRole('menuitem', { name: 'Delete nl version' }));
    await expect(args.onDelete).toHaveBeenCalledTimes(1);
    await expect(args.onDelete).toHaveBeenCalledWith('home', 'nl');
    await expect(args.onPreview).not.toHaveBeenCalled();
    await expect(canvas.getByRole('button', { name: 'Home' })).toBeVisible();
  },
};

/** The external cross-origin fixture clicks this row with the browser's real clipboard API. */
export const ClipboardBoundary: Story = {};

export const CopyFeedbackExpiresAndRepeats: Story = {
  beforeEach: () => {
    const copy = spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    return () => copy.mockRestore();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const copy = canvas.getByRole('button', { name: 'Copy path for Home' });
    await userEvent.click(copy);
    await expect(await canvas.findByRole('status')).toHaveTextContent('Copied page path.');
    await waitFor(() => expect(canvas.getByRole('status')).toBeEmptyDOMElement(), { timeout: 3000 });
    await expect(copy).toHaveAttribute('title', 'Copy path');
    await userEvent.click(copy);
    await expect(await canvas.findByRole('status')).toHaveTextContent('Copied page path.');
    await expect(canvas.getByRole('button', { name: /^Home$/ })).toBeVisible();
  },
};

export const CopyFailureVisible: Story = {
  beforeEach: () => {
    const copy = spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Clipboard refused'));
    return () => copy.mockRestore();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const copy = canvas.getByRole('button', { name: 'Copy path for Home' });
    await userEvent.click(copy);
    await expect(canvas.getByRole('status')).toHaveTextContent('Could not copy the path. Try again.');
    await expect(within(copy).getByLabelText('Copy failed')).toBeVisible();
    await expect(copy).toHaveAccessibleName('Copy path for Home');
    await expect(canvas.getByRole('button', { name: 'Home' })).toBeVisible();
  },
};

export const CopyFailureVisiblePhone: Story = {
  ...CopyFailureVisible,
  globals: { viewport: { value: 'mobile1', isRotated: false } },
};

export const CopyPendingKeyboardFocus: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    let complete: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const write = spyOn(navigator.clipboard, 'writeText').mockReturnValueOnce(pending).mockResolvedValue(undefined);
    try {
      const copy = canvas.getByRole('button', { name: 'Copy path for Home' });
      await userEvent.tab();
      await userEvent.tab();
      await userEvent.tab();
      await expect(copy).toHaveFocus();
      await userEvent.keyboard('{Enter}');
      await expect(copy).toHaveAttribute('aria-disabled', 'true');
      await expect(copy).not.toBeDisabled();
      await expect(copy).toHaveFocus();
      await userEvent.keyboard('{Enter}');
      await expect(write).toHaveBeenCalledTimes(1);
      const status = canvas.getByRole('status');
      await expect(status).toBeEmptyDOMElement();
      complete?.();
      await waitFor(() => expect(status).toHaveTextContent('Copied page path.'));
      await expect(copy).toHaveFocus();
      await userEvent.keyboard('{Enter}');
      await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
      await expect(status).toHaveTextContent('Copied page path.');
      await expect(copy).toHaveFocus();
      await expect(args.onPreview).not.toHaveBeenCalled();
      await expect(args.onDelete).not.toHaveBeenCalled();
      await expect(canvas.getByRole('button', { name: 'Home' })).toBeVisible();
    } finally {
      complete?.();
      write.mockRestore();
    }
  },
};

export const CopyStatusMounted: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const copy = canvas.getByRole('button', { name: 'Copy path for Home' });
    const status = canvas.getByRole('status');
    await expect(status).toBeEmptyDOMElement();
    await expect(status).toHaveAttribute('aria-live', 'polite');
    await expect(status.parentElement).toBe(copy.parentElement);
    await expect(copy).not.toContainElement(status);
  },
};
