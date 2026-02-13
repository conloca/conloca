import type { ComponentConfig } from '@puckeditor/core';
import React from 'react';
import type { WithLayout } from '../Layout';
import { withLayout } from '../Layout';
import { Section } from '../Section';
import { HeadingComponent } from './HeadingComponent';

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
    return (
      <Section>
        <HeadingComponent text={text || ''} level={level} size={size} align={align} />
      </Section>
    );
  },
};

export const Heading = withLayout(HeadingInternal);
