import type { LocalizedEntry } from '@conloca/content-api-client';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test';
import '../../main.css';
import { configureUI, getUIConfig, type OpenPreviewResult, setPreviewCapability } from '../../ui-config.js';
import { Toaster, toast } from '../toast.js';
import { PageEditorHarness } from './PageEditorCanvas.stories.js';

/**
 * Preview interactions through PageEditor and Puck's stable header override, reached from the editor toolbar.
 * The browser renders Puck itself: a direct header render cannot establish that ref changes reach its MenuBar.
 */
const ENTRY: LocalizedEntry = {
  id: 'preview-page',
  type: 'puck',
  kind: 'page',
  site: 'default',
  collection: 'pages',
  localized: {
    locale: 'en',
    pathname: '/about',
    etag: 'meta.content',
    created: '2026-09-23T00:00:00.000Z',
    modified: '2026-09-23T00:00:00.000Z',
    meta: { title: 'About' },
    content: { puckData: { content: [], root: { props: {} } } },
  },
};
const CONFIRM_ADDRESS = 'A workspace admin can confirm the address in the editor banner or the setup checklist.';
const NO_PREVIEW_BUILD = 'The configured address does not serve a matching preview build.';
const OPENED: OpenPreviewResult = {
  ok: true,
  url: 'https://preview.example.test/about',
  previewCapability: 'available',
};
let finish: (result: OpenPreviewResult) => void = () => {
  throw new Error('No pending preview');
};

const meta = {
  title: 'Editor/PageEditorPreview',
  component: PageEditorHarness,
  parameters: { layout: 'fullscreen' },
  args: { entry: ENTRY, config: { components: {} }, onOpenMetadata: fn() },
  decorators: [
    (Story) => (
      <>
        <Toaster />
        <Story />
      </>
    ),
  ],
  beforeEach: () => {
    const previous = getUIConfig();
    toast.dismiss();
    return () => {
      toast.dismiss();
      configureUI(previous);
    };
  },
} satisfies Meta<typeof PageEditorHarness>;
export default meta;
type Story = StoryObj<typeof meta>;

export const PendingAndRecovery: Story = {
  beforeEach: () => {
    const openPreview = fn(
      () =>
        new Promise<OpenPreviewResult>((resolve) => {
          finish = resolve;
        }),
    );
    configureUI({ ...getUIConfig(), previewTab: 'parent', previewCapability: 'unknown', openPreview });
  },
  play: async ({ canvasElement }) => {
    const button = await within(canvasElement).findByTestId('preview-button');
    await expect(canvasElement.querySelector('iframe#preview-frame')).not.toBeNull();
    await userEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'true'));
    await userEvent.click(button);
    await expect(getUIConfig().openPreview).toHaveBeenCalledTimes(1);
    finish({
      ok: false,
      reason: 'not-deployed',
      message: NO_PREVIEW_BUILD,
      previewCapability: 'unavailable',
    });
    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'false'));
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(await screen.findByText(NO_PREVIEW_BUILD)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'true'));
    await expect(getUIConfig().openPreview).toHaveBeenCalledTimes(2);
    finish(OPENED);
    await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'false'));
    await expect(button).toHaveAttribute('aria-busy', 'false');
    await expect(button).toHaveAccessibleName('Preview');
    setPreviewCapability('unavailable');
    await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'true'));
    setPreviewCapability('unknown');
    await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'false'));
    setPreviewCapability('available');
    await expect(button).toHaveAccessibleName('Preview');
  },
};

export const AddressNeedsConfirmation: Story = {
  beforeEach: () => {
    configureUI({
      ...getUIConfig(),
      previewTab: 'parent',
      previewCapability: 'unknown',
      openPreview: fn(async () => ({
        ok: false as const,
        reason: 'not-deployed' as const,
        message: CONFIRM_ADDRESS,
        previewCapability: 'unknown' as const,
      })),
    });
  },
  play: async ({ canvasElement }) => {
    const button = await within(canvasElement).findByTestId('preview-button');
    await userEvent.click(button);
    await expect(await screen.findByText(CONFIRM_ADDRESS)).toBeInTheDocument();
    await expect(button).toHaveAttribute('aria-disabled', 'false');
    await expect(screen.queryByText(/Set up a preview server/)).toBeNull();
    await expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument();
  },
};
