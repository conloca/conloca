import type { Meta, StoryObj } from '@storybook/react-vite';
import { Separator } from './Separator.js';

// Canary: smoke-renders a pure leaf component.
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
