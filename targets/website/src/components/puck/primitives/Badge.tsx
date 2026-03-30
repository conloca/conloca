import type { ComponentConfig } from '@puckeditor/core';
import type { CSSProperties } from 'react';
import { colors, radius, typography } from '../shared/tokens';

type BadgeColor = 'brand' | 'green' | 'gray';
type BadgeSize = 'sm' | 'md';

export type BadgeProps = {
  label: string;
  color: BadgeColor;
  size: BadgeSize;
};

const getBadgeStyle = (color: BadgeColor, size: BadgeSize): CSSProperties => {
  const colorTokens = colors.badge[color];
  const padding = size === 'sm' ? '2px 8px' : '2px 10px';
  const fontSize = size === 'sm' ? typography.text.xs.fontSize : typography.text.sm.fontSize;
  const lineHeight = size === 'sm' ? typography.text.xs.lineHeight : typography.text.sm.lineHeight;

  return {
    display: 'inline-flex',
    alignItems: 'center',
    padding,
    backgroundColor: colorTokens.bg,
    color: colorTokens.text,
    border: `1px solid ${colorTokens.border}`,
    borderRadius: radius.full,
    fontFamily: typography.fonts.body,
    fontSize,
    lineHeight,
    fontWeight: typography.weights.medium,
    whiteSpace: 'nowrap',
  };
};

export const Badge: ComponentConfig<BadgeProps> = {
  fields: {
    label: {
      type: 'text',
      label: 'Label',
    },
    color: {
      type: 'select',
      label: 'Color',
      options: [
        { label: 'Brand (Cyan)', value: 'brand' },
        { label: 'Green', value: 'green' },
        { label: 'Gray', value: 'gray' },
      ],
    },
    size: {
      type: 'radio',
      label: 'Size',
      options: [
        { label: 'Small', value: 'sm' },
        { label: 'Medium', value: 'md' },
      ],
    },
  },
  defaultProps: {
    label: 'Badge',
    color: 'brand',
    size: 'md',
  },
  render: ({ label, color, size }) => {
    return <span style={getBadgeStyle(color, size)}>{label}</span>;
  },
};
