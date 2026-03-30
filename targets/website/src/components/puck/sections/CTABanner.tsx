import type { ComponentConfig } from '@puckeditor/core';
import type { CSSProperties } from 'react';
import { Section } from '../../Section';
import { buttonSpacing, colors, radius, sectionSpacing, typography } from '../shared/tokens';

type CTAButton = {
  id: string;
  label: string;
  href: string;
  variant: 'primary' | 'secondary';
};

export type CTABannerProps = {
  badgeText?: string;
  title: string;
  subtitle: string;
  buttons: CTAButton[];
};

const arrowIcon = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M5 12h14M12 5l7 7-7 7" />
  </svg>
);

const buttonPrimaryStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
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
};

const buttonSecondaryStyle: CSSProperties = {
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
  backgroundColor: 'transparent',
  border: `1px solid ${colors.interactive.secondary.border}`,
  textDecoration: 'none',
  cursor: 'pointer',
};

export const CTABanner: ComponentConfig<CTABannerProps> = {
  label: 'Call to Action Banner',
  fields: {
    badgeText: {
      type: 'text',
      label: 'Badge (optional)',
    },
    title: {
      type: 'text',
      contentEditable: true,
    },
    subtitle: {
      type: 'textarea',
      contentEditable: true,
    },
    buttons: {
      type: 'array',
      min: 1,
      max: 4,
      getItemSummary: (item) => item.label || 'Button',
      defaultItemProps: {
        id: `btn-${Date.now()}`,
        label: 'Button',
        href: '#',
        variant: 'primary',
      },
      arrayFields: {
        id: { type: 'text', label: 'ID (unique)' },
        label: { type: 'text', contentEditable: true },
        href: { type: 'text' },
        variant: {
          type: 'radio',
          options: [
            { label: 'Primary', value: 'primary' },
            { label: 'Secondary', value: 'secondary' },
          ],
        },
      },
    },
  },
  defaultProps: {
    badgeText: 'Coming Soon',
    title: 'Conloca Cloud — visual editing without the setup',
    subtitle: 'All the power of Conloca, fully managed. Your team edits visually while you keep full git ownership.',
    buttons: [{ id: 'btn-cta-1', label: 'Join Waitlist', href: '#waitlist', variant: 'primary' }],
  },
  render: ({ badgeText, title, subtitle, buttons, puck }) => {
    return (
      <section
        style={{
          paddingTop: sectionSpacing.desktop.md.paddingY,
          paddingBottom: sectionSpacing.desktop.md.paddingY,
        }}
      >
        <Section>
          <div style={{ textAlign: 'center' }}>
            {/* Badge */}
            {badgeText && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '4px 12px',
                  backgroundColor: `${colors.brand[500]}0d`,
                  color: colors.brand[600],
                  border: `1px solid ${colors.brand[500]}4d`,
                  borderRadius: radius.full,
                  fontFamily: typography.fonts.body,
                  fontSize: typography.text.xs.fontSize,
                  lineHeight: typography.text.xs.lineHeight,
                  fontWeight: typography.weights.medium,
                  marginBottom: '24px',
                }}
              >
                {badgeText}
              </span>
            )}

            {/* Title */}
            <h2
              style={{
                fontFamily: typography.fonts.body,
                fontSize: typography.display.xs.fontSize,
                lineHeight: typography.display.xs.lineHeight,
                fontWeight: typography.weights.bold,
                color: colors.text.heading,
                margin: 0,
                marginBottom: '16px',
              }}
            >
              {title}
            </h2>

            {/* Subtitle */}
            <p
              style={{
                fontFamily: typography.fonts.body,
                fontSize: typography.text.md.fontSize,
                lineHeight: typography.text.md.lineHeight,
                fontWeight: typography.weights.regular,
                color: colors.text.secondary,
                maxWidth: '640px',
                margin: '0 auto',
                marginBottom: '32px',
              }}
            >
              {subtitle}
            </p>

            {/* Buttons */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '16px',
                flexWrap: 'wrap',
              }}
            >
              {buttons.map((button) => (
                <a
                  key={button.id}
                  href={button.href}
                  style={button.variant === 'primary' ? buttonPrimaryStyle : buttonSecondaryStyle}
                  onClick={puck.isEditing ? (e) => e.preventDefault() : undefined}
                >
                  {button.label}
                  {button.variant === 'primary' && arrowIcon}
                </a>
              ))}
            </div>
          </div>
        </Section>
      </section>
    );
  },
};
