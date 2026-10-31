import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import '../../main.css';
import { configureUI, getUIConfig } from '../../ui-config.js';
import { DocsPreviewButton } from './DocsPreviewButton.js';

const meta = {
  title: 'Editor/DocsPreviewButton',
  component: DocsPreviewButton,
  // The UI config is module state shared with every other story in the same
  // Storybook preview, so put back whatever was installed rather than defaults.
  beforeEach: () => {
    const previous = getUIConfig();
    configureUI({ ...previous, openPreview: async () => ({ ok: true, url: 'https://site.test/' }) });
    return () => configureUI(previous);
  },
} satisfies Meta<typeof DocsPreviewButton>;
export default meta;

export const InTheWorkspaceEditor: StoryObj<typeof meta> = {
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: /Preview/ });
    await expect(button.getAttribute('aria-disabled')).toBe('true');
  },
};
