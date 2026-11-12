import { ContentAPIClient, getContentAPIClient, setContentAPIClient } from '@conloca/content-api-client';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import '../../main.css';
import { configureUI, getUIConfig } from '../../ui-config.js';
import { CreatePageDialog } from './CreatePageDialog.js';

/**
 * The Template field of the Create New Page dialog. It is the shared Select, so it shows a chevron
 * and rings on hover and focus: authors can tell that the field is a dropdown, not a text input.
 * The content API answers in memory, with every path free.
 */

async function respond(): Promise<Response> {
  return new Response(JSON.stringify({ available: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const meta = {
  component: CreatePageDialog,
  parameters: { layout: 'fullscreen' },
  args: { open: true, onOpenChange: fn(), onCreatePage: fn(), site: 'default' },
  // The UI config and the content client are module state shared with every other story in the
  // preview, so put back what was installed rather than defaults.
  beforeEach: () => {
    const previousConfig = getUIConfig();
    const previousClient = getContentAPIClient();
    setContentAPIClient(new ContentAPIClient({ fetch: Object.assign(respond, { preconnect: fetch.preconnect }) }));
    configureUI({
      ...previousConfig,
      templates: {
        blog: { label: 'Blog Post', component: 'BlogPostTemplate', pathPrefix: '/blog/' },
        landing: { label: 'Landing page', component: 'LandingTemplate', description: 'Hero and sections' },
      },
    });
    return () => {
      configureUI(previousConfig);
      setContentAPIClient(previousClient);
    };
  },
} satisfies Meta<typeof CreatePageDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Closed: Blank is shown under the Template label, with the dropdown chevron drawn. */
export const TemplateSelectorClosed: Story = {
  play: async () => {
    const dialog = within(document.body);
    const select = await dialog.findByRole('combobox', { name: 'Template' });
    await expect(select).toHaveDisplayValue('Blank');
    await expect(decodeURIComponent(getComputedStyle(select).backgroundImage)).toContain('<svg');
    await expect(getComputedStyle(select).appearance).toBe('none');
  },
};

/** The selector carries the hover ring (its rule is checked in the Select stories) and takes the focus ring. */
export const TemplateSelectorHoverAndFocus: Story = {
  play: async () => {
    const dialog = within(document.body);
    const select = await dialog.findByRole('combobox', { name: 'Template' });
    await expect(getComputedStyle(select).boxShadow).toBe('none');
    await expect(select).toHaveClass('enabled:hover:not-focus:ring-1');
    select.focus();
    await expect(select).toHaveFocus();
    await expect(getComputedStyle(select).boxShadow).not.toBe('none');
  },
};

/** Every configured template is offered next to Blank, with its description when it has one. */
export const TemplateSelectorListsOptions: Story = {
  play: async () => {
    const dialog = within(document.body);
    const select = await dialog.findByRole('combobox', { name: 'Template' });
    const labels = within(select)
      .getAllByRole('option')
      .map((option) => option.textContent);
    await expect(labels).toEqual(['Blank', 'Blog Post', 'Landing page - Hero and sections']);
  },
};

/** Regression: choosing a template still changes the value and moves the path under the template's prefix. */
export const SelectingTemplateChangesValueAndPath: Story = {
  play: async () => {
    const dialog = within(document.body);
    await userEvent.type(await dialog.findByTestId('page-title-input'), 'Hello');
    await expect(dialog.getByTestId('page-path-input')).toHaveValue('/hello');
    const select = dialog.getByRole('combobox', { name: 'Template' });
    await userEvent.selectOptions(select, 'Blog Post');
    await expect(select).toHaveValue('blog');
    await expect(dialog.getByTestId('page-path-input')).toHaveValue('/blog/hello');
  },
};

/** Tab from the path field lands on the Template selector, then on the Create button. */
export const TemplateSelectorKeyboardOrder: Story = {
  play: async () => {
    const dialog = within(document.body);
    // Create takes focus only when enabled, so give the page a title and wait for the path check.
    await userEvent.type(await dialog.findByTestId('page-title-input'), 'Hello');
    await waitFor(() => expect(dialog.getByTestId('create-page-submit')).toBeEnabled());
    await userEvent.click(dialog.getByTestId('page-path-input'));
    await userEvent.tab();
    await expect(dialog.getByRole('combobox', { name: 'Template' })).toHaveFocus();
    await userEvent.tab();
    await expect(dialog.getByTestId('create-page-submit')).toHaveFocus();
  },
};

/** The template dialog stays centered and fully visible at a phone viewport. */
export const TemplateDialogFitsOnPhone: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  play: async () => {
    await expect(window.innerWidth).toBe(320);
    const dialog = await within(document.body).findByRole('dialog', { name: 'Create New Page' });
    const rect = dialog.getBoundingClientRect();
    await expect(rect.left).toBeGreaterThanOrEqual(0);
    await expect(rect.right).toBeLessThanOrEqual(window.innerWidth);
    await expect(Math.abs(rect.left - (window.innerWidth - rect.right))).toBeLessThanOrEqual(1);
  },
};
