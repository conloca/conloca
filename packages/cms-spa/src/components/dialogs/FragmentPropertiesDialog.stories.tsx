import type { FieldConflict } from '@conloca/content-api';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import '../../main.css';
import { ApplyClashError } from '../../utils/apply-clash.js';
import { FragmentPropertiesDialog } from './FragmentPropertiesDialog.js';

const TITLE_CLASH: FieldConflict = {
  anchor: 'meta.title',
  base: 'Pricing',
  ours: 'Plans',
  theirs: 'Pricing for teams',
};

/** A fragment's properties; Save hands them to the list, which writes them. */
const meta = {
  component: FragmentPropertiesDialog,
  args: {
    isOpen: true,
    fragmentTitle: 'Pricing',
    currentMeta: { title: 'Pricing' },
    onCancel: fn(),
    onSave: fn(async () => {
      throw new ApplyClashError([TITLE_CLASH], 'Maria');
    }),
  },
} satisfies Meta<typeof FragmentPropertiesDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A clash on the title loads the other value into the field, says so, and keeps the dialog open for another Save. */
export const ClashReloadsField: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const title = canvas.getByRole('textbox', { name: /^Title/ });
    await userEvent.clear(title);
    await userEvent.type(title, 'Plans');
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }));
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'Title changed while you were editing (last edited by Maria). Check it and apply again.',
    );
    await expect(title).toHaveValue('Pricing for teams');
    await expect(canvas.getByRole('dialog')).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(args.onSave).toHaveBeenCalledTimes(2));
    await expect(args.onSave).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Pricing for teams' }));
  },
};
