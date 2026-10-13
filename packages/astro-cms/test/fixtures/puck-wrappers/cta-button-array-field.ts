/**
 * A field builder copied from a real site's Puck config, where six fields are
 * declared by calling it: every one of them read as a prop with no shape at all
 * before the reader could follow the call.
 *
 * A real module rather than a source string, like the wrapper fixtures beside
 * it, because the suite that reads it also RUNS it — a string could only ever
 * be compared against another reading of itself.
 */

/** What the builder returns, written locally so the fixture runs without Puck's types. */
export interface FieldLike {
  type: string;
  min?: number;
  max?: number;
  arrayFields?: Record<string, { type: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

let defaultIdCounter = 0;
function defaultId(): string {
  defaultIdCounter += 1;
  return `default-${defaultIdCounter}`;
}

export function ctaButtonArrayField(overrides?: { min?: number; max?: number }): FieldLike {
  return {
    type: 'array',
    min: 1,
    max: 4,
    ...overrides,
    getItemSummary: (item: { label?: string }) => item.label || 'Button',
    defaultItemProps: () => ({ id: defaultId(), label: 'Button', href: '#', variant: 'primary' }),
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

export const Field = ctaButtonArrayField();
