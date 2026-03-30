import type { ComponentConfig } from '@puckeditor/core';
import { Section } from '../../Section';
import { colors, radius, sectionSpacing, typography } from '../shared/tokens';

type Step = {
  id: string;
  number: string;
  title: string;
  description: string;
  code: string;
};

export type StepsProps = {
  label: string;
  title: string;
  subtitle: string;
  steps: Step[];
};

export const Steps: ComponentConfig<StepsProps> = {
  label: 'Quick Start Steps',
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
    steps: {
      type: 'array',
      getItemSummary: (item) => item.title || 'Step',
      defaultItemProps: {
        id: `step-${Date.now()}`,
        number: '01',
        title: 'Step Title',
        description: 'Step description.',
        code: 'echo "hello"',
      },
      arrayFields: {
        id: { type: 'text', label: 'ID (unique)' },
        number: { type: 'text', label: 'Step Number (e.g. 01)' },
        title: { type: 'text' },
        description: { type: 'textarea' },
        code: { type: 'textarea', label: 'Code' },
      },
    },
  },
  defaultProps: {
    label: 'Quick Start',
    title: 'Up and running in 4 steps',
    subtitle: 'Add a visual CMS to any Astro project in minutes. No database required.',
    steps: [
      {
        id: 'step-1',
        number: '01',
        title: 'Install',
        description: 'Add the Conloca CMS package to your Astro project with a single command.',
        code: 'bun add @conloca/astro-cms',
      },
      {
        id: 'step-2',
        number: '02',
        title: 'Configure',
        description: 'Add the integration to your Astro config and point it to your content directory.',
        code: `import { conlocaCMS } from '@conloca/astro-cms/node'

export default defineConfig({
  integrations: [
    conlocaCMS({
      contentRoot: './content',
      puckConfigPath: './src/puck.config.tsx',
    })
  ],
})`,
      },
      {
        id: 'step-3',
        number: '03',
        title: 'Define Components',
        description: 'Create your visual building blocks with fields and render functions.',
        code: `export const components = {
  Hero: {
    fields: { title: { type: "text" } },
    render: ({ title }) => <h1>{title}</h1>,
  },
}`,
      },
      {
        id: 'step-4',
        number: '04',
        title: 'Edit Visually',
        description: 'Open the CMS route in your browser and start editing pages visually.',
        code: 'http://localhost:4321/__cms',
      },
    ],
  },
  render: ({ label, title, subtitle, steps }) => {
    return (
      <section
        itemScope
        itemType="https://schema.org/HowTo"
        style={{
          paddingTop: sectionSpacing.desktop.md.paddingY,
          paddingBottom: sectionSpacing.desktop.md.paddingY,
        }}
      >
        <Section>
          <meta itemProp="name" content="How to add Conloca CMS to an Astro project" />
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
                  letterSpacing: '0.05em',
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
                fontSize: typography.display.sm.fontSize,
                lineHeight: typography.display.sm.lineHeight,
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

          {/* Steps list */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '24px',
            }}
          >
            {steps.map((step) => (
              <div
                key={step.id}
                className="reveal"
                itemProp="step"
                itemScope
                itemType="https://schema.org/HowToStep"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '280px 1fr',
                  gap: '24px',
                  backgroundColor: colors.bg.card,
                  border: `1px solid ${colors.border.primary}`,
                  borderRadius: radius.xl,
                  padding: '32px',
                }}
              >
                {/* Left column: step info */}
                <div>
                  <span
                    style={{
                      fontFamily: typography.fonts.mono,
                      fontSize: typography.text.sm.fontSize,
                      lineHeight: typography.text.sm.lineHeight,
                      fontWeight: typography.weights.medium,
                      color: colors.brand[600],
                    }}
                  >
                    {step.number}
                  </span>
                  <h3
                    itemProp="name"
                    style={{
                      fontFamily: typography.fonts.body,
                      fontSize: typography.text.xl.fontSize,
                      lineHeight: typography.text.xl.lineHeight,
                      fontWeight: typography.weights.semibold,
                      color: colors.text.heading,
                      margin: 0,
                      marginTop: '4px',
                    }}
                  >
                    {step.title}
                  </h3>
                  <p
                    itemProp="text"
                    style={{
                      fontFamily: typography.fonts.body,
                      fontSize: typography.text.sm.fontSize,
                      lineHeight: '1.6',
                      fontWeight: typography.weights.regular,
                      color: colors.text.secondary,
                      margin: 0,
                      marginTop: '8px',
                    }}
                  >
                    {step.description}
                  </p>
                </div>

                {/* Right column: terminal code block */}
                <div
                  style={{
                    backgroundColor: colors.surface[50],
                    border: `1px solid ${colors.border.primary}`,
                    borderRadius: radius.lg,
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
                      borderBottom: `1px solid ${colors.border.primary}`,
                    }}
                  >
                    <span
                      style={{
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        backgroundColor: colors.surface[300],
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        backgroundColor: colors.surface[300],
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        backgroundColor: colors.surface[300],
                        flexShrink: 0,
                      }}
                    />
                  </div>
                  {/* Code area */}
                  <pre
                    style={{
                      margin: 0,
                      padding: '20px 16px',
                      overflowX: 'auto',
                    }}
                  >
                    <code
                      style={{
                        fontFamily: typography.fonts.mono,
                        fontSize: typography.text.sm.fontSize,
                        lineHeight: typography.text.sm.lineHeight,
                        color: colors.surface[700],
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                      }}
                    >
                      {step.code}
                    </code>
                  </pre>
                </div>
              </div>
            ))}
          </div>
        </Section>
      </section>
    );
  },
};
