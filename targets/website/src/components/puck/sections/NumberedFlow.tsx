import type { ComponentConfig } from '@puckeditor/core';
import { Section } from '../../Section';
import { colors, radius, typography } from '../shared/tokens';

type FlowItem = {
  id: string;
  number: string;
  title: string;
  description: string;
};

export type NumberedFlowProps = {
  title: string;
  subtitle: string;
  items: FlowItem[];
};

export const NumberedFlow: ComponentConfig<NumberedFlowProps> = {
  label: 'Numbered Flow',
  fields: {
    title: { type: 'text', contentEditable: true },
    subtitle: { type: 'textarea' },
    items: {
      type: 'array',
      getItemSummary: (item) => item.title || 'Step',
      defaultItemProps: {
        id: `flow-${Date.now()}`,
        number: '1',
        title: 'Step Title',
        description: 'Step description.',
      },
      arrayFields: {
        id: { type: 'text', label: 'ID' },
        number: { type: 'text', label: 'Number' },
        title: { type: 'text' },
        description: { type: 'textarea', label: 'Description (HTML)' },
      },
    },
  },
  defaultProps: {
    title: '',
    subtitle: '',
    items: [],
  },
  render: ({ title, subtitle, items }) => {
    return (
      <section style={{ marginBottom: '80px' }}>
        <Section maxWidth="896px">
          {title && (
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
          )}
          {subtitle && (
            <p
              style={{
                fontFamily: typography.fonts.body,
                fontSize: typography.text.sm.fontSize,
                lineHeight: '1.6',
                fontWeight: typography.weights.regular,
                color: colors.text.secondary,
                margin: 0,
                marginBottom: '24px',
              }}
            >
              {subtitle}
            </p>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {items.map((item, i) => (
              <div key={item.id}>
                <div
                  style={{
                    backgroundColor: 'rgba(241,245,249,0.6)',
                    border: '1px solid rgba(226,232,240,0.8)',
                    borderRadius: radius.xl,
                    padding: '24px',
                    display: 'flex',
                    gap: '16px',
                  }}
                >
                  {/* Number badge */}
                  <div
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: radius.lg,
                      backgroundColor: colors.brand[500],
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: typography.fonts.body,
                        fontSize: typography.text.sm.fontSize,
                        fontWeight: typography.weights.bold,
                        color: colors.surface[950],
                      }}
                    >
                      {item.number}
                    </span>
                  </div>

                  {/* Content */}
                  <div>
                    <h3
                      style={{
                        fontFamily: typography.fonts.body,
                        fontSize: typography.text.sm.fontSize,
                        lineHeight: typography.text.sm.lineHeight,
                        fontWeight: typography.weights.semibold,
                        color: colors.text.heading,
                        margin: 0,
                        marginBottom: '4px',
                      }}
                    >
                      {item.title}
                    </h3>
                    <div
                      style={{
                        fontFamily: typography.fonts.body,
                        fontSize: typography.text.sm.fontSize,
                        lineHeight: '1.6',
                        color: colors.text.secondary,
                      }}
                      dangerouslySetInnerHTML={{ __html: item.description }}
                    />
                  </div>
                </div>

                {/* Arrow connector between items */}
                {i < items.length - 1 && (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={colors.surface[600]}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                    </svg>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      </section>
    );
  },
};
