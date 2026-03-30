import type { ComponentConfig } from '@puckeditor/core';
import type { CSSProperties } from 'react';
import { Section } from '../../Section';
import { buttonSpacing, colors, radius, sectionSpacing, typography } from '../shared/tokens';

type HeroButton = {
  id: string;
  label: string;
  href: string;
  variant: 'primary' | 'secondary';
};

export type HeroProps = {
  badgeText: string;
  title: string;
  description: string;
  buttons: HeroButton[];
};

const buttonPrimaryStyle: CSSProperties = {
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

export const Hero: ComponentConfig<HeroProps> = {
  label: 'Hero Section',
  fields: {
    badgeText: {
      type: 'text',
      label: 'Badge Text',
    },
    title: {
      type: 'text',
      contentEditable: true,
    },
    description: {
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
    badgeText: 'Open source - MIT Licensed',
    title: 'The file-based CMS that lives in your git repo',
    description:
      'Visual editing for marketers, full git ownership for developers. Powered by Puck with drag-and-drop components.',
    buttons: [
      { id: 'btn-1', label: 'Get Started', href: '#quickstart', variant: 'primary' },
      { id: 'btn-2', label: 'Join Waitlist', href: '#waitlist', variant: 'secondary' },
    ],
  },
  render: ({ badgeText, title, description, buttons, puck }) => {
    /** Split title on newline: first line plain, subsequent lines get brand color */
    const renderTitle = () => {
      const lines = title.split('\n');
      return lines.map((line, idx) => (
        <span key={`${line.slice(0, 10)}-${idx}`}>
          {idx === 0 ? line : <span style={{ color: colors.brand[600] }}>{line}</span>}
          {idx < lines.length - 1 && <br />}
        </span>
      ));
    };

    return (
      <section
        style={{
          paddingTop: sectionSpacing.desktop.lg.paddingY,
          paddingBottom: sectionSpacing.desktop.lg.paddingY,
        }}
      >
        <Section maxWidth="896px">
          <div style={{ textAlign: 'center' }}>
            {/* Badge */}
            {badgeText && (
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  border: `1px solid ${colors.surface[300]}`,
                  borderRadius: radius.full,
                  padding: '6px 16px',
                  marginBottom: '32px',
                  fontSize: typography.text.xs.fontSize,
                  lineHeight: typography.text.xs.lineHeight,
                  color: colors.text.secondary,
                  fontFamily: typography.fonts.body,
                }}
              >
                <span
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    backgroundColor: colors.brand[400],
                    flexShrink: 0,
                  }}
                />
                {badgeText}
              </div>
            )}

            {/* Title */}
            <h1
              style={{
                fontFamily: typography.fonts.body,
                fontSize: typography.display.lg.fontSize,
                lineHeight: typography.display.lg.lineHeight,
                fontWeight: typography.weights.bold,
                color: colors.text.heading,
                margin: 0,
                marginBottom: '24px',
              }}
            >
              {renderTitle()}
            </h1>

            {/* Description */}
            <p
              style={{
                fontFamily: typography.fonts.body,
                fontSize: typography.text.xl.fontSize,
                lineHeight: typography.text.xl.lineHeight,
                fontWeight: typography.weights.regular,
                color: colors.text.secondary,
                maxWidth: '640px',
                margin: '0 auto',
                marginBottom: '40px',
              }}
            >
              {description}
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
                </a>
              ))}
            </div>
          </div>
        </Section>
      </section>
    );
  },
};
