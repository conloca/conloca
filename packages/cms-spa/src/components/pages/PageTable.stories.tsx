import type { Meta, StoryObj } from '@storybook/react-vite';
import { MemoryRouter } from 'react-router-dom';
import { expect, fn, userEvent, within } from 'storybook/test';
import '../../main.css';
import type { Page } from '../../types.js';
import { configureUI, getUIConfig } from '../../ui-config.js';
import { PageTable } from './PageTable.js';

/** Storybook mounts the table used by Pages with already-grouped pages, as PageList supplies them. */
const page: Page = {
  id: 'home',
  title: 'Home',
  path: '/home',
  type: 'puck',
  status: 'draft',
  modified: new Date('2026-01-10T09:00:00.000Z'),
  locales: ['en', 'nl'],
};

const meta = {
  component: PageTable,
  args: { pages: [page], selectedLocale: 'en', isMultiLocale: false, onPreview: fn(), onDelete: fn() },
  decorators: [
    (Story) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
} satisfies Meta<typeof PageTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EmptyTable: Story = {
  args: { pages: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('table')).toBeVisible();
    await expect(canvas.getAllByRole('row')).toHaveLength(1);
    await expect(canvas.getAllByRole('columnheader')).toHaveLength(5);
    await expect(canvas.queryByRole('columnheader', { name: 'Locales' })).not.toBeInTheDocument();
    await expect(canvas.queryByRole('button')).not.toBeInTheDocument();
  },
};

export const MultiplePagesAndLocales: Story = {
  args: {
    pages: [page, { ...page, id: 'about', title: 'About', path: '/about', locales: ['en'] }],
    selectedLocale: 'all',
    isMultiLocale: true,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole('row')).toHaveLength(3);
    await expect(canvas.getByRole('columnheader', { name: 'Locales' })).toBeVisible();
    await expect(canvas.getAllByRole('button', { name: /^Preview / })).toHaveLength(2);
    await userEvent.click(canvas.getByRole('button', { name: 'Preview About' }));
    await expect(args.onPreview).toHaveBeenCalledTimes(1);
    await expect(args.onPreview).toHaveBeenCalledWith('/about');
    await userEvent.click(canvas.getByTestId('page-actions-home'));
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: 'Delete nl version' }));
    await expect(args.onDelete).toHaveBeenCalledTimes(1);
    await expect(args.onDelete).toHaveBeenCalledWith('home', 'nl');
    await expect(canvas.getByRole('button', { name: 'About' })).toBeVisible();
  },
};

export const CustomStatusLabelAtPhoneWidth: Story = {
  args: { pages: [{ ...page, status: 'published', locales: ['en'] }] },
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  beforeEach: () => {
    const previous = getUIConfig();
    configureUI({ pageStatusLabels: { published: 'Pushed to Github' } });
    return () => configureUI(previous);
  },
  render: (args) => (
    <div style={{ width: 320 }}>
      <PageTable {...args} />
    </div>
  ),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const wrapper = canvas.getByRole('table').parentElement;
    if (!wrapper) throw new Error('Expected the page table wrapper');
    const badge = canvas.getAllByText('Pushed to Github').find((element) => element.getBoundingClientRect().width > 0);
    if (!badge) throw new Error('Expected a visible status badge');
    const preview = canvas.getByRole('button', { name: 'Preview Home' });
    await expect(badge).toBeVisible();
    await expect(wrapper.clientWidth).toBeLessThanOrEqual(320);
    await expect(wrapper.scrollWidth).toBeLessThanOrEqual(wrapper.clientWidth);
    await expect(badge.getBoundingClientRect().right).toBeLessThanOrEqual(preview.getBoundingClientRect().left);
    await userEvent.click(preview);
    await expect(args.onPreview).toHaveBeenCalledWith('/home');
    await expect(args.onDelete).not.toHaveBeenCalled();
    await expect(canvas.getByRole('button', { name: 'Home' })).toBeVisible();
  },
};
