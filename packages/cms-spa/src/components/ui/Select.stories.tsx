import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';
import '../../main.css';
import { Select } from './Select.js';

/**
 * The form select: a native `<select>` (so the combobox role, label association and keyboard
 * behaviour come from the browser) drawn with a visible chevron, so it reads as a dropdown and not
 * as a text field. The chevron is a background image whose colour is fixed per theme: an SVG
 * background cannot inherit `currentColor`. It used to be an arbitrary class whose data URI held
 * spaces, so the class attribute split it and no chevron was ever drawn.
 */

function TemplateSelect({ initial = 'blank' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <div className="w-80 p-6 space-y-2 bg-overlay">
      <label htmlFor="template" className="block text-sm font-medium text-grey-01 dark:text-grey-12">
        Template
      </label>
      <Select id="template" value={value} onChange={(e) => setValue(e.target.value)}>
        <option value="blank">Blank</option>
        <option value="blog">Blog Post</option>
        <option value="landing">Landing page</option>
      </Select>
    </div>
  );
}

const meta = {
  component: Select,
  parameters: { layout: 'centered' },
  render: () => <TemplateSelect />,
  // The theme lives on <html>, shared with every story in the preview (a dashboard story can leave
  // `dark` there): the light stories need it off, and it goes back as it was.
  beforeEach: () => {
    const root = document.documentElement;
    const wasDark = root.classList.contains('dark');
    root.classList.remove('dark');
    return () => root.classList.toggle('dark', wasDark);
  },
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The select paints a chevron, sits as a combobox named by its label, and shows the current option. */
async function expectsDropdownAffordance(canvasElement: HTMLElement, chevronStroke: string) {
  const select = within(canvasElement).getByRole('combobox', { name: 'Template' });
  await expect(select).toHaveDisplayValue('Blank');
  const style = getComputedStyle(select);
  await expect(style.appearance).toBe('none');
  await expect(style.cursor).toBe('pointer');
  // tailwind-merge must keep the panel colour, the right-side position and the room for the chevron.
  await expect(style.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  await expect(style.backgroundPositionX).not.toBe('0%');
  await expect(Number.parseFloat(style.paddingRight)).toBeGreaterThanOrEqual(36);
  await expect(decodeURIComponent(style.backgroundImage)).toContain(`stroke='${chevronStroke}'`);
  return select;
}

/** Closed, light theme: the chevron is the grey of the light theme, not the invisible default. */
export const Closed: Story = {
  play: async ({ canvasElement }) => {
    await expectsDropdownAffordance(canvasElement, '#5a5a5a');
  },
};

/** Closed, dark theme: the chevron is light grey; it was black on the dark panel. */
export const ClosedDark: Story = {
  render: () => (
    <div className="dark">
      <TemplateSelect />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expectsDropdownAffordance(canvasElement, '#c3c3c3');
  },
};

// A real `:hover` pseudo-class is the one not escaped by a backslash: the class names hold `\:hover`.
const realHover = /(?<!\\):hover/;

/** Every style rule of the loaded sheets, nested ones (`@media (hover: hover)`) included. */
function allRules(rules: CSSRuleList): CSSRule[] {
  const flattened: CSSRule[] = [];
  for (const rule of rules) {
    flattened.push(rule);
    if (rule instanceof CSSGroupingRule || rule instanceof CSSStyleRule) {
      for (const nested of allRules(rule.cssRules)) {
        flattened.push(nested);
      }
    }
  }
  return flattened;
}

/**
 * Hovering rings the select in the accent colour. The synthetic pointer of `userEvent.hover` never
 * switches the browser's `:hover` state on, so the story checks that the select carries the hover
 * utilities and that the stylesheet really defines a hover rule that draws the ring; at rest the
 * select has no ring.
 */
export const HoverRing: Story = {
  play: async ({ canvasElement }) => {
    const select = await expectsDropdownAffordance(canvasElement, '#5a5a5a');
    await expect(getComputedStyle(select).boxShadow).toBe('none');
    await expect(select).toHaveClass('enabled:hover:not-focus:ring-1', 'enabled:hover:not-focus:ring-azure-04');
    // Rules are matched by the select's own utility classes, so another component's hover ring cannot
    // satisfy the check. The rule of `enabled:` makes a disabled select ring-free.
    const rules = Array.from(document.styleSheets)
      .flatMap((sheet) => allRules(sheet.cssRules))
      .filter((rule) => rule instanceof CSSStyleRule)
      .filter((rule) => realHover.test(rule.cssText));
    const ruleOf = (utility: string) =>
      rules.find((rule) => rule.cssText.includes(`.${utility.replaceAll(':', '\\:')}`));
    const width = ruleOf('enabled:hover:not-focus:ring-1');
    const color = ruleOf('enabled:hover:not-focus:ring-azure-04');
    await expect(width?.cssText).toContain('--tw-ring-shadow');
    await expect(color?.cssText).toContain('--tw-ring-color');
    await expect(width?.cssText).toContain(':enabled');
  },
};

/** Tab reaches the select and it takes the focus ring. */
export const KeyboardFocus: Story = {
  play: async ({ canvasElement }) => {
    const select = await expectsDropdownAffordance(canvasElement, '#5a5a5a');
    await userEvent.tab();
    await expect(select).toHaveFocus();
    await expect(getComputedStyle(select).boxShadow).not.toBe('none');
  },
};

/** The options are the select's own: all of them are listed, the first is chosen, and picking another changes the value. */
export const OpensWithOptionsAndChangesValue: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const select = await expectsDropdownAffordance(canvasElement, '#5a5a5a');
    const options = canvas.getAllByRole('option').map((option) => option.textContent);
    await expect(options).toEqual(['Blank', 'Blog Post', 'Landing page']);
    await userEvent.selectOptions(select, 'Blog Post');
    await expect(select).toHaveValue('blog');
    await expect(select).toHaveDisplayValue('Blog Post');
  },
};

/**
 * A native popup needs trusted browser input, so this story runs in the browser test runner only.
 * Synthetic selectOptions can change the value without ever opening the dropdown.
 */
export const NativeMenuOpensAndSelectsByKeyboard: Story = {
  tags: ['!dev', '!autodocs'],
  play: async ({ canvasElement }) => {
    const select = await expectsDropdownAffordance(canvasElement, '#5a5a5a');
    const { userEvent: browserUserEvent } = await import('vitest/browser');
    await expect(select.matches(':open')).toBe(false);
    try {
      await browserUserEvent.click(select);
      await expect(select.matches(':open')).toBe(true);
      await browserUserEvent.keyboard('{ArrowDown}{Enter}');
      await expect(select.matches(':open')).toBe(false);
      await expect(select).toHaveValue('blog');
      await expect(select).toHaveDisplayValue('Blog Post');
    } finally {
      await browserUserEvent.keyboard('{Escape}');
      // Park the real pointer away from centered content in subsequent stories.
      await browserUserEvent.unhover(select, { position: { x: 0, y: 0 } });
    }
  },
};

/** A disabled select stops looking interactive: no pointer cursor and no hover ring. */
export const Disabled: Story = {
  render: () => (
    <div className="w-80 p-6 bg-overlay">
      <Select aria-label="Template" disabled defaultValue="blank">
        <option value="blank">Blank</option>
      </Select>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const select = within(canvasElement).getByRole('combobox', { name: 'Template' });
    await expect(select).toBeDisabled();
    await expect(getComputedStyle(select).cursor).toBe('not-allowed');
    await expect(getComputedStyle(select).boxShadow).toBe('none');
  },
};
