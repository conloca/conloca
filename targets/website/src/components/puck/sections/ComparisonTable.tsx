import type { ComponentConfig } from '@puckeditor/core';
import type { CSSProperties } from 'react';
import { Section } from '../../Section';
import { buttonSpacing, colors, radius, sectionSpacing, typography } from '../shared/tokens';

type ComparisonRow = {
  id: string;
  feature: string;
  values: string[];
};

type Differentiator = {
  id: string;
  title: string;
  description: string;
};

type CTAButton = {
  id: string;
  label: string;
  href: string;
  variant: 'primary' | 'secondary';
};

export type ComparisonTableProps = {
  label: string;
  title: string;
  subtitle: string;
  extendedSubtitle: string;
  columns: string[];
  highlightColumnIndex: number;
  rows: ComparisonRow[];
  differentiators: Differentiator[];
  ctaTitle: string;
  ctaSubtitle: string;
  ctaButtons: CTAButton[];
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
  gap: '8px',
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
  gap: '8px',
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

const positiveValues = ['Yes', 'Built-in', 'Native', 'Free', 'No', 'None', 'Automatic'];

function isPositiveValue(value: string): boolean {
  return positiveValues.some((p) => value.startsWith(p));
}

export const ComparisonTable: ComponentConfig<ComparisonTableProps> = {
  label: 'Comparison Table',
  fields: {
    label: { type: 'text', label: 'Section Label' },
    title: { type: 'text', contentEditable: true },
    subtitle: { type: 'textarea' },
    extendedSubtitle: { type: 'textarea', label: 'Extended Subtitle' },
    columns: {
      type: 'textarea',
      label: 'Columns (one per line)',
    } as never,
    highlightColumnIndex: { type: 'number', label: 'Highlight Column Index', min: 0 },
    rows: {
      type: 'array',
      getItemSummary: (item) => item.feature || 'Row',
      defaultItemProps: { id: `row-${Date.now()}`, feature: 'Feature', values: [] },
      arrayFields: {
        id: { type: 'text', label: 'ID' },
        feature: { type: 'text' },
        values: {
          type: 'textarea',
          label: 'Values (one per line)',
        } as never,
      },
    },
    differentiators: {
      type: 'array',
      getItemSummary: (item) => item.title || 'Differentiator',
      defaultItemProps: { id: `diff-${Date.now()}`, title: 'Title', description: 'Description' },
      arrayFields: {
        id: { type: 'text', label: 'ID' },
        title: { type: 'text' },
        description: { type: 'textarea' },
      },
    },
    ctaTitle: { type: 'text', label: 'CTA Title' },
    ctaSubtitle: { type: 'textarea', label: 'CTA Subtitle' },
    ctaButtons: {
      type: 'array',
      min: 1,
      max: 4,
      getItemSummary: (item) => item.label || 'Button',
      defaultItemProps: { id: `btn-${Date.now()}`, label: 'Button', href: '#', variant: 'primary' as const },
      arrayFields: {
        id: { type: 'text', label: 'ID' },
        label: { type: 'text' },
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
    label: 'Comparison',
    title: 'How Conloca Compares',
    subtitle: "Choosing a CMS for your Astro site? Here's how Conloca compares to popular alternatives.",
    extendedSubtitle: '',
    columns: ['Conloca', 'Storyblok', 'Contentful', 'Decap CMS', 'Tina CMS'],
    highlightColumnIndex: 0,
    rows: [],
    differentiators: [],
    ctaTitle: 'Ready to try Conloca?',
    ctaSubtitle: 'Get started in minutes.',
    ctaButtons: [{ id: 'btn-1', label: 'Get Started', href: '/getting-started/', variant: 'primary' }],
  },
  render: ({
    label,
    title,
    subtitle,
    extendedSubtitle,
    columns,
    highlightColumnIndex,
    rows,
    differentiators,
    ctaTitle,
    ctaSubtitle,
    ctaButtons,
    puck,
  }) => {
    return (
      <section
        style={{
          paddingTop: '96px',
          paddingBottom: '80px',
        }}
      >
        <Section>
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: '64px' }}>
            {label && (
              <p
                style={{
                  fontFamily: typography.fonts.body,
                  fontSize: typography.text.sm.fontSize,
                  lineHeight: typography.text.sm.lineHeight,
                  fontWeight: typography.weights.medium,
                  color: colors.brand[600],
                  textTransform: 'uppercase',
                  letterSpacing: '0.025em',
                  margin: 0,
                  marginBottom: '12px',
                }}
              >
                {label}
              </p>
            )}
            <h1
              style={{
                fontFamily: typography.fonts.body,
                fontSize: typography.display.md.fontSize,
                lineHeight: typography.display.md.lineHeight,
                fontWeight: typography.weights.bold,
                color: colors.text.heading,
                margin: 0,
                marginBottom: '16px',
              }}
            >
              {title}
            </h1>
            <p
              style={{
                fontFamily: typography.fonts.body,
                fontSize: typography.text.md.fontSize,
                lineHeight: typography.text.md.lineHeight,
                fontWeight: typography.weights.regular,
                color: colors.text.secondary,
                maxWidth: '672px',
                margin: '0 auto',
              }}
            >
              {subtitle}
            </p>
            {extendedSubtitle && (
              <p
                style={{
                  fontFamily: typography.fonts.body,
                  fontSize: typography.text.sm.fontSize,
                  lineHeight: typography.text.sm.lineHeight,
                  fontWeight: typography.weights.regular,
                  color: colors.text.secondary,
                  maxWidth: '672px',
                  margin: '12px auto 0',
                }}
              >
                {extendedSubtitle}
              </p>
            )}
          </div>

          {/* Table */}
          <div style={{ marginBottom: '80px', overflowX: 'auto' }}>
            <div
              style={{
                backgroundColor: 'var(--color-card-bg-alpha)',
                border: '1px solid var(--color-card-border-alpha)',
                borderRadius: radius['2xl'],
                overflow: 'hidden',
                minWidth: '640px',
              }}
            >
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-card-border-alpha)' }}>
                    <th
                      style={{
                        textAlign: 'left',
                        fontSize: typography.text.sm.fontSize,
                        lineHeight: typography.text.sm.lineHeight,
                        fontWeight: typography.weights.medium,
                        fontFamily: typography.fonts.body,
                        color: colors.text.secondary,
                        padding: '16px 24px',
                        width: '160px',
                      }}
                    >
                      Feature
                    </th>
                    {columns.map((col, i) => (
                      <th
                        key={col}
                        style={{
                          textAlign: 'center',
                          fontSize: typography.text.sm.fontSize,
                          lineHeight: typography.text.sm.lineHeight,
                          fontWeight: typography.weights.medium,
                          fontFamily: typography.fonts.body,
                          color: i === highlightColumnIndex ? colors.brand[600] : colors.text.secondary,
                          padding: '16px',
                        }}
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr
                      key={row.id}
                      style={{
                        borderBottom: '1px solid var(--color-card-border-subtle)',
                        backgroundColor: i % 2 === 0 ? 'var(--color-card-border-subtle)' : 'transparent',
                      }}
                    >
                      <th
                        style={{
                          textAlign: 'left',
                          padding: '14px 24px',
                          fontSize: typography.text.sm.fontSize,
                          lineHeight: typography.text.sm.lineHeight,
                          fontWeight: typography.weights.medium,
                          fontFamily: typography.fonts.body,
                          color: colors.text.secondary,
                        }}
                      >
                        {row.feature}
                      </th>
                      {row.values.map((value, j) => (
                        <td
                          key={`${row.id}-${columns[j]}`}
                          style={{
                            padding: '14px 16px',
                            textAlign: 'center',
                            fontSize: typography.text.sm.fontSize,
                            lineHeight: typography.text.sm.lineHeight,
                            fontFamily: typography.fonts.body,
                            color:
                              j === highlightColumnIndex && isPositiveValue(value)
                                ? colors.brand[600]
                                : colors.text.secondary,
                          }}
                        >
                          {value}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Differentiators */}
          {differentiators.length > 0 && (
            <div style={{ marginBottom: '80px' }}>
              <div style={{ textAlign: 'center', marginBottom: '48px' }}>
                <h2
                  style={{
                    fontFamily: typography.fonts.body,
                    fontSize: typography.display.sm.fontSize,
                    lineHeight: '36px',
                    fontWeight: typography.weights.bold,
                    color: colors.text.heading,
                    margin: 0,
                    marginBottom: '16px',
                  }}
                >
                  Key Differentiators
                </h2>
                <p
                  style={{
                    fontFamily: typography.fonts.body,
                    fontSize: typography.text.md.fontSize,
                    lineHeight: typography.text.md.lineHeight,
                    fontWeight: typography.weights.regular,
                    color: colors.text.secondary,
                    maxWidth: '560px',
                    margin: '0 auto',
                  }}
                >
                  What makes Conloca different from every other CMS option for Astro.
                </p>
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                  gap: '24px',
                }}
              >
                {differentiators.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      backgroundColor: 'var(--color-card-bg-alpha)',
                      border: '1px solid var(--color-card-border-alpha)',
                      borderRadius: radius.xl,
                      padding: '24px',
                    }}
                  >
                    <h3
                      style={{
                        fontFamily: typography.fonts.body,
                        fontSize: typography.text.sm.fontSize,
                        lineHeight: typography.text.sm.lineHeight,
                        fontWeight: typography.weights.semibold,
                        color: colors.text.heading,
                        margin: 0,
                        marginBottom: '12px',
                      }}
                    >
                      {item.title}
                    </h3>
                    <p
                      style={{
                        fontFamily: typography.fonts.body,
                        fontSize: typography.text.sm.fontSize,
                        lineHeight: '1.6',
                        fontWeight: typography.weights.regular,
                        color: colors.text.secondary,
                        margin: 0,
                      }}
                    >
                      {item.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CTA */}
          <div style={{ textAlign: 'center' }}>
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
              {ctaTitle}
            </h2>
            <p
              style={{
                fontFamily: typography.fonts.body,
                fontSize: typography.text.sm.fontSize,
                lineHeight: typography.text.sm.lineHeight,
                fontWeight: typography.weights.regular,
                color: colors.text.secondary,
                maxWidth: '448px',
                margin: '0 auto',
                marginBottom: '16px',
              }}
            >
              {ctaSubtitle}
            </p>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '16px',
                flexWrap: 'wrap',
                paddingTop: '8px',
              }}
            >
              {ctaButtons.map((button) => (
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
