import type { ComponentConfig } from '@puckeditor/core';
import type { WithLayout } from '../../Layout';
import { withLayout } from '../../Layout';
import { Section } from '../../Section';
import { colors, typography } from '../shared/tokens';

type TextSize = 'xs' | 's' | 'm' | 'l' | 'xl';
type TextWeight = 'regular' | 'medium' | 'semibold';

const sizeMap: Record<TextSize, { fontSize: string; lineHeight: string }> = {
  xs: typography.text.xs,
  s: typography.text.sm,
  m: typography.text.md,
  l: typography.text.lg,
  xl: typography.text.xl,
};

export type TextProps = WithLayout<{
  align: 'left' | 'center' | 'right';
  text?: string;
  size?: TextSize;
  weight?: TextWeight;
  color: 'default' | 'muted';
  maxWidth?: string;
}>;

const TextInner: ComponentConfig<TextProps> = {
  fields: {
    text: {
      type: 'text',
      label: 'Text',
      contentEditable: true,
    },
    size: {
      type: 'select',
      label: 'Size',
      options: [
        { label: 'XS', value: 'xs' },
        { label: 'S', value: 's' },
        { label: 'M', value: 'm' },
        { label: 'L', value: 'l' },
        { label: 'XL', value: 'xl' },
      ],
    },
    weight: {
      type: 'radio',
      label: 'Weight',
      options: [
        { label: 'Regular', value: 'regular' },
        { label: 'Medium', value: 'medium' },
        { label: 'Semibold', value: 'semibold' },
      ],
    },
    align: {
      type: 'radio',
      label: 'Alignment',
      options: [
        { label: 'Left', value: 'left' },
        { label: 'Center', value: 'center' },
        { label: 'Right', value: 'right' },
      ],
    },
    color: {
      type: 'radio',
      label: 'Color',
      options: [
        { label: 'Default', value: 'default' },
        { label: 'Muted', value: 'muted' },
      ],
    },
    maxWidth: { type: 'text', label: 'Max Width', placeholder: 'e.g. 600px' },
  },
  defaultProps: {
    align: 'left',
    text: 'Text',
    size: 'm',
    weight: 'regular',
    color: 'default',
  },
  render: ({ align, color, text, size = 'm', weight = 'regular', maxWidth }) => {
    const { fontSize, lineHeight } = sizeMap[size];
    const textColor = color === 'muted' ? colors.text.secondary : colors.text.primary;

    return (
      <Section maxWidth={maxWidth}>
        <p
          style={{
            fontFamily: typography.fonts.body,
            fontSize,
            lineHeight,
            fontWeight: typography.weights[weight],
            color: textColor,
            textAlign: align,
            margin: 0,
            display: 'block',
            width: '100%',
          }}
        >
          {text}
        </p>
      </Section>
    );
  },
};

export const Text = withLayout(TextInner);
