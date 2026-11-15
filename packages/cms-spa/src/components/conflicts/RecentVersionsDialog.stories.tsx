import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import type {
  DiscardOutcome,
  DraftToolsHost,
  EarlierVersion,
  PageConflict,
  PageRef,
  ResolveConflictOutcome,
  RestoreVersionOutcome,
} from '../../draft-tools.js';
import { configureUI, getUIConfig } from '../../ui-config.js';
import '../../main.css';
import { RecentVersionsDialog } from './RecentVersionsDialog.js';

const PAGE: PageRef = { site: 'default', id: 'pricing', locale: 'en' };
const EXPIRES = Date.UTC(2026, 11, 5, 12);

const version = (over: Partial<EarlierVersion>): EarlierVersion => ({
  snapshotId: 's1',
  reason: 'discard',
  authors: ['Maria'],
  at: Date.UTC(2026, 10, 5, 12),
  expiresAt: EXPIRES,
  restorable: true,
  ...over,
});

const OLDER = version({ snapshotId: 's-older', reason: 'overwrite', authors: ['Ben'], at: Date.UTC(2026, 10, 3, 12) });
const NEWER = version({ snapshotId: 's-newer', reason: 'discard', authors: ['Maria', 'Ben'] });

let listed: EarlierVersion[] = [];
let outcome: RestoreVersionOutcome = { ok: true, kept: [] };

const tools = {
  listConflicts: fn(async (_page: PageRef): Promise<PageConflict[]> => []),
  resolveConflict: fn(async (): Promise<ResolveConflictOutcome> => ({ ok: true })),
  discardPage: fn(async (_page: PageRef): Promise<DiscardOutcome> => ({ ok: true })),
  listVersions: fn(async (_page: PageRef): Promise<EarlierVersion[]> => listed),
  restoreVersion: fn(async (_input: { snapshotId: string }): Promise<RestoreVersionOutcome> => outcome),
} satisfies DraftToolsHost;

const setUp =
  (rows: EarlierVersion[], answer: RestoreVersionOutcome = { ok: true, kept: [] }) =>
  () => {
    const previous = getUIConfig();
    listed = rows;
    outcome = answer;
    tools.listVersions.mockClear();
    tools.restoreVersion.mockClear();
    configureUI({ ...previous, draftTools: tools, siteId: PAGE.site });
    return () => configureUI(previous);
  };

const dialog = async (canvasElement: HTMLElement) =>
  within(await within(canvasElement.ownerDocument.body).findByRole('dialog', { name: 'Recent versions of Pricing' }));

/** A page's versions set aside in the last 30 days, opened from the page draft menu's `Recent versions`. */
const meta = {
  component: RecentVersionsDialog,
  args: { page: PAGE, label: 'Pricing', open: true, onOpenChange: fn() },
  beforeEach: setUp([OLDER, NEWER]),
} satisfies Meta<typeof RecentVersionsDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ListsNewestFirst: Story = {
  play: async ({ canvasElement }) => {
    const view = await dialog(canvasElement);
    const items = await view.findAllByRole('listitem');
    await expect(items.map((item) => item.textContent)).toEqual([
      'Discarded · Maria, Ben · 5 Nov 2026Restorable until 5 Dec 2026Restore',
      'Overwritten while editing · Ben · 3 Nov 2026Restorable until 5 Dec 2026Restore',
    ]);
    const [first, second] = view.getAllByRole('button', { name: 'Restore' });
    first?.focus();
    await userEvent.keyboard('{ArrowDown}');
    await expect(second).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    await expect(first).toHaveFocus();
    await userEvent.tab();
    await expect(second).toHaveFocus();
  },
};

export const NotRestorable: Story = {
  beforeEach: setUp([version({ reason: 'upstream', restorable: false })]),
  play: async ({ canvasElement }) => {
    const view = await dialog(canvasElement);
    const item = await view.findByRole('listitem');
    await expect(item).toHaveTextContent('Replaced by a GitHub push · Maria · 5 Nov 2026');
    await expect(item).toHaveTextContent('Kept for reference');
    await expect(within(item).queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
  },
};

export const RestoreChanged: Story = {
  beforeEach: setUp([NEWER], { ok: false, reason: 'changed' }),
  play: async ({ canvasElement }) => {
    const view = await dialog(canvasElement);
    await userEvent.click(await view.findByRole('button', { name: 'Restore' }));
    await expect(await view.findByRole('alert')).toHaveTextContent(
      'Pricing changed since this list loaded. Look again.',
    );
    await expect(tools.restoreVersion).toHaveBeenCalledWith({ snapshotId: 's-newer' });
    await waitFor(() => expect(tools.listVersions).toHaveBeenCalledTimes(2));
  },
};

const REFUSALS: [RestoreVersionOutcome, string][] = [
  [
    { ok: false, reason: 'path-taken' },
    "Another page now uses this page's address. Move that page, then restore again.",
  ],
  [{ ok: false, reason: 'not-a-page' }, "This version isn't a page, so it can't be restored here."],
  [{ ok: false, reason: 'too-large' }, 'This version is too large to restore.'],
  [
    { ok: false, reason: 'refused', message: 'Your access to this repository changed.' },
    'Your access to this repository changed.',
  ],
];

export const RestoreRefused: Story = {
  beforeEach: setUp([NEWER]),
  play: async ({ canvasElement }) => {
    const view = await dialog(canvasElement);
    for (const [answer, copy] of REFUSALS) {
      outcome = answer;
      // oxlint-disable-next-line no-await-in-loop -- in order: each refusal replaces the previous alert.
      await userEvent.click(await view.findByRole('button', { name: 'Restore' }));
      // oxlint-disable-next-line no-await-in-loop -- reads the alert of this click, not the next one.
      await expect(await view.findByRole('alert')).toHaveTextContent(copy);
    }
    await expect(tools.listVersions).toHaveBeenCalledTimes(1);
    await expect(view.getAllByRole('listitem')).toHaveLength(1);
    await expect(view.queryByRole('status')).not.toBeInTheDocument();
  },
};

export const DiscardSnapshotListed: Story = {
  beforeEach: setUp([version({ snapshotId: 's-discard', reason: 'discard' })]),
  play: async ({ canvasElement }) => {
    const view = await dialog(canvasElement);
    const item = await view.findByRole('listitem');
    await expect(item).toHaveTextContent('Discarded · Maria · 5 Nov 2026');
    await userEvent.click(within(item).getByRole('button', { name: 'Restore' }));
    await expect(tools.restoreVersion).toHaveBeenCalledWith({ snapshotId: 's-discard' });
  },
};

export const RestoreKeepsNewer: Story = {
  beforeEach: setUp([NEWER], { ok: true, kept: ['title'] }),
  play: async ({ canvasElement }) => {
    const view = await dialog(canvasElement);
    await userEvent.click(await view.findByRole('button', { name: 'Restore' }));
    await expect(await view.findByRole('status')).toHaveTextContent('Restored Pricing. 1 field kept its newer value.');
  },
};

export const Expired: Story = {
  beforeEach: setUp([NEWER], { ok: false, reason: 'expired' }),
  play: async ({ canvasElement }) => {
    const view = await dialog(canvasElement);
    await userEvent.click(await view.findByRole('button', { name: 'Restore' }));
    await expect(await view.findByRole('alert')).toHaveTextContent('This version expired on 5 Dec 2026.');
    await waitFor(() => expect(tools.listVersions).toHaveBeenCalledTimes(2));
  },
};

export const Empty: Story = {
  beforeEach: setUp([]),
  play: async ({ canvasElement }) => {
    const view = await dialog(canvasElement);
    await expect(await view.findByText('No saved versions in the last 30 days.')).toBeInTheDocument();
  },
};
