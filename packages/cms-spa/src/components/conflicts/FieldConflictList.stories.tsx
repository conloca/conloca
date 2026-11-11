import type { Config } from '@puckeditor/core';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import '../../main.css';
import { FieldConflictList } from './FieldConflictList.js';

const config: Config = {
  components: {
    Hero: { label: 'Hero', fields: { title: { type: 'text', label: 'Hero title' } }, render: () => <div /> },
  },
  root: { fields: { seoTitle: { type: 'text', label: 'SEO title' } } },
};

/** Every field on a page waiting for a decision, labelled from the site's config. */
const meta = {
  component: FieldConflictList,
  args: {
    conflicts: [
      { anchor: 'content[id=hero-1].props.title', base: 'Sale', ours: 'Spring sale', theirs: 'Summer sale' },
      { anchor: 'root.props.seoTitle', base: 'Shop', ours: 'Spring shop', theirs: 'Summer shop' },
    ],
    data: {
      root: { props: { seoTitle: 'Spring shop' } },
      content: [{ type: 'Hero', props: { id: 'hero-1', title: 'Spring sale' } }],
    },
    config,
    sourceLabel: () => 'from GitHub',
    theirsBy: () => 'Ben',
    onPick: fn(),
  },
} satisfies Meta<typeof FieldConflictList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The count is announced; a pick names its anchor, and only the picker being sent waits. */
export const ListAnnouncesCount: Story = {
  args: { pendingAnchor: 'root.props.seoTitle' },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('status')).toHaveTextContent('2 fields need a decision');
    const hero = canvas.getByRole('group', { name: 'Hero title on Hero, from GitHub' });
    const seo = canvas.getByRole('group', { name: 'SEO title, from GitHub' });
    await expect(seo).toHaveAttribute('aria-busy', 'true');
    await expect(within(seo).getByRole('button', { name: 'Keep mine' })).toBeDisabled();
    await expect(hero).not.toHaveAttribute('aria-busy');

    await userEvent.click(within(hero).getByRole('button', { name: "Use Ben's" }));
    await expect(args.onPick).toHaveBeenCalledWith('content[id=hero-1].props.title', 'theirs');
  },
};
