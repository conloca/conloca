import type { Meta, StoryObj } from '@storybook/react-vite';
import '../main.css';
import { expect, waitFor, within } from 'storybook/test';
import { Toaster, toast } from './toast.js';

/** A page with a control in its top-right corner, where an app keeps its account menu. */
function ToastHarness() {
  return (
    <>
      <header style={{ display: 'flex', justifyContent: 'flex-end', padding: 8 }}>
        <button type="button">Account</button>
      </header>
      <Toaster />
    </>
  );
}

const meta = {
  title: 'Primitives/Toast',
  component: ToastHarness,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ToastHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

interface ToastCase {
  message: string;
  description?: string;
  action?: string;
}

/** Shows the toast and checks it reads at the toast's width, stays a few lines tall and leaves the header clickable. */
function readableToast({ message, description, action }: ToastCase): Story['play'] {
  return async ({ canvasElement }) => {
    toast.dismiss();
    toast.error(message, {
      description,
      duration: Number.POSITIVE_INFINITY,
      ...(action === undefined ? {} : { action: { label: action, onClick: () => undefined } }),
    });
    const item = (await within(document.body).findByText(message)).closest<HTMLElement>('[data-sonner-toast]');
    if (item === null) throw new Error('The message is not inside a toast');
    await waitFor(() => expect(item.dataset.mounted).toBe('true'));
    await waitFor(() => expect(item.getAnimations()).toHaveLength(0));

    const box = item.getBoundingClientRect();
    const content = item.querySelector('[data-content]')?.getBoundingClientRect();
    await expect(content?.width).toBeGreaterThan(box.width / 2);
    await expect(box.height).toBeLessThan(200);
    const buttonRights = [...item.querySelectorAll('[data-button]')].map(
      (button) => button.getBoundingClientRect().right,
    );
    await expect(Math.max(box.left, ...buttonRights)).toBeLessThanOrEqual(box.right);

    const account = within(canvasElement).getByRole('button', { name: 'Account' });
    const at = account.getBoundingClientRect();
    await expect(document.elementFromPoint(at.x + at.width / 2, at.y + at.height / 2)).toBe(account);
  };
}

export const LongActionLabel: Story = {
  play: readableToast({
    message:
      'Changes this device may hold from before could not be read. They stay there; reload the page to try again.',
    action: "Continue without the open page's unsaved changes",
  }),
};

export const ShortActionLabel: Story = {
  play: readableToast({
    message: 'A new version is out. Reload to keep editing with the latest version.',
    action: 'Reload',
  }),
};

export const LongDescription: Story = {
  play: readableToast({
    message: "Couldn't create the link",
    description:
      'The server refused the request because the link would outlive the access it shares. Pick an earlier expiry date and try again.',
  }),
};
