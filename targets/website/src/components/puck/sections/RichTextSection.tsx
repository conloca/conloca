import type { ComponentConfig } from '@puckeditor/core';
import { Section } from '../../Section';
import { colors, typography } from '../shared/tokens';

export type RichTextSectionProps = {
  title: string;
  body: string;
};

export const RichTextSection: ComponentConfig<RichTextSectionProps> = {
  label: 'Rich Text Section',
  fields: {
    title: { type: 'text', contentEditable: true },
    body: { type: 'textarea', label: 'Body (HTML)' },
  },
  defaultProps: {
    title: 'Section Title',
    body: '<p>Section body text goes here.</p>',
  },
  render: ({ title, body }) => {
    return (
      <section style={{ marginBottom: '80px' }}>
        <Section maxWidth="896px">
          {title && (
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
              {title}
            </h2>
          )}
          <div
            style={{
              fontFamily: typography.fonts.body,
              fontSize: typography.text.sm.fontSize,
              lineHeight: '1.6',
              color: colors.text.secondary,
            }}
            dangerouslySetInnerHTML={{ __html: body }}
          />
        </Section>
      </section>
    );
  },
};
