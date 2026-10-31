import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import '../../main.css';
import { MakePagesEditableDialog } from './MakePagesEditableDialog.js';

/**
 * The picker that turns chosen Astro routes into a prompt for a coding agent.
 * The boundary is the `offer` prop the empty page list passes: the site's facts
 * and the routes not converted yet.
 */

const meta = {
  component: MakePagesEditableDialog,
  args: {
    open: true,
    onOpenChange: fn(),
    offer: {
      facts: { cliVersion: '0.3.0', site: 'default', routes: ['/', '/pricing', '/about/team'] },
      collection: 'pages',
      candidates: ['/', '/pricing', '/about/team'],
    },
  },
  // The runner's browser has no clipboard permission; a stub keeps the copy deterministic.
  beforeEach: () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } });
    return () => {
      Reflect.deleteProperty(navigator, 'clipboard');
    };
  },
} satisfies Meta<typeof MakePagesEditableDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing is chosen at first; choosing a route names it in the prompt and lets it be copied. */
export const ChooseAndCopy: Story = {
  play: async ({ canvasElement }) => {
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole('dialog'));
    const pricing = dialog.getByRole('checkbox', { name: '/pricing' });
    await expect(pricing).not.toBeChecked();
    await expect(dialog.getByRole('button', { name: 'Copy prompt' })).toBeDisabled();
    await userEvent.click(pricing);
    await expect(dialog.getByRole<HTMLTextAreaElement>('textbox', { name: 'Prompt' }).value).toContain('"/pricing"');
    await userEvent.click(dialog.getByRole('button', { name: 'Copy prompt' }));
    await expect(await dialog.findByText('Copied')).toBeVisible();
  },
};
