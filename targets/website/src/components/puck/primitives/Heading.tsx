import type { ComponentConfig } from '@puckeditor/core';
import type React from 'react';
import type { WithLayout } from '../../Layout';
import { withLayout } from '../../Layout';
import { Section } from '../../Section';
import { colors, typography } from '../shared/tokens';

export type HeadingProps = WithLayout<{
  align: 'left' | 'center' | 'right';
  text?: string;
  level?: '1' | '2' | '3' | '4' | '5' | '6';
  size: 'xxxl' | 'xxl' | 'xl' | 'l' | 'm' | 's' | 'xs';
}>;

const sizeOptions = [
  { value: 'xxxl', label: 'XXXL' },
  { value: 'xxl', label: 'XXL' },
  { value: 'xl', label: 'XL' },
  { value: 'l', label: 'L' },
  { value: 'm', label: 'M' },
  { value: 's', label: 'S' },
  { value: 'xs', label: 'XS' },
];

const levelOptions = [
  { label: '1', value: '1' },
  { label: '2', value: '2' },
  { label: '3', value: '3' },
  { label: '4', value: '4' },
  { label: '5', value: '5' },
  { label: '6', value: '6' },
];

/** Maps Puck size tokens to display typography values */
const sizeStyleMap: Record<string, React.CSSProperties> = {
  xxxl: { fontSize: typography.display.lg.fontSize, lineHeight: typography.display.lg.lineHeight },
  xxl: { fontSize: typography.display.md.fontSize, lineHeight: typography.display.md.lineHeight },
  xl: { fontSize: typography.display.sm.fontSize, lineHeight: typography.display.sm.lineHeight },
  l: { fontSize: typography.display.xs.fontSize, lineHeight: typography.display.xs.lineHeight },
  m: { fontSize: typography.text.xl.fontSize, lineHeight: typography.text.xl.lineHeight },
  s: { fontSize: typography.text.lg.fontSize, lineHeight: typography.text.lg.lineHeight },
  xs: { fontSize: typography.text.md.fontSize, lineHeight: typography.text.md.lineHeight },
};

const HeadingInternal: ComponentConfig<HeadingProps> = {
  fields: {
    text: {
      type: 'textarea',
      contentEditable: true,
    },
    size: {
      type: 'select',
      options: sizeOptions,
    },
    level: {
      type: 'select',
      options: levelOptions,
    },
    align: {
      type: 'radio',
      options: [
        { label: 'Left', value: 'left' },
        { label: 'Center', value: 'center' },
        { label: 'Right', value: 'right' },
      ],
    },
  },
  defaultProps: {
    align: 'left',
    text: 'Heading',
    size: 'm',
    level: '2',
    layout: {
      padding: '8px',
    },
  },
  render: ({ align, text, size, level = '2' }) => {
    const HeadingTag = `h${level}` as React.ElementType;
    const sizeStyle = sizeStyleMap[size] || sizeStyleMap.m;

    return (
      <Section>
        <HeadingTag
          style={{
            ...sizeStyle,
            fontFamily: typography.fonts.body,
            fontWeight: typography.weights.bold,
            color: colors.text.heading,
            textAlign: align,
            margin: 0,
            display: 'block',
            width: '100%',
          }}
        >
          {text}
        </HeadingTag>
      </Section>
    );
  },
};

export const Heading = withLayout(HeadingInternal);
