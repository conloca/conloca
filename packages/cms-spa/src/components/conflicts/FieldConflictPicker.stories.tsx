import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import '../../main.css';
import { FieldConflictPicker } from './FieldConflictPicker.js';

/**
 * One field two people changed differently, with the person's choices: keep theirs, take the other value, or type a
 * new one. Driven by keyboard and read by role and name, as a screen reader would.
 */
const meta = {
  component: FieldConflictPicker,
  args: {
    conflict: { anchor: 'content[id=hero-1].props.title', base: 'Sale', ours: 'Spring sale', theirs: 'Summer sale' },
    label: { component: 'Hero', field: 'Hero title' },
    sourceLabel: 'from GitHub',
    theirsBy: 'Ben',
    onPick: fn(),
  },
} satisfies Meta<typeof FieldConflictPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Both values, three choices in order; the keyboard reaches Keep mine first, and Edit settles on a typed value. */
export const ChangedOnGitHub: Story = {
  play: async ({ args, canvasElement }) => {
    const group = within(canvasElement).getByRole('group', { name: 'Hero title on Hero, from GitHub' });
    await expect(group).toHaveTextContent('Your value: Spring sale');
    await expect(group).toHaveTextContent("Ben's value: Summer sale");
    const buttons = within(group).getAllByRole('button');
    await expect(buttons.map((button) => button.textContent)).toEqual(['Keep mine', "Use Ben's", 'Edit']);

    await userEvent.tab();
    await expect(within(group).getByRole('button', { name: 'Keep mine' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect(args.onPick).toHaveBeenCalledWith('mine');

    await userEvent.click(within(group).getByRole('button', { name: 'Edit' }));
    const box = within(group).getByRole('textbox', { name: 'New value for Hero title' });
    await expect(box).toHaveValue('Summer sale');
    await expect(box).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await expect(within(group).queryByRole('textbox')).toBeNull();
    await expect(args.onPick).toHaveBeenCalledTimes(1);

    await userEvent.click(within(group).getByRole('button', { name: 'Edit' }));
    await userEvent.keyboard('!');
    await userEvent.click(within(group).getByRole('button', { name: 'Save value' }));
    await expect(args.onPick).toHaveBeenLastCalledWith({ kind: 'value', value: 'Summer sale!' });
  },
};

/** Without an author the other value is "theirs". */
export const NoAuthor: Story = {
  args: { theirsBy: undefined },
  play: async ({ canvasElement }) => {
    const group = within(canvasElement).getByRole('group', { name: 'Hero title on Hero, from GitHub' });
    await expect(within(group).getByRole('button', { name: 'Use theirs' })).toBeVisible();
    await expect(group).toHaveTextContent('Their value: Summer sale');
  },
};

/** An id-less list is one value: both sides read as lists of their items, the one choice covers the whole list. */
export const ObjectValues: Story = {
  args: {
    conflict: {
      anchor: 'content[id=hero-1].props.buttons',
      base: [{ label: 'Buy', href: '/buy' }],
      ours: [{ label: 'Buy now', href: '/buy' }],
      theirs: [
        { label: 'Buy', href: '/shop' },
        { label: 'Learn more', href: '/about' },
      ],
    },
    label: { component: 'Hero', field: 'Buttons' },
  },
  play: async ({ canvasElement }) => {
    const group = within(canvasElement).getByRole('group', { name: 'Buttons on Hero, from GitHub' });
    const lists = within(group).getAllByRole('list');
    await expect(
      lists.map((list) =>
        within(list)
          .getAllByRole('listitem')
          .map((item) => item.textContent),
      ),
    ).toEqual([['Buy now · /buy'], ['Buy · /shop', 'Learn more · /about']]);
    await expect(group).not.toHaveTextContent('{');
    await expect(within(group).queryByRole('button', { name: 'Edit' })).toBeNull();
    await expect(within(group).getAllByRole('button')).toHaveLength(2);
  },
};

/** A value with no text (an empty string, or an object whose fields are all empty) reads as `(empty)`, never blank. */
export const EmptyValues: Story = {
  args: { conflict: { anchor: 'content[id=hero-1].props.title', base: 'Sale', ours: '', theirs: { a: null } } },
  play: async ({ canvasElement }) => {
    const group = within(canvasElement).getByRole('group', { name: 'Hero title on Hero, from GitHub' });
    await expect(group).toHaveTextContent('Your value: (empty)');
    await expect(group).toHaveTextContent("Ben's value: (empty)");
  },
};

/** A file a git rule keeps back cannot be settled here. */
export const AskYourDeveloper: Story = {
  args: {
    conflict: { anchor: 'lfs:assets/video.mp4', base: undefined, ours: undefined, theirs: undefined },
    label: { component: null, field: 'assets/video.mp4' },
  },
  play: async ({ canvasElement }) => {
    const group = within(canvasElement).getByRole('group', { name: 'assets/video.mp4, from GitHub' });
    await expect(group).toHaveTextContent('Ask your developer: this file needs a git setting before it can ship.');
    await expect(within(group).queryAllByRole('button')).toHaveLength(0);
  },
};

/** While a choice is sent, nothing else can be chosen. */
export const Pending: Story = {
  args: { pending: true },
  play: async ({ args, canvasElement }) => {
    const group = within(canvasElement).getByRole('group', { name: 'Hero title on Hero, from GitHub' });
    await expect(group).toHaveAttribute('aria-busy', 'true');
    const buttons = within(group).getAllByRole('button');
    await expect(buttons.map((button) => button.matches(':disabled'))).toEqual([true, true, true]);
    await userEvent.click(within(group).getByRole('button', { name: 'Keep mine' }));
    await expect(args.onPick).not.toHaveBeenCalled();
  },
};
