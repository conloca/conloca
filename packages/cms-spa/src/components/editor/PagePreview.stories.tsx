import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test';
import '../../main.css';
import { configureUI, getUIConfig, type OpenPreviewResult, setPreviewCapability } from '../../ui-config.js';
import { Toaster, toast } from '../toast.js';
import { PageEditorHeaderActions } from './PageEditorHeaderActions.js';
import {
  PREVIEW_CHECK_AGAIN,
  PREVIEW_TRY_AGAIN,
  PREVIEW_UNAVAILABLE_DETAIL,
  PREVIEW_UNAVAILABLE_NEXT_STEP,
  PREVIEW_UNAVAILABLE_TITLE,
} from './preview-availability.js';
import { usePagePreview } from './usePagePreview.js';

/**
 * The Preview control of the page editor wired the way the editor wires it: the header button, the preview
 * request behind it and the toasts that explain it. The boundary is what the host installs through `configureUI`
 * (`openPreview`, `previewCapability`) and what it later tells the editor (`setPreviewCapability`, the call the
 * frame makes on `previewCapability.changed`); the host opens the tab (`previewTab: 'parent'`), so no story opens a
 * real one. Puck mounts the header inside its MenuBar, so the control sits in a container the editor's global
 * styles match the same way.
 */
function PagePreviewControl() {
  const preview = usePagePreview('/about');
  return (
    <div className="_MenuBar_story">
      <Toaster />
      <PageEditorHeaderActions
        onPreview={preview.open}
        previewDisabledReason={preview.blockedReason ?? undefined}
        previewPending={preview.pending}
        currentLocale="en"
        availableLocales={['en']}
        saveState="idle"
        isDirty={false}
        onSave={fn()}
        onOpenMetadata={fn()}
        onBack={fn()}
      />
    </div>
  );
}

const UNAVAILABLE_PREVIEW_RESULT: OpenPreviewResult = {
  ok: false,
  reason: 'not-deployed',
  message: 'example.com does not serve draft preview.',
  previewCapability: 'unavailable',
};
const OPENED: OpenPreviewResult = {
  ok: true,
  url: 'https://preview.example.test/about',
  previewCapability: 'available',
};

const meta = {
  title: 'Editor/PagePreview',
  component: PagePreviewControl,
  // The UI config is module state shared with every other story in the same Storybook preview, and toasts are a
  // process-wide store: put back whatever was installed and start each story with none.
  beforeEach: () => {
    const previous = getUIConfig();
    toast.dismiss();
    return () => {
      toast.dismiss();
      configureUI(previous);
    };
  },
} satisfies Meta<typeof PagePreviewControl>;

export default meta;
type Story = StoryObj<typeof meta>;

const previewButton = (canvasElement: HTMLElement) => within(canvasElement).getByTestId('preview-button');

/** The site can preview: a click asks the host for the draft preview of this page and the control stays usable. */
export const PreviewAvailable: Story = {
  beforeEach: () => {
    const openPreview = fn(async () => OPENED);
    configureUI({ ...getUIConfig(), previewTab: 'parent', previewCapability: 'available', openPreview });
  },
  play: async ({ canvasElement }) => {
    const button = previewButton(canvasElement);
    await expect(button).toHaveAttribute('aria-disabled', 'false');
    await expect(button).toHaveAccessibleName('Preview');
    await userEvent.click(button);
    await waitFor(() => expect(getUIConfig().openPreview).toHaveBeenCalledWith({ path: '/about' }));
    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'false'));
    await expect(screen.queryByText(PREVIEW_UNAVAILABLE_TITLE)).toBeNull();
  },
};

/** Not established yet (the host is still probing): the control stays enabled, since the request is the authority. */
export const PreviewCapabilityUnknown: Story = {
  beforeEach: () => {
    configureUI({
      ...getUIConfig(),
      previewTab: 'parent',
      previewCapability: 'unknown',
      openPreview: fn(async () => OPENED),
    });
  },
  play: async ({ canvasElement }) => {
    const button = previewButton(canvasElement);
    await expect(button).toHaveAttribute('aria-disabled', 'false');
    await expect(button).toHaveAccessibleName('Preview');
  },
};

/** A support-session restriction is explained without offering a retry that cannot change that session. */
export const PreviewRestrictedInSupportSession: Story = {
  beforeEach: () => {
    configureUI({
      ...getUIConfig(),
      previewTab: 'parent',
      previewCapability: 'unknown',
      openPreview: fn(
        async (): Promise<OpenPreviewResult> => ({
          ok: false,
          reason: 'not-allowed',
          message: 'Preview is not available in a support session.',
          previewCapability: 'unknown',
        }),
      ),
    });
  },
  play: async ({ canvasElement }) => {
    const button = previewButton(canvasElement);
    await userEvent.click(button);
    await waitFor(() => expect(screen.getByText('Preview is not available in a support session.')).toBeVisible());
    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'false'));
    await expect(screen.queryByRole('button', { name: PREVIEW_CHECK_AGAIN })).toBeNull();
    await expect(screen.queryByRole('button', { name: PREVIEW_TRY_AGAIN })).toBeNull();
    await expect(screen.queryByText(PREVIEW_UNAVAILABLE_TITLE)).toBeNull();
    await expect(button).toHaveAttribute('aria-disabled', 'false');
    await expect(getUIConfig().previewCapability).toBe('unknown');
    await expect(getUIConfig().openPreview).toHaveBeenCalledTimes(1);
  },
};

/** The request is in flight: the control shows it is working and a second click does not send a second request. */
export const PreviewLoading: Story = {
  beforeEach: () => {
    const openPreview = fn(() => new Promise<OpenPreviewResult>(() => undefined));
    configureUI({ ...getUIConfig(), previewTab: 'parent', previewCapability: 'unknown', openPreview });
  },
  play: async ({ canvasElement }) => {
    const button = previewButton(canvasElement);
    await userEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'true'));
    await userEvent.click(button);
    await expect(getUIConfig().openPreview).toHaveBeenCalledTimes(1);
  },
};

/**
 * The host already knows the branch has no preview server: the control says so in its name and tooltip, and a click
 * explains the reason, the next step and offers Check again, without asking the host anything.
 */
export const PreviewUnavailableWithReason: Story = {
  beforeEach: () => {
    configureUI({
      ...getUIConfig(),
      previewTab: 'parent',
      previewCapability: 'unavailable',
      openPreview: fn(async () => UNAVAILABLE_PREVIEW_RESULT),
    });
  },
  play: async ({ canvasElement }) => {
    const button = previewButton(canvasElement);
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(button).toHaveAttribute('title', PREVIEW_UNAVAILABLE_DETAIL);
    await userEvent.click(button);
    await waitFor(() => expect(screen.getByText(PREVIEW_UNAVAILABLE_TITLE)).toBeInTheDocument());
    await expect(
      screen.getByText(`${PREVIEW_UNAVAILABLE_DETAIL} ${PREVIEW_UNAVAILABLE_NEXT_STEP}`),
    ).toBeInTheDocument();
    await expect(screen.getByRole('button', { name: PREVIEW_CHECK_AGAIN })).toBeInTheDocument();
    await expect(getUIConfig().openPreview).not.toHaveBeenCalled();
  },
};

/** An answer of "not deployed" is learned: the control goes unavailable with the host's own words as the reason. */
export const PreviewNotDeployedLearned: Story = {
  beforeEach: () => {
    configureUI({
      ...getUIConfig(),
      previewTab: 'parent',
      previewCapability: 'unknown',
      openPreview: fn(async () => UNAVAILABLE_PREVIEW_RESULT),
    });
  },
  play: async ({ canvasElement }) => {
    const button = previewButton(canvasElement);
    await userEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'true'));
    await expect(button).toHaveAttribute('title', 'example.com does not serve draft preview.');
    await expect(await screen.findByText('example.com does not serve draft preview.')).toBeInTheDocument();
  },
};

/** Check again asks the site once more, and the control comes back when the preview has since been set up. */
export const PreviewRetryAfterSetup: Story = {
  beforeEach: () => {
    const answers = [UNAVAILABLE_PREVIEW_RESULT, OPENED];
    const openPreview = fn(async () => answers.shift() ?? OPENED);
    configureUI({ ...getUIConfig(), previewTab: 'parent', previewCapability: 'unknown', openPreview });
  },
  play: async ({ canvasElement }) => {
    const button = previewButton(canvasElement);
    await userEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'true'));

    await userEvent.click(await screen.findByRole('button', { name: PREVIEW_CHECK_AGAIN }));

    await waitFor(() => expect(getUIConfig().openPreview).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'false'));
    await expect(button).toHaveAccessibleName('Preview');
  },
};

/** Check again on a branch that still has no preview explains again instead of silently doing nothing. */
export const PreviewRetryStillUnavailable: Story = {
  beforeEach: () => {
    configureUI({
      ...getUIConfig(),
      previewTab: 'parent',
      previewCapability: 'unavailable',
      openPreview: fn(async () => UNAVAILABLE_PREVIEW_RESULT),
    });
  },
  play: async ({ canvasElement }) => {
    const button = previewButton(canvasElement);
    await userEvent.click(button);
    await userEvent.click(await screen.findByRole('button', { name: PREVIEW_CHECK_AGAIN }));

    await waitFor(() => expect(getUIConfig().openPreview).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'true'));
    await expect(await screen.findByText('example.com does not serve draft preview.')).toBeInTheDocument();
  },
};

/**
 * Regression: the unavailable state used to be latched in the editor when it opened, so a branch that gained a
 * preview server (the host re-probed, or setup finished) kept a dead Preview until the page was reloaded.
 */
export const PreviewRecoversWithoutReload: Story = {
  beforeEach: () => {
    configureUI({
      ...getUIConfig(),
      previewTab: 'parent',
      previewCapability: 'unavailable',
      openPreview: fn(async () => OPENED),
    });
  },
  play: async ({ canvasElement }) => {
    const button = previewButton(canvasElement);
    await expect(button).toHaveAttribute('aria-disabled', 'true');

    setPreviewCapability('available');

    await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'false'));
    await expect(button).toHaveAccessibleName('Preview');
    await userEvent.click(button);
    await waitFor(() => expect(getUIConfig().openPreview).toHaveBeenCalledWith({ path: '/about' }));
  },
};

/** Regression: a verdict that arrives after the editor opened (the host's cold-cache re-probe) reaches the control. */
export const PreviewBecomesUnavailableLate: Story = {
  beforeEach: () => {
    configureUI({
      ...getUIConfig(),
      previewTab: 'parent',
      previewCapability: 'unknown',
      openPreview: fn(async () => OPENED),
    });
  },
  play: async ({ canvasElement }) => {
    const button = previewButton(canvasElement);
    await expect(button).toHaveAttribute('aria-disabled', 'false');

    setPreviewCapability('unavailable');

    await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'true'));
    await expect(button).toHaveAttribute('title', PREVIEW_UNAVAILABLE_DETAIL);
  },
};

function ClosableEditor() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(false)}>
        Close editor
      </button>
      {open ? <PagePreviewControl /> : <Toaster />}
    </>
  );
}

/** The explanation belongs to the editor that raised it: leaving the page takes it away, with its retry action. */
export const PreviewToastsGoWithTheEditor: Story = {
  render: () => <ClosableEditor />,
  beforeEach: () => {
    configureUI({
      ...getUIConfig(),
      previewTab: 'parent',
      previewCapability: 'unavailable',
      openPreview: fn(async () => UNAVAILABLE_PREVIEW_RESULT),
    });
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(previewButton(canvasElement));
    await expect(await screen.findByRole('button', { name: PREVIEW_CHECK_AGAIN })).toBeInTheDocument();

    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Close editor' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: PREVIEW_CHECK_AGAIN })).toBeNull());
    await expect(getUIConfig().openPreview).not.toHaveBeenCalled();
  },
};
