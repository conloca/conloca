import type { Meta, StoryObj } from '@storybook/react-vite';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { expect, fn, spyOn, userEvent, within } from 'storybook/test';
import '../../main.css';
import type { Page } from '../../types.js';
import { PageTable } from './PageTable.js';

/**
 * Whole-row click targets, measured with real hit-testing: jsdom cannot see the CSS that makes the row's title
 * button cover it (`after:absolute after:inset-0`), lifts the actions above it (`z-10`), and keeps them under
 * dialogs (the table wrapper's `isolate`). `elementFromPoint` reports the element a pointer would reach, so each
 * assertion fails when its class is removed. The list stays mounted while the location probe records navigation.
 */
const page: Page = {
  id: 'home',
  title: 'Home',
  path: '/home',
  type: 'mdx',
  status: 'published',
  modified: new Date('2026-01-10T09:00:00.000Z'),
  // The first locale is the one a row opens; the selected filter (`all`) must not change that.
  locales: ['nl', 'en'],
};

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <p>
      <span data-testid="location">{`${location.pathname}${location.search}`}</span>
      <button type="button" onClick={() => void navigate('/pages')}>
        Back to the list
      </button>
    </p>
  );
}

const meta = {
  component: PageTable,
  args: { pages: [page], selectedLocale: 'all', isMultiLocale: true, onPreview: fn(), onDelete: fn() },
  decorators: [
    (Story) => (
      <MemoryRouter initialEntries={['/pages']}>
        <LocationProbe />
        <Story />
      </MemoryRouter>
    ),
  ],
  beforeEach: () => {
    const copy = spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    return () => copy.mockRestore();
  },
} satisfies Meta<typeof PageTable>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The element a pointer reaches at the centre of `target`. */
function elementAtCentre(target: Element): Element {
  const box = target.getBoundingClientRect();
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  if (!hit) throw new Error('Nothing is rendered at the target point');
  return hit;
}

function onlyPageRow(canvasElement: HTMLElement): HTMLTableRowElement {
  const row = canvasElement.querySelector<HTMLTableRowElement>('tbody tr');
  if (!row) throw new Error('Expected the PageRow');
  return row;
}

const FIRST_LOCALE_EDITOR = '/pages/home?locale=nl';

export const NonTitleCellsOpenTheFirstLocale: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = onlyPageRow(canvasElement);
    const title = canvas.getByRole('button', { name: 'Home' });
    const location = canvas.getByTestId('location');
    // Title, path, status, modified date and locales cells; the actions cell has its own story.
    const cells = [...row.cells].slice(0, 5);
    await expect(cells).toHaveLength(5);
    // oxlint-disable no-await-in-loop -- each cell's round trip (back to the list, click, assert) must finish before the next starts.
    for (const cell of cells) {
      await expect(cell).toBeVisible();
      await expect(elementAtCentre(cell)).toBe(title);
      await userEvent.click(canvas.getByRole('button', { name: 'Back to the list' }));
      await expect(location).toHaveTextContent(/^\/pages$/);
      await userEvent.click(elementAtCentre(cell));
      await expect(location).toHaveTextContent(FIRST_LOCALE_EDITOR);
    }
    // oxlint-enable no-await-in-loop
  },
};

export const GapsBetweenActionsStayPartOfTheRow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const title = canvas.getByRole('button', { name: 'Home' });
    const preview = canvas.getByRole('button', { name: 'Preview Home' });
    const copy = canvas.getByRole('button', { name: 'Copy path for Home' });
    const gap = (preview.getBoundingClientRect().right + copy.getBoundingClientRect().left) / 2;
    const middle = preview.getBoundingClientRect().top + preview.getBoundingClientRect().height / 2;
    await expect(copy.getBoundingClientRect().left).toBeGreaterThan(preview.getBoundingClientRect().right);
    await expect(document.elementFromPoint(gap, middle)).toBe(title);
  },
};

export const ActionsDoNotOpenTheRow: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const location = canvas.getByTestId('location');
    const preview = canvas.getByRole('button', { name: 'Preview Home' });
    const copy = canvas.getByRole('button', { name: 'Copy path for Home' });
    const more = canvas.getByRole('button', { name: 'More actions for Home' });

    // Every action is what a pointer reaches, not the row's overlay above it.
    await Promise.all(
      [preview, copy, more].map((action) => expect(action.contains(elementAtCentre(action))).toBe(true)),
    );

    await userEvent.click(elementAtCentre(preview));
    await expect(args.onPreview).toHaveBeenCalledTimes(1);
    await expect(args.onPreview).toHaveBeenCalledWith('/home');
    await expect(location).toHaveTextContent(/^\/pages$/);

    await userEvent.click(elementAtCentre(copy));
    await expect(await canvas.findByRole('status')).toHaveTextContent('Copied page path.');
    await expect(location).toHaveTextContent(/^\/pages$/);

    await userEvent.click(elementAtCentre(more));
    await expect(await within(document.body).findByRole('menuitem', { name: 'Delete' })).toBeVisible();
    await expect(args.onDelete).not.toHaveBeenCalled();
    await expect(location).toHaveTextContent(/^\/pages$/);
    await userEvent.keyboard('{Escape}');
  },
};

/**
 * A dialog layer above the page must cover the raised actions. The row's identity transform and the table wrapper's
 * `isolate` each contain the actions' `z-10`, so only removing both lets them paint over the layer.
 */
export const ActionsStayBelowDialogs: Story = {
  render: (args) => (
    <>
      <PageTable {...args} />
      <div data-testid="dialog-layer" style={{ position: 'fixed', inset: 0, zIndex: 5 }} />
    </>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const layer = canvas.getByTestId('dialog-layer');
    await Promise.all(
      [
        canvas.getByRole('button', { name: 'Preview Home' }),
        canvas.getByRole('button', { name: 'Copy path for Home' }),
        canvas.getByRole('button', { name: 'More actions for Home' }),
      ].map((action) => expect(elementAtCentre(action)).toBe(layer)),
    );
    await expect(elementAtCentre(canvas.getByRole('button', { name: 'Home' }))).toBe(layer);
  },
};
