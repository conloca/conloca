import type { Meta, StoryObj } from '@storybook/react-vite';
import { Separator } from './Separator';

// A96 canary: smoke-renders a pure leaf component (spec 14 §Storybook adoption).
const meta = {
  component: Separator,
} satisfies Meta<typeof Separator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Vertical: Story = {};

export const Horizontal: Story = {
  args: {
    orientation: 'horizontal',
  },
};
