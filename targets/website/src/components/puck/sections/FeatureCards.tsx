import type { ComponentConfig } from '@puckeditor/core';
import { Section } from '../../Section';
import { colors, radius, sectionSpacing, typography } from '../shared/tokens';

type FeatureCard = {
  id: string;
  iconSvgPath: string;
  iconText?: string;
  title: string;
  description: string;
  href?: string;
  linkLabel?: string;
};

type FeatureColumns = '2' | '3' | '4';

export type FeatureCardsProps = {
  label: string;
  title: string;
  subtitle: string;
  cards: FeatureCard[];
  columns: FeatureColumns;
};

const columnCountMap: Record<FeatureColumns, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
};

export const FeatureCards: ComponentConfig<FeatureCardsProps> = {
  label: 'Feature Cards',
  fields: {
    label: {
      type: 'text',
      label: 'Section Label',
    },
    title: {
      type: 'text',
      contentEditable: true,
    },
    subtitle: {
      type: 'textarea',
    },
    cards: {
      type: 'array',
      getItemSummary: (item) => item.title || 'Card',
      defaultItemProps: {
        id: `card-${Date.now()}`,
        iconSvgPath: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z',
        title: 'Feature Title',
        description: 'Feature description goes here.',
        href: '',
        linkLabel: '',
      },
      arrayFields: {
        id: { type: 'text', label: 'ID (unique)' },
        iconSvgPath: { type: 'textarea', label: 'SVG path d attribute' },
        iconText: { type: 'text', label: 'Icon text (shown instead of SVG when set)' },
        title: { type: 'text' },
        description: { type: 'textarea' },
        href: { type: 'text', label: 'Link URL (optional)' },
        linkLabel: { type: 'text', label: 'Link Label (optional)' },
      },
    },
    columns: {
      type: 'select',
      label: 'Columns',
      options: [
        { label: '2 Columns', value: '2' },
        { label: '3 Columns', value: '3' },
        { label: '4 Columns', value: '4' },
      ],
    },
  },
  defaultProps: {
    label: 'Features',
    title: "Everything you need, nothing you don't",
    subtitle: 'A CMS that respects your stack. File-based, git-native, and built for Astro.',
    columns: '4',
    cards: [
      {
        id: 'card-1',
        iconSvgPath: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z',
        title: 'File-Based Storage',
        description: 'Content stored as VXJSON files in your repo. No database, no vendor lock-in.',
      },
      {
        id: 'card-2',
        iconSvgPath:
          'M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z',
        title: 'Visual Drag & Drop Editor',
        description: 'Powered by Puck. Build pages visually in development with drag-and-drop components.',
      },
      {
        id: 'card-3',
        iconSvgPath: 'M13 10V3L4 14h7v7l9-11h-7z',
        title: 'Git-Native',
        description: 'Every edit can be committed to git. Changes appear in version history with proper attribution.',
      },
      {
        id: 'card-4',
        iconSvgPath:
          'M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
        title: 'Multi-Locale',
        description: 'Built-in content management for multiple languages and locales.',
      },
    ],
  },
  render: ({ label, title, subtitle, cards, columns }) => {
    const numColumns = columnCountMap[columns];

    return (
      <section
        style={{
          position: 'relative',
          paddingTop: sectionSpacing.desktop.lg.paddingY,
          paddingBottom: sectionSpacing.desktop.lg.paddingY,
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(ellipse at top, rgba(6,182,212,0.02) 0%, transparent 50%)',
          }}
        />
        <Section style={{ position: 'relative' }}>
          {/* Section header */}
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
            <h2
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
              {subtitle}
            </p>
          </div>

          {/* Cards grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(auto-fit, minmax(${numColumns <= 2 ? '280px' : '240px'}, 1fr))`,
              gap: '16px',
            }}
          >
            {cards.map((card) => (
              <div
                key={card.id}
                className="reveal"
                style={{
                  backgroundColor: colors.bg.card,
                  border: `1px solid ${colors.border.primary}`,
                  borderRadius: radius.lg,
                  padding: '24px',
                }}
              >
                {/* Icon wrapper */}
                <div
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: radius.md,
                    backgroundColor: `${colors.brand[500]}1a`,
                    border: `1px solid ${colors.brand[500]}33`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: '16px',
                    flexShrink: 0,
                  }}
                >
                  {card.iconText ? (
                    <span
                      style={{
                        fontFamily: typography.fonts.mono,
                        fontSize: '13px',
                        fontWeight: typography.weights.bold,
                        color: colors.brand[600],
                        lineHeight: 1,
                      }}
                    >
                      {card.iconText}
                    </span>
                  ) : (
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={colors.brand[600]}
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d={card.iconSvgPath} />
                    </svg>
                  )}
                </div>
                {/* Card title */}
                <h3
                  style={{
                    fontFamily: typography.fonts.body,
                    fontSize: typography.text.sm.fontSize,
                    lineHeight: typography.text.sm.lineHeight,
                    fontWeight: typography.weights.medium,
                    color: colors.text.heading,
                    margin: 0,
                    marginBottom: '8px',
                  }}
                >
                  {card.title}
                </h3>
                {/* Card description */}
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
                  {card.description}
                </p>
                {card.href && (
                  <a
                    href={card.href}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      marginTop: '12px',
                      fontFamily: typography.fonts.body,
                      fontSize: typography.text.xs.fontSize,
                      lineHeight: typography.text.xs.lineHeight,
                      fontWeight: typography.weights.medium,
                      color: colors.brand[600],
                      textDecoration: 'none',
                    }}
                  >
                    {card.linkLabel || 'Learn more'}
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </a>
                )}
              </div>
            ))}
          </div>
        </Section>
      </section>
    );
  },
};
