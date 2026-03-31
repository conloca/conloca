import type { ComponentConfig } from '@puckeditor/core';
import type { CSSProperties } from 'react';
import { Section } from '../../Section';
import { buttonSpacing, colors, radius, sectionSpacing, typography } from '../shared/tokens';

type FAQItem = {
  id: string;
  question: string;
  answer: string;
};

type CTAButton = {
  id: string;
  label: string;
  href: string;
  variant: 'primary' | 'secondary';
};

export type FAQProps = {
  label: string;
  title: string;
  subtitle: string;
  items: FAQItem[];
  ctaText: string;
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

function FAQAccordionItem({ item }: { item: FAQItem }) {
  return (
    <details
      className="faq-details"
      style={{
        backgroundColor: 'var(--color-card-bg-alpha)',
        border: '1px solid var(--color-card-border-alpha)',
        borderRadius: radius.xl,
        overflow: 'hidden',
      }}
    >
      <summary
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          padding: '20px 24px',
          fontSize: typography.text.sm.fontSize,
          lineHeight: typography.text.sm.lineHeight,
          fontWeight: typography.weights.medium,
          fontFamily: typography.fonts.body,
          color: colors.text.heading,
          listStyle: 'none',
        }}
      >
        {item.question}
        <svg
          className="faq-chevron"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke={colors.text.secondary}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            flexShrink: 0,
            marginLeft: '16px',
            transition: 'transform 0.2s ease',
          }}
        >
          <path d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <div
        style={{
          padding: '16px 24px 20px',
          fontSize: typography.text.sm.fontSize,
          lineHeight: '1.6',
          fontFamily: typography.fonts.body,
          color: colors.text.secondary,
          borderTop: '1px solid var(--color-card-border-subtle)',
        }}
        dangerouslySetInnerHTML={{ __html: item.answer }}
      />
    </details>
  );
}

const FAQRender = ({
  label,
  title,
  subtitle,
  items,
  ctaText,
  ctaButtons,
  puck,
}: FAQProps & { puck: { isEditing: boolean } }) => {
  return (
    <section
      style={{
        paddingTop: '96px',
        paddingBottom: '80px',
      }}
    >
      <Section maxWidth="768px">
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
              maxWidth: '560px',
              margin: '0 auto',
            }}
          >
            {subtitle}
          </p>
        </div>

        {/* FAQ items */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {items.map((item) => (
            <FAQAccordionItem key={item.id} item={item} />
          ))}
        </div>

        {/* CTA */}
        <div style={{ marginTop: '64px', textAlign: 'center' }}>
          <p
            style={{
              fontFamily: typography.fonts.body,
              fontSize: typography.text.sm.fontSize,
              lineHeight: typography.text.sm.lineHeight,
              fontWeight: typography.weights.regular,
              color: colors.text.secondary,
              margin: 0,
              marginBottom: '16px',
            }}
          >
            {ctaText}
          </p>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '16px',
              flexWrap: 'wrap',
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
};

export const FAQ: ComponentConfig<FAQProps> = {
  label: 'FAQ Accordion',
  fields: {
    label: { type: 'text', label: 'Section Label' },
    title: { type: 'text', contentEditable: true },
    subtitle: { type: 'textarea' },
    items: {
      type: 'array',
      getItemSummary: (item) => item.question || 'Question',
      defaultItemProps: {
        id: `faq-${Date.now()}`,
        question: 'Question?',
        answer: 'Answer text here.',
      },
      arrayFields: {
        id: { type: 'text', label: 'ID' },
        question: { type: 'text' },
        answer: { type: 'textarea', label: 'Answer (HTML)' },
      },
    },
    ctaText: { type: 'text', label: 'CTA Text' },
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
    label: 'Support',
    title: 'Frequently Asked Questions',
    subtitle: 'Common questions about Conloca CMS',
    items: [],
    ctaText: 'Have more questions?',
    ctaButtons: [{ id: 'btn-1', label: 'Read the Docs', href: '/getting-started/', variant: 'primary' }],
  },
  render: FAQRender,
};
