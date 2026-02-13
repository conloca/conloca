import type { ComponentConfig } from '@puckeditor/core';
import React from 'react';
import { ButtonComponent } from './ButtonComponent';

export type ButtonProps = {
  label: string;
  href: string;
  variant: 'primary' | 'secondary';
};

export const Button: ComponentConfig<ButtonProps> = {
  label: 'Button',
  fields: {
    label: {
      type: 'text',
      placeholder: 'Lorem ipsum...',
      contentEditable: true,
    },
    href: { type: 'text' },
    variant: {
      type: 'radio',
      options: [
        { label: 'primary', value: 'primary' },
        { label: 'secondary', value: 'secondary' },
      ],
    },
  },
  defaultProps: {
    label: 'Button',
    href: '#',
    variant: 'primary',
  },
  render: ({ href, variant, label, puck }) => {
    return (
      <div>
        <ButtonComponent label={label} href={href} variant={variant} isEditing={puck.isEditing} />
      </div>
    );
  },
};
