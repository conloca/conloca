import type { ComponentConfig } from '@puckeditor/core';
import type React from 'react';

const spacingOptions = [
  { label: '8px', value: '8px' },
  { label: '16px', value: '16px' },
  { label: '24px', value: '24px' },
  { label: '32px', value: '32px' },
  { label: '40px', value: '40px' },
  { label: '48px', value: '48px' },
  { label: '56px', value: '56px' },
  { label: '64px', value: '64px' },
  { label: '72px', value: '72px' },
  { label: '80px', value: '80px' },
  { label: '88px', value: '88px' },
  { label: '96px', value: '96px' },
  { label: '104px', value: '104px' },
  { label: '112px', value: '112px' },
  { label: '120px', value: '120px' },
  { label: '128px', value: '128px' },
  { label: '136px', value: '136px' },
  { label: '144px', value: '144px' },
  { label: '152px', value: '152px' },
  { label: '160px', value: '160px' },
];

export type SpaceProps = {
  direction?: '' | 'vertical' | 'horizontal';
  size: string;
};

export const Space: ComponentConfig<SpaceProps> = {
  label: 'Space',
  fields: {
    size: {
      type: 'select',
      options: spacingOptions,
    },
    direction: {
      type: 'radio',
      options: [
        { value: 'vertical', label: 'Vertical' },
        { value: 'horizontal', label: 'Horizontal' },
        { value: '', label: 'Both' },
      ],
    },
  },
  defaultProps: {
    direction: '',
    size: '24px',
  },
  inline: true,
  render: ({ direction, size, puck }) => {
    const style: React.CSSProperties = {
      width: direction === 'vertical' ? '100%' : size,
      height: direction === 'horizontal' ? '100%' : size,
      ...(direction === '' && {
        width: size,
        height: size,
      }),
    };

    return <div ref={puck.dragRef} style={style} />;
  },
};
