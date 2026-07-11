import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './Button';

// A96 canary: smoke-renders a pure leaf component (spec 14 §Storybook adoption).
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
