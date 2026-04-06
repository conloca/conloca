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
    defaultItemProps: {
      id: `btn-${crypto.randomUUID()}`,
      label: 'Button',
      href: '#',
      variant: 'primary' as const,
    },
    arrayFields: {
      id: { type: 'text', visible: false },
      label: { type: 'text', contentEditable: true },
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
