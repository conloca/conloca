import type { ComponentConfig } from '@puckeditor/core';
import type { WithLayout } from '../../Layout';
import { withLayout } from '../../Layout';
import { Section } from '../../Section';
import { colors, typography } from '../shared/tokens';

export type TextProps = WithLayout<{
  align: 'left' | 'center' | 'right';
  text?: string;
  size?: 's' | 'm';
  color: 'default' | 'muted';
  maxWidth?: string;
}>;

const TextInner: ComponentConfig<TextProps> = {
  fields: {
    text: {
      type: 'textarea',
      contentEditable: true,
    },
    size: {
      type: 'select',
      options: [
        { label: 'S', value: 's' },
        { label: 'M', value: 'm' },
      ],
    },
    align: {
      type: 'radio',
      options: [
        { label: 'Left', value: 'left' },
        { label: 'Center', value: 'center' },
        { label: 'Right', value: 'right' },
      ],
    },
    color: {
      type: 'radio',
      options: [
        { label: 'Default', value: 'default' },
        { label: 'Muted', value: 'muted' },
      ],
    },
    maxWidth: { type: 'text' },
  },
  defaultProps: {
    align: 'left',
    text: 'Text',
    size: 'm',
    color: 'default',
  },
  render: ({ align, color, text, size, maxWidth }) => {
    const fontSize = size === 's' ? typography.text.sm.fontSize : typography.text.md.fontSize;
    const lineHeight = size === 's' ? typography.text.sm.lineHeight : typography.text.md.lineHeight;
    const textColor = color === 'muted' ? colors.text.secondary : colors.text.primary;

    return (
      <Section maxWidth={maxWidth}>
        <div style={{ maxWidth }}>
          <p
            style={{
              fontFamily: typography.fonts.body,
              fontSize,
              lineHeight,
              fontWeight: typography.weights.regular,
              color: textColor,
              textAlign: align,
              margin: 0,
              display: 'block',
              width: '100%',
            }}
          >
            {text}
          </p>
        </div>
      </Section>
    );
  },
};

export const Text = withLayout(TextInner);
