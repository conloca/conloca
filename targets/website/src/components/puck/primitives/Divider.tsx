import type { ComponentConfig } from '@puckeditor/core';
import type { CSSProperties } from 'react';
import { colors } from '../shared/tokens';

export type DividerProps = {
  style: 'solid' | 'dashed' | 'dotted' | 'space';
  spacing: '24px' | '48px' | '72px';
  width: '100%' | '80%' | '50%';
  color: 'light' | 'medium' | 'dark';
};

const colorMap = {
  light: colors.border.primary,
  medium: colors.text.secondary,
  dark: colors.text.primary,
};

export const Divider: ComponentConfig<DividerProps> = {
  fields: {
    style: {
      type: 'radio',
      label: 'Style',
      options: [
        { label: 'Solid', value: 'solid' },
        { label: 'Dashed', value: 'dashed' },
        { label: 'Dotted', value: 'dotted' },
        { label: 'Space Only', value: 'space' },
      ],
    },
    spacing: {
      type: 'select',
      label: 'Spacing',
      options: [
        { label: 'Small (24px)', value: '24px' },
        { label: 'Medium (48px)', value: '48px' },
        { label: 'Large (72px)', value: '72px' },
      ],
    },
    width: {
      type: 'select',
      label: 'Width',
      options: [
        { label: 'Full', value: '100%' },
        { label: '80%', value: '80%' },
        { label: '50%', value: '50%' },
      ],
    },
    color: {
      type: 'radio',
      label: 'Color',
      options: [
        { label: 'Light', value: 'light' },
        { label: 'Medium', value: 'medium' },
        { label: 'Dark', value: 'dark' },
      ],
    },
  },
  defaultProps: {
    style: 'solid',
    spacing: '48px',
    width: '100%',
    color: 'light',
  },
  render: ({ style, spacing, width, color }) => {
    const spacingValue = Number.parseInt(spacing, 10);

    const containerStyle: CSSProperties = {
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      paddingTop: `${spacingValue / 2}px`,
      paddingBottom: `${spacingValue / 2}px`,
    };

    if (style === 'space') {
      return <div style={containerStyle} />;
    }

    const hrStyle: CSSProperties = {
      width,
      border: 'none',
      borderTop: `1px ${style} ${colorMap[color]}`,
      margin: 0,
    };

    return (
      <div style={containerStyle}>
        <hr style={hrStyle} />
      </div>
    );
  },
};
