import { type Config, Puck, type Slot } from '@puckeditor/core';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { DrawerItemOverride } from './DrawerItemOverride.js';

/**
 * The drawer's double-click and Enter shortcut, run inside the real Puck editor.
 *
 * The shortcut must insert a block exactly the way dragging it from the drawer
 * does: a block Puck will not let the author drag in stays out, the children a
 * block's defaults seed into a slot get ids, and the block's data resolver runs.
 * Each story mounts a fresh editor on an empty page with one block of each kind.
 */

type Blocks = {
  Locked: Record<string, unknown>;
  Open: Record<string, unknown>;
  Template: { content: Slot };
  Resolved: { label: string };
};

const config: Config<Blocks> = {
  components: {
    Locked: { permissions: { insert: false }, render: () => <p data-testid="locked-block">locked</p> },
    Open: {
      render: ({ id }) => (
        <p data-testid="open-block" data-block-id={id}>
          open
        </p>
      ),
    },
    Template: {
      fields: { content: { type: 'slot' } },
      defaultProps: { content: [{ type: 'Open', props: {} }] },
      render: ({ content: Content }) => <Content />,
    },
    Resolved: {
      defaultProps: { label: 'default' },
      resolveData: async () => ({ props: { label: 'resolved' } }),
      render: ({ label }) => <p data-testid="resolved-block">{label}</p>,
    },
  },
};

const overrides = {
  drawerItem: ({ children, name }: { children: ReactNode; name: string }) => (
    <DrawerItemOverride name={name}>{children}</DrawerItemOverride>
  ),
};

/**
 * Puck draws each drawer item twice: a still backdrop the pointer passes
 * through, and the draggable copy on top of it, which Puck tags
 * `drawer-item:<name>`. The author's clicks and keys land on the copy on top.
 */
function drawerItem(canvasElement: HTMLElement, name: string): HTMLElement {
  const draggable = within(canvasElement).getByTestId(`drawer-item:${name}`);
  return within(draggable).getByTestId(`drawer-item-${name}`);
}

const meta = {
  title: 'Editor/DrawerItemOverride',
  component: DrawerItemOverride,
  parameters: { layout: 'fullscreen' },
  render: () => (
    <Puck
      config={config}
      data={{ content: [], root: { props: {} } }}
      iframe={{ enabled: false }}
      overrides={overrides}
    />
  ),
} satisfies Meta;

export default meta;
// No args: Puck renders the component once per drawer block, with that block's name.
type Story = StoryObj;

/**
 * A block whose insert permission is off stays off the page, whether the
 * author double-clicks it or presses Enter on it.
 */
export const ABlockThatMayNotBeInsertedStaysOffThePage: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.dblClick(drawerItem(canvasElement, 'Locked'));
    drawerItem(canvasElement, 'Locked').focus();
    await userEvent.keyboard('{Enter}');

    // An insert made after both attempts has rendered, so a locked block
    // either attempt had placed would be on the page by now.
    await userEvent.dblClick(drawerItem(canvasElement, 'Open'));
    await within(canvasElement).findByTestId('open-block');
    expect(within(canvasElement).queryAllByTestId('locked-block')).toHaveLength(0);
  },
};

/** Double-clicking an insertable block puts it on the page. */
export const DoubleClickingABlockPutsItOnThePage: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.dblClick(drawerItem(canvasElement, 'Open'));
    expect(await within(canvasElement).findByTestId('open-block')).toHaveTextContent('open');
  },
};

/** The children a block's defaults seed into its slot each get an id, as they do when the block is dragged in. */
export const ChildrenSeededIntoASlotGetIds: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.dblClick(drawerItem(canvasElement, 'Template'));
    const seeded = await within(canvasElement).findByTestId('open-block');
    expect(seeded.dataset.blockId).toBeTruthy();
  },
};

/** A block inserted by double-click has its data resolved, as it does when dragged in. */
export const ADoubleClickedBlockHasItsDataResolved: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.dblClick(drawerItem(canvasElement, 'Resolved'));
    await waitFor(() => expect(within(canvasElement).getByTestId('resolved-block')).toHaveTextContent('resolved'));
  },
};
