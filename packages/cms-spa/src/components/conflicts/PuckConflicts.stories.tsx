import { formatPlaceAnchor } from '@conloca/content-api/merge';
import { Puck } from '@puckeditor/core';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { clash, config, data, fakeTools, PAGE, setUp, WithQueries } from '../../../test/draft-page-stories.js';
import '../../main.css';
import { FieldsWithPageSettingsHint } from '../editor/page-setting-targets.js';
import { DraftPageContext, PuckNoticeStrip } from './PuckConflicts.js';

/** The Puck editor's panels: the strip counts and links; the selected block's fields panel holds its picker. */
function PuckWithConflicts() {
  return (
    <WithQueries>
      <DraftPageContext.Provider value={{ page: PAGE }}>
        <Puck
          config={config}
          data={data}
          iframe={{ enabled: false }}
          overrides={{
            fields: FieldsWithPageSettingsHint,
            puck: ({ children }) => (
              <>
                <PuckNoticeStrip />
                {children}
              </>
            ),
          }}
        />
      </DraftPageContext.Provider>
    </WithQueries>
  );
}

const meta = {
  component: PuckNoticeStrip,
  render: () => <PuckWithConflicts />,
} satisfies Meta<typeof PuckNoticeStrip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PickerOnSelectedBlock: Story = {
  beforeEach: setUp(fakeTools([[clash()]])),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const strip = await canvas.findByRole('navigation', { name: 'Fields that need a decision' });
    await expect(within(strip).getByRole('status')).toHaveTextContent('1 field needs a decision');
    await expect(within(strip).queryByRole('group')).toBeNull();
    await expect(canvas.queryByRole('group', { name: /from GitHub/ })).toBeNull();

    await userEvent.click(within(strip).getByRole('button', { name: 'Hero title on Hero' }));
    const picker = await canvas.findByRole('group', { name: /Hero title on Hero, from GitHub/ });
    // Puck's own input for the title, in the same fields panel.
    const heroField = picker.closest('form')?.querySelector('input[name="title"]');
    if (!heroField) throw new Error('the Hero fields did not open beside the picker');
    // The picker sits above the block's own fields.
    await expect(picker.compareDocumentPosition(heroField) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  },
};

/** Clashes no block field owns: a block's position opens its block; the whole page opens the page settings panel. */
export const PickerForPlaceAndPage: Story = {
  beforeEach: setUp(
    fakeTools([[clash({ anchor: formatPlaceAnchor('hero-1') }), clash({ anchor: '', valueId: 'v2' })]]),
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const strip = await canvas.findByRole('navigation', { name: 'Fields that need a decision' });
    // Nothing selected: the page settings panel holds the whole-page picker, not the block's.
    await expect(await canvas.findByRole('group', { name: /the whole page, from GitHub/ })).toBeVisible();
    await expect(canvas.queryByRole('group', { name: /where Hero sits/ })).toBeNull();

    await userEvent.click(within(strip).getByRole('button', { name: 'where Hero sits on Hero' }));
    await expect(await canvas.findByRole('group', { name: /where Hero sits on Hero, from GitHub/ })).toBeVisible();
    await expect(canvas.queryByRole('group', { name: /the whole page/ })).toBeNull();

    await userEvent.click(within(strip).getByRole('button', { name: 'the whole page' }));
    await expect(await canvas.findByRole('group', { name: /the whole page, from GitHub/ })).toBeVisible();
  },
};
