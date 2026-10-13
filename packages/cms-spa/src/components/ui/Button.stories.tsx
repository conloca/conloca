import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './Button.js';

// Canary: smoke-renders a pure leaf component.
const meta = {
  component: Button,
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {
    children: 'Save',
  },
};

export const Destructive: Story = {
  args: {
    variant: 'destructive',
    children: 'Delete page',
  },
};
