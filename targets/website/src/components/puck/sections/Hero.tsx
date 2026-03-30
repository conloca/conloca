import type { ComponentConfig } from '@puckeditor/core';
import type { CSSProperties } from 'react';
import { Section } from '../../Section';
import { buttonSpacing, colors, radius, sectionSpacing, shadows, typography } from '../shared/tokens';

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

    const hasButtons = buttons.length > 0;

    return (
      <section
        itemScope
        itemType="https://schema.org/SoftwareApplication"
        style={{
          position: 'relative',
          minHeight: hasButtons ? '100vh' : undefined,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          paddingTop: hasButtons ? '64px' : '96px',
          paddingBottom: hasButtons ? '64px' : '80px',
        }}
      >
        {/* Radial gradient overlay */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(ellipse at center, rgba(6,182,212,0.04) 0%, transparent 70%)',
          }}
        />
        {/* Grid dots overlay */}
        <div className="grid-dots" style={{ position: 'absolute', inset: 0 }} />

        {/* Content container -- needs relative positioning to sit above overlays */}
        <div style={{ position: 'relative', width: '100%' }}>
          <Section maxWidth="896px">
            <meta itemProp="applicationCategory" content="Content Management System" />
            <meta itemProp="operatingSystem" content="Cross-platform" />
            <meta
              itemProp="description"
              content="Conloca is a free, open-source, file-based content management system (CMS) built specifically for Astro websites. It stores all content as version-controlled files in your git repository -- no database required. Developers define drag-and-drop components with Puck, and content editors build pages visually through a browser-based interface at the /__cms route."
            />
            <div style={{ textAlign: 'center' }}>
              {/* Badge */}
              {badgeText && (
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    border: `1px solid ${colors.border.primary}`,
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
                itemProp="name"
                style={{
                  fontFamily: typography.fonts.body,
                  fontSize: hasButtons ? 'clamp(36px, 6vw, 60px)' : typography.display.md.fontSize,
                  lineHeight: hasButtons ? 'clamp(45px, 7.5vw, 75px)' : typography.display.md.lineHeight,
                  fontWeight: typography.weights.bold,
                  letterSpacing: hasButtons ? '-1.5px' : undefined,
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
                  fontSize: 'clamp(16px, 2.5vw, 20px)',
                  lineHeight: 'clamp(24px, 3.5vw, 28px)',
                  fontWeight: typography.weights.regular,
                  color: colors.text.secondary,
                  maxWidth: '672px',
                  margin: '0 auto',
                  marginBottom: '40px',
                }}
              >
                {description}
              </p>

              {/* Buttons */}
              <div className="hero-buttons">
                {buttons.map((button) => (
                  <a
                    key={button.id}
                    href={button.href}
                    style={button.variant === 'primary' ? buttonPrimaryStyle : buttonSecondaryStyle}
                    onClick={puck.isEditing ? (e) => e.preventDefault() : undefined}
                  >
                    {button.label}
                    {button.variant === 'primary' && (
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    )}
                  </a>
                ))}
              </div>

              {/* Terminal mock-up -- only shown on pages with CTA buttons (e.g. homepage) */}
              {hasButtons && (
                <div style={{ maxWidth: '448px', margin: '48px auto 0' }}>
                  <div
                    style={{
                      backgroundColor: colors.bg.card,
                      border: `1px solid ${colors.border.primary}`,
                      borderRadius: radius.xl,
                      overflow: 'hidden',
                      boxShadow: shadows.xl,
                    }}
                  >
                    {/* Title bar */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '10px 16px',
                        borderBottom: `1px solid ${colors.border.primary}`,
                      }}
                    >
                      <span
                        style={{
                          width: '10px',
                          height: '10px',
                          borderRadius: '50%',
                          backgroundColor: colors.border.hover,
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          width: '10px',
                          height: '10px',
                          borderRadius: '50%',
                          backgroundColor: colors.border.hover,
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          width: '10px',
                          height: '10px',
                          borderRadius: '50%',
                          backgroundColor: colors.border.hover,
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          fontFamily: typography.fonts.mono,
                          fontSize: typography.text.xs.fontSize,
                          color: colors.text.secondary,
                          marginLeft: '8px',
                        }}
                      >
                        Terminal
                      </span>
                    </div>
                    {/* Command line */}
                    <div
                      style={{
                        padding: '16px 20px',
                        fontFamily: typography.fonts.mono,
                        fontSize: typography.text.sm.fontSize,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ color: colors.brand[600] }}>$</span>
                        <span id="typed-command" style={{ color: colors.text.heading }} />
                        <span
                          id="cursor"
                          style={{
                            display: 'inline-block',
                            width: '8px',
                            height: '20px',
                            backgroundColor: colors.brand[400],
                            animation: 'blink 1s step-end infinite',
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Section>
        </div>

        {/* Scroll-down arrow -- only on full-height hero */}
        {hasButtons && (
          <div
            style={{
              position: 'absolute',
              bottom: '32px',
              left: '50%',
              transform: 'translateX(-50%)',
            }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke={colors.text.secondary}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ animation: 'bounce 1s infinite' }}
            >
              <path d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </div>
        )}
      </section>
    );
  },
};
