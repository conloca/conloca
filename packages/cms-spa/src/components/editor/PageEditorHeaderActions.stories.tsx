import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import '../../main.css';
import { CanvasThemeProvider } from '../../hooks/useCanvasTheme.js';
import { configureUI, getUIConfig } from '../../ui-config.js';
import { PageEditorHeaderActions } from './PageEditorHeaderActions.js';

/**
 * The page editor's header controls: Publish, Preview, the canvas theme, the
 * locale picker, Save, page settings and exit. The boundary is the props the
 * page editor passes — its save state, whether the page is dirty, the reason a
 * preview is unavailable — and the callbacks it wires; the canvas theme reads
 * `CanvasThemeProvider`, and whether Save shows is `configureUI`'s `hosted` and
 * `hideEditorSave`.
 *
 * Recorded, not invented: the header has no layout of its own for narrow
 * screens (the editor around it decides what fits), so there is no phone story;
 * and Save carries its state as its visible label, not as a separate status.
 */

const meta = {
  component: PageEditorHeaderActions,
  args: {
    onPreview: fn(),
    currentLocale: 'en',
    availableLocales: ['en'],
    saveState: 'idle',
    isDirty: true,
    onSave: fn(),
    onOpenMetadata: fn(),
    onBack: fn(),
  },
  // The UI config is module state shared with every other story in the same
  // Storybook preview, so put back whatever was installed rather than defaults.
  beforeEach: () => {
    const previous = getUIConfig();
    configureUI({ ...previous, hideEditorSave: false });
    return () => configureUI(previous);
  },
} satisfies Meta<typeof PageEditorHeaderActions>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Unsaved edits: Save and Preview act, and every icon-only control is named. */
export const UnsavedEdits: Story = {
  args: { onPublish: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Preview' }));
    await expect(args.onPreview).toHaveBeenCalledTimes(1);
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }));
    await expect(args.onSave).toHaveBeenCalledTimes(1);
    await userEvent.click(canvas.getByRole('button', { name: 'Publish' }));
    await expect(args.onPublish).toHaveBeenCalledTimes(1);
    await userEvent.click(canvas.getByRole('button', { name: 'Page settings' }));
    await expect(args.onOpenMetadata).toHaveBeenCalledTimes(1);
    await userEvent.click(canvas.getByRole('button', { name: 'Exit editor' }));
    await expect(args.onBack).toHaveBeenCalledTimes(1);
  },
};

/**
 * A site that cannot preview keeps the control, marked unavailable with the
 * reason in its name and tooltip; a click still reaches the editor so it can
 * explain, which a `disabled` button would swallow. Puck mounts these actions
 * inside its MenuBar, whose hashed class name the editor's global styles
 * match, so the story mounts them the same way.
 */
export const PreviewUnavailable: Story = {
  args: { previewDisabledReason: 'This site has no preview address yet.' },
  decorators: [
    (Story) => (
      <div className="_MenuBar_story">
        <Story />
      </div>
    ),
  ],
  play: async ({ args, canvasElement }) => {
    const preview = within(canvasElement).getByRole('button', {
      name: 'Preview unavailable. This site has no preview address yet.',
    });
    await expect(preview).toHaveAttribute('aria-disabled', 'true');
    await expect(preview).toHaveAttribute('title', 'This site has no preview address yet.');
    await userEvent.click(preview);
    await expect(args.onPreview).toHaveBeenCalledTimes(1);
  },
};

/** Nothing changed since the last save: Save is disabled and a click does nothing. */
export const NothingToSave: Story = {
  args: { isDirty: false },
  play: async ({ args, canvasElement }) => {
    const save = within(canvasElement).getByRole('button', { name: 'Save' });
    await expect(save).toBeDisabled();
    await userEvent.click(save);
    await expect(args.onSave).not.toHaveBeenCalled();
  },
};

/** Just saved and clean again: the button says Saved and stays disabled. */
export const JustSaved: Story = {
  args: { isDirty: false, saveState: 'saved' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Saved' })).toBeDisabled();
  },
};

/** A failed save stays clickable even with no new edits, so the same content can be retried. */
export const SaveFailedRetries: Story = {
  args: { isDirty: false, saveState: 'error' },
  play: async ({ args, canvasElement }) => {
    const retry = within(canvasElement).getByRole('button', { name: 'Error' });
    await expect(retry).toBeEnabled();
    await userEvent.click(retry);
    await expect(args.onSave).toHaveBeenCalledTimes(1);
  },
};

/** A save refused as stale says Conflict and stays clickable, so the editor can reopen the conflict choice. */
export const SaveConflict: Story = {
  args: { isDirty: false, saveState: 'conflict' },
  play: async ({ args, canvasElement }) => {
    const conflict = within(canvasElement).getByRole('button', { name: 'Conflict' });
    await expect(conflict).toBeEnabled();
    await userEvent.click(conflict);
    await expect(args.onSave).toHaveBeenCalledTimes(1);
  },
};

/** The canvas theme toggle names the current theme and the one a click switches to. */
export const CanvasThemeToggle: Story = {
  beforeEach: () => {
    localStorage.removeItem('conloca-canvas-theme');
    return () => localStorage.removeItem('conloca-canvas-theme');
  },
  render: (args) => (
    <CanvasThemeProvider>
      <PageEditorHeaderActions {...args} />
    </CanvasThemeProvider>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Canvas theme: light (click for dark)' }));
    await expect(canvas.getByRole('button', { name: 'Canvas theme: dark (click for light)' })).toBeVisible();
  },
};

/** A page in several locales shows a labelled locale picker; picking one hands it to the editor. */
export const SeveralLocales: Story = {
  args: { availableLocales: ['en', 'de'], onLocaleChange: fn() },
  play: async ({ args, canvasElement }) => {
    const picker = within(canvasElement).getByRole('combobox', { name: 'Locale' });
    await expect(picker).toHaveTextContent('en');
    await userEvent.click(picker);
    await userEvent.click(await within(document.body).findByRole('option', { name: 'de' }));
    await expect(args.onLocaleChange).toHaveBeenCalledWith('de');
  },
};

/** One locale needs no picker. */
export const SingleLocale: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('combobox', { name: 'Locale' })).toBeNull();
  },
};

/**
 * With `hosted: true`, Save remains: it keeps the draft, and the host app's
 * own publish step is separate.
 */
export const SaveStaysWhenEmbedded: Story = {
  beforeEach: () => {
    configureUI({ ...getUIConfig(), hosted: true, hideEditorSave: false });
  },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Save' }));
    await expect(args.onSave).toHaveBeenCalledTimes(1);
  },
};

/** A host whose chrome is the only save affordance opts out with `hideEditorSave`; Preview remains. */
export const SaveHiddenByHost: Story = {
  beforeEach: () => {
    configureUI({ ...getUIConfig(), hideEditorSave: true });
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('button', { name: 'Save' })).toBeNull();
    await expect(canvas.getByRole('button', { name: 'Preview' })).toBeVisible();
  },
};
