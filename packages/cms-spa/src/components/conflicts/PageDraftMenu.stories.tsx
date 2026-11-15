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
import { PageDraftMenu } from './PageDraftMenu.js';

const PAGE: PageRef = { site: 'default', id: 'pricing', locale: 'en' };

const tools = {
  listConflicts: fn(async (_page: PageRef): Promise<PageConflict[]> => []),
  resolveConflict: fn(async (): Promise<ResolveConflictOutcome> => ({ ok: true })),
  discardPage: fn(async (_page: PageRef): Promise<DiscardOutcome> => ({ ok: true })),
  listVersions: fn(async (_page: PageRef): Promise<EarlierVersion[]> => []),
  restoreVersion: fn(async (): Promise<RestoreVersionOutcome> => ({ ok: true, kept: [] })),
} satisfies DraftToolsHost;

/** The page's draft actions in the editor header: discard this page's changes, or open its recent versions. */
const meta = {
  component: PageDraftMenu,
  args: { page: PAGE, onOpenVersions: fn() },
  beforeEach: () => {
    const previous = getUIConfig();
    tools.discardPage.mockClear();
    configureUI({ ...previous, draftTools: tools, siteId: PAGE.site });
    return () => configureUI(previous);
  },
} satisfies Meta<typeof PageDraftMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DiscardChanges: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    canvas.getByRole('button', { name: 'Page draft' }).focus();
    await userEvent.keyboard('{Enter}');
    const discard = await body.findByRole('menuitem', { name: 'Discard changes' });
    await waitFor(() => expect(discard).toHaveFocus());
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() => expect(body.getByRole('menuitem', { name: 'Recent versions' })).toHaveFocus());
    await userEvent.keyboard('{ArrowUp}');
    await waitFor(() => expect(discard).toHaveFocus());
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(tools.discardPage).toHaveBeenCalledWith(PAGE));
    await expect(args.onOpenVersions).not.toHaveBeenCalled();
  },
};

export const RecentVersions: Story = {
  play: async ({ canvasElement, args }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Page draft' }));
    await userEvent.click(await body.findByRole('menuitem', { name: 'Recent versions' }));
    await waitFor(() => expect(args.onOpenVersions).toHaveBeenCalledTimes(1));
    await expect(tools.discardPage).not.toHaveBeenCalled();
  },
};
