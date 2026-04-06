import type { ComponentConfig } from '@puckeditor/core';
import { buttonSpacing, colors, radius, typography } from '../shared/tokens';

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
      placeholder: 'Button label...',
      contentEditable: true,
    },
    href: { type: 'text', label: 'Link URL', placeholder: 'https://...' },
    variant: {
      type: 'radio',
      label: 'Style',
      options: [
        { label: 'Primary', value: 'primary' },
        { label: 'Secondary', value: 'secondary' },
      ],
    },
  },
  defaultProps: {
    label: 'Button',
    href: '#',
    variant: 'primary',
  },
  render: ({ href, variant, label, puck }) => {
    const isPrimary = variant === 'primary';

    const buttonStyle = isPrimary
      ? {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: `${buttonSpacing.lg.paddingY} ${buttonSpacing.lg.paddingX}`,
          borderRadius: radius.md,
          fontFamily: typography.fonts.body,
          fontSize: typography.text.sm.fontSize,
          fontWeight: typography.weights.semibold,
          lineHeight: typography.text.sm.lineHeight,
          color: colors.interactive.primary.text,
          backgroundColor: colors.interactive.primary.bg,
          border: '1px solid transparent',
          textDecoration: 'none',
          cursor: 'pointer',
        }
      : {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: `${buttonSpacing.lg.paddingY} ${buttonSpacing.lg.paddingX}`,
          borderRadius: radius.md,
          fontFamily: typography.fonts.body,
          fontSize: typography.text.sm.fontSize,
          fontWeight: typography.weights.medium,
          lineHeight: typography.text.sm.lineHeight,
          color: colors.interactive.secondary.text,
          backgroundColor: colors.interactive.secondary.bg,
          border: `1px solid ${colors.interactive.secondary.border}`,
          textDecoration: 'none',
          cursor: 'pointer',
        };

    return (
      <div>
        <a href={href} style={buttonStyle} onClick={puck.isEditing ? (e) => e.preventDefault() : undefined}>
          {label}
        </a>
      </div>
    );
  },
};
