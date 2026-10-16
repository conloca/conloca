import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import '../../main.css';
import { articleFields, profileFields } from '../../../test/fixtures/typia/host-schemas.js';
import { setPageSchemas } from '../../page-schemas.js';
import type { PageMetadata } from '../../types.js';
import { PageMetadataDialog } from './PageMetadataDialog.js';

function page(pathname: string, title: string): PageMetadata {
  return {
    title,
    pathname,
    description: '',
    customMeta: {},
    publishDate: null,
    unpublishDate: null,
    collection: 'pages',
    type: 'puck',
  };
}

/**
 * The page-settings dialog rendering a site's fields from Typia host schemas:
 * the fixtures are compiled by the native Typia transform (see
 * `.storybook/typia-fixtures.ts`), so the form is built from generated
 * `typia.json.schema<T>()` metadata exactly as a host build ships it.
 */
const meta = {
  title: 'Editor/PageMetadataHostSchema',
  component: PageMetadataDialog,
  parameters: { layout: 'fullscreen' },
  args: { open: true, page: page('/blog/typia', 'Typia host schemas') },
  // The registry is page-global; other stories in the same frame expect it empty.
  beforeEach: () => {
    setPageSchemas({ '/blog/': articleFields, '/team/': profileFields });
    return () => setPageSchemas({});
  },
} satisfies Meta<typeof PageMetadataDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

/** JSDoc comments become help text; `tags.MaxLength` becomes a length counter. */
export const BlogPostFields: Story = {
  play: async ({ canvasElement }) => {
    const view = within(canvasElement.ownerDocument.body);
    const dialog = await view.findByRole('dialog');
    await expect(within(dialog).getByRole('textbox', { name: /^Author/ })).toBeInTheDocument();
    await expect(within(dialog).getByText('Byline shown on cards')).toBeInTheDocument();
    await expect(within(dialog).getByRole('textbox', { name: /^Excerpt/ })).toBeInTheDocument();
  },
};

/** Enum, boolean, number, date-time, email and URL fields from one generated schema. */
export const ProfileFields: Story = {
  args: { page: page('/team/ada', 'Ada Lovelace') },
  play: async ({ canvasElement }) => {
    const view = within(canvasElement.ownerDocument.body);
    const dialog = await view.findByRole('dialog');
    await expect(within(dialog).getByRole('textbox', { name: /^Contact/ })).toHaveAttribute('type', 'email');
    await expect(within(dialog).getByRole('textbox', { name: /^Homepage/ })).toHaveAttribute('type', 'url');
    await expect(within(dialog).getByRole('checkbox', { name: /^Featured/ })).toBeInTheDocument();
    await expect(within(dialog).getByLabelText(/^Reviewed At/)).toHaveAttribute('type', 'datetime-local');
  },
};
