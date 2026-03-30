import type { ComponentConfig } from '@puckeditor/core';
import { Section } from '../../Section';
import { colors, radius, typography } from '../shared/tokens';

type LegendItem = {
  id: string;
  color: string;
  label: string;
};

export type CodeBlockProps = {
  filename: string;
  code: string;
  accentColor: string;
  legendItems: LegendItem[];
};

export const CodeBlock: ComponentConfig<CodeBlockProps> = {
  label: 'Code Block',
  fields: {
    filename: { type: 'text', label: 'Filename' },
    code: { type: 'textarea', label: 'Code (HTML)' },
    accentColor: { type: 'text', label: 'Accent Color' },
    legendItems: {
      type: 'array',
      getItemSummary: (item) => item.label || 'Legend',
      defaultItemProps: { id: `legend-${Date.now()}`, color: colors.brand[500], label: 'Label' },
      arrayFields: {
        id: { type: 'text', label: 'ID' },
        color: { type: 'text', label: 'Color' },
        label: { type: 'text' },
      },
    },
  },
  defaultProps: {
    filename: 'example.vxjson',
    code: '<code>// Code here</code>',
    accentColor: '',
    legendItems: [],
  },
  render: ({ filename, code, accentColor, legendItems }) => {
    return (
      <section style={{ marginBottom: '80px' }}>
        <Section maxWidth="896px">
          <div
            style={{
              backgroundColor: 'rgba(241,245,249,0.6)',
              border: '1px solid rgba(226,232,240,0.8)',
              borderRadius: radius.xl,
              overflow: 'hidden',
            }}
          >
            {/* Terminal title bar */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 16px',
                borderBottom: '1px solid rgba(226,232,240,0.8)',
              }}
            >
              <div
                style={{
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  backgroundColor: colors.surface[300],
                }}
              />
              <span
                style={{
                  fontFamily: typography.fonts.mono,
                  fontSize: typography.text.xs.fontSize,
                  lineHeight: typography.text.xs.lineHeight,
                  color: colors.surface[400],
                }}
              >
                {filename}
              </span>
            </div>

            {/* Code area */}
            <div
              style={{
                display: 'flex',
              }}
            >
              {accentColor && (
                <div
                  style={{
                    width: '4px',
                    backgroundColor: accentColor,
                    opacity: 0.4,
                    flexShrink: 0,
                  }}
                />
              )}
              <div
                style={{
                  flex: 1,
                  padding: '16px',
                  overflowX: 'auto',
                  fontFamily: typography.fonts.mono,
                  fontSize: typography.text.sm.fontSize,
                  lineHeight: typography.text.sm.lineHeight,
                  color: colors.surface[600],
                }}
                dangerouslySetInnerHTML={{ __html: code }}
              />
            </div>

            {/* Legend */}
            {legendItems.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                  padding: '10px 16px',
                  borderTop: '1px solid rgba(226,232,240,0.8)',
                  fontSize: typography.text.xs.fontSize,
                  lineHeight: typography.text.xs.lineHeight,
                }}
              >
                {legendItems.map((item) => (
                  <span key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        backgroundColor: item.color,
                        opacity: 0.6,
                      }}
                    />
                    <span style={{ color: colors.text.secondary }}>{item.label}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </Section>
      </section>
    );
  },
};
