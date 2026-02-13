import type { ComponentConfig } from '@puckeditor/core';
import React from 'react';
import type { WithLayout } from '../Layout';
import { withLayout } from '../Layout';
import { Section } from '../Section';
import { TextComponent } from './TextComponent';

export type TextProps = WithLayout<{
  align: 'left' | 'center' | 'right';
  text?: string;
  padding?: string;
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
    return (
      <Section maxWidth={maxWidth}>
        <div style={{ maxWidth }}>
          <TextComponent text={text || ''} size={size} color={color} align={align} />
        </div>
      </Section>
    );
  },
};

export const Text = withLayout(TextInner);
