import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import {
  clash,
  config,
  data,
  fake,
  fakeTools,
  PAGE,
  setUp,
  tools,
  WithQueries,
} from '../../../test/draft-page-stories.js';
import '../../main.css';
import { EditorNoticeStrip } from './EditorNoticeStrip.js';

/** The stored clashes of a page above its editor, settled in place; live messages refresh it. */
const meta = {
  component: EditorNoticeStrip,
  args: { page: PAGE, data, config },
  render: (args) => (
    <WithQueries>
      <EditorNoticeStrip {...args} />
    </WithQueries>
  ),
} satisfies Meta<typeof EditorNoticeStrip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const GitHubClashKeepsMine: Story = {
  beforeEach: setUp(fakeTools([[clash()], []])),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const picker = await canvas.findByRole('group', { name: /from GitHub/ });
    await expect(picker).toHaveTextContent('2 days ago');
    await userEvent.click(within(picker).getByRole('button', { name: 'Keep mine' }));
    await expect(tools.resolveConflict).toHaveBeenCalledWith(
      expect.objectContaining({ ...PAGE, choice: 'mine', expectedCurrent: 'Spring sale', valueId: 'v1' }),
    );
    await waitFor(() => expect(canvas.queryByRole('group')).toBeNull());
    await expect(canvas.getByRole('status')).toHaveTextContent('No fields need a decision');
  },
};

export const ReviewClashLabel: Story = {
  beforeEach: setUp(fakeTools([[clash({ source: 'review', authorLabel: 'Ana' })]])),
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole('group', { name: /from a review by Ana/ })).toBeVisible();
  },
};

export const ChangedJustNow: Story = {
  beforeEach: setUp(fakeTools([[clash()], [clash({ ours: 'Spring sale!' })]], [{ ok: false, reason: 'changed' }])),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Use theirs' }));
    await expect(await canvas.findByRole('alert')).toHaveTextContent('Changed just now. Check the values again.');
    await waitFor(() => expect(tools.listConflicts).toHaveBeenCalledTimes(2));
    await expect(await canvas.findByText('Spring sale!')).toBeVisible();
  },
};

export const EditSubmitsValue: Story = {
  beforeEach: setUp(fakeTools([[clash()]])),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Edit' }));
    const box = canvas.getByRole('textbox', { name: 'New value for Hero title' });
    await expect(box).toHaveValue('Summer sale');
    await userEvent.clear(box);
    await userEvent.type(box, 'Autumn sale');
    await expect(tools.resolveConflict).not.toHaveBeenCalled();
    await userEvent.click(canvas.getByRole('button', { name: 'Save value' }));
    await expect(tools.resolveConflict).toHaveBeenCalledWith(
      expect.objectContaining({ choice: 'value', value: 'Autumn sale', expectedCurrent: 'Spring sale' }),
    );
  },
};

export const RefreshOnConflictMessage: Story = {
  beforeEach: setUp(fakeTools([[clash()]])),
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole('group');
    await expect(tools.listConflicts).toHaveBeenCalledTimes(1);
    fake.emit({ type: 'conloca:conflict', ...PAGE, id: 'other', open: true, anchors: [] });
    fake.emit({ type: 'conloca:conflict', ...PAGE, open: true, anchors: ['content[id=hero-1].props.title'] });
    await waitFor(() => expect(tools.listConflicts).toHaveBeenCalledTimes(2));
    await expect(tools.listConflicts).toHaveBeenLastCalledWith(PAGE);
  },
};

export const AnchorGone: Story = {
  beforeEach: setUp(fakeTools([[clash()]], [{ ok: false, reason: 'anchor-gone' }])),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Use theirs' }));
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'This block was removed. Keep yours to settle it.',
    );
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Use theirs' })).toBeDisabled());
    await expect(canvas.getByRole('button', { name: 'Edit' })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: 'Keep mine' })).toBeEnabled();
  },
};

export const RefusedResolve: Story = {
  beforeEach: setUp(fakeTools([[clash()]], [{ ok: false, reason: 'refused', message: 'Billing is paused.' }])),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Keep mine' }));
    await expect(await canvas.findByRole('alert')).toHaveTextContent('Billing is paused.');
    await expect(canvas.getByRole('group', { name: /from GitHub/ })).toBeVisible();
    await expect(tools.listConflicts).toHaveBeenCalledTimes(1);
  },
};

export const OverwriteRichText: Story = {
  beforeEach: setUp(fakeTools([[]])),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    fake.emit({
      type: 'conloca:overwritten',
      ...PAGE,
      anchor: 'content[id=hero-1].props.body',
      value: { value: '<p>Mine</p>' },
      byUserId: 'u_maria',
      byName: 'Maria',
    });
    const notice = await canvas.findByText('Maria changed Body.');
    await expect(notice.closest('[data-field-anchor]')).toHaveAttribute(
      'data-field-anchor',
      'content[id=hero-1].props.body.value',
    );
  },
};
