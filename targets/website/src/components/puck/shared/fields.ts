import type { ArrayField } from '@puckeditor/core';

export type CTAButton = {
  id: string;
  label: string;
  href: string;
  variant: 'primary' | 'secondary';
};

/**
 * Shared field definition for CTA button arrays used across Hero, CTABanner,
 * ComparisonTable, FAQ, and other section components.
 *
 * Note: contentEditable on arrayFields has no effect — Puck only supports
 * inline canvas editing for top-level text/textarea/richtext fields, not
 * fields inside array or object items.
 */
export function ctaButtonArrayField(
  overrides?: Partial<Pick<ArrayField<CTAButton[]>, 'min' | 'max'>>,
): ArrayField<CTAButton[]> {
  return {
    type: 'array',
    min: 1,
    max: 4,
    ...overrides,
    getItemSummary: (item) => item.label || 'Button',
    defaultItemProps: () => ({
      id: crypto.randomUUID(),
      label: 'Button',
      href: '#',
      variant: 'primary' as const,
    }),
    arrayFields: {
      id: { type: 'text', visible: false },
      label: { type: 'text' },
      href: { type: 'text' },
      variant: {
        type: 'radio',
        options: [
          { label: 'Primary', value: 'primary' },
          { label: 'Secondary', value: 'secondary' },
        ],
      },
    },
  };
}
