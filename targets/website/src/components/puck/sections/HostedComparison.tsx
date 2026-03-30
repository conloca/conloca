import { withHydration } from '@conloca/astro-cms/hydration';
import type { ComponentConfig } from '@puckeditor/core';
import type { CSSProperties, FormEvent, JSX } from 'react';
import { useState } from 'react';
import { Section } from '../../Section';
import { buttonSpacing, colors, radius, sectionSpacing, typography } from '../shared/tokens';

type ComparisonRow = {
  id: string;
  feature: string;
  oss: string;
  hosted: string;
};

export type HostedComparisonProps = {
  badgeText: string;
  title: string;
  subtitle: string;
  rows: ComparisonRow[];
  ctaTitle: string;
  ctaSubtitle: string;
  waitlistEnabled: boolean;
};

function CheckIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke={colors.brand[600]}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ margin: '0 auto' }}
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

function DashIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke={colors.text.secondary}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ margin: '0 auto' }}
    >
      <path d="M18 12H6" />
    </svg>
  );
}

function renderCellValue(value: string) {
  if (value === 'true') return <CheckIcon />;
  if (value === 'false') return <DashIcon />;
  return (
    <span
      style={{
        fontSize: typography.text.xs.fontSize,
        lineHeight: typography.text.xs.lineHeight,
        color: colors.text.secondary,
      }}
    >
      {value}
    </span>
  );
}

function WaitlistForm({ isEditing }: { isEditing: boolean }) {
  const [message, setMessage] = useState('');

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isEditing) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    const email = data.get('email') as string;
    if (!email) return;

    fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, intent: 'hosted' }),
    })
      .then((res) => {
        if (res.ok) {
          setMessage("Thanks! We'll be in touch.");
          form.reset();
        } else {
          setMessage('Something went wrong. Please try again.');
        }
      })
      .catch(() => {
        setMessage('Something went wrong. Please try again.');
      });
  }

  return (
    <div>
      <form
        onSubmit={handleSubmit}
        style={{
          display: 'flex',
          gap: '12px',
          maxWidth: '448px',
          margin: '0 auto',
        }}
      >
        <input type="hidden" name="intent" value="hosted" />
        <input
          type="email"
          name="email"
          required
          placeholder="you@company.com"
          autoComplete="email"
          aria-label="Email address for waitlist"
          style={{
            flex: 1,
            backgroundColor: colors.bg.card,
            border: `1px solid ${colors.interactive.secondary.border}`,
            borderRadius: radius.md,
            padding: '12px 16px',
            fontSize: typography.text.sm.fontSize,
            lineHeight: typography.text.sm.lineHeight,
            fontFamily: typography.fonts.body,
            color: colors.text.primary,
            outline: 'none',
          }}
        />
        <button
          type="submit"
          style={{
            backgroundColor: colors.interactive.primary.bg,
            color: colors.interactive.primary.text,
            fontWeight: typography.weights.semibold,
            fontFamily: typography.fonts.body,
            fontSize: typography.text.sm.fontSize,
            lineHeight: typography.text.sm.lineHeight,
            padding: `${buttonSpacing.lg.paddingY} ${buttonSpacing.lg.paddingX}`,
            borderRadius: radius.md,
            border: 'none',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Join Waitlist
        </button>
      </form>
      {message && (
        <p
          style={{
            marginTop: '12px',
            fontSize: typography.text.sm.fontSize,
            color: colors.text.secondary,
          }}
        >
          {message}
        </p>
      )}
    </div>
  );
}

export const HostedComparisonRender = ({
  badgeText,
  title,
  subtitle,
  rows,
  ctaTitle,
  ctaSubtitle,
  waitlistEnabled,
  puck,
}: HostedComparisonProps & { puck: { isEditing: boolean } }): JSX.Element => {
  return (
    <section
      style={{
        position: 'relative',
        overflow: 'hidden',
        paddingTop: sectionSpacing.desktop.md.paddingY,
        paddingBottom: sectionSpacing.desktop.lg.paddingY,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(to bottom, var(--color-bg-primary), var(--color-card-bg-alpha), var(--color-bg-primary))',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(ellipse at bottom, rgba(6,182,212,0.03) 0%, transparent 60%)',
        }}
      />
      <Section style={{ position: 'relative' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '64px' }}>
          {badgeText && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 16px',
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
              maxWidth: '672px',
              margin: '0 auto',
            }}
          >
            {subtitle}
          </p>
        </div>

        {/* Image placeholders */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '24px',
            marginBottom: '64px',
          }}
        >
          {['Screenshot: Visual editor', 'Screenshot: Git commit by marketer'].map((text) => (
            <div
              key={text}
              className="reveal"
              style={{
                backgroundColor: 'var(--color-card-bg-alpha)',
                border: '1px dashed var(--color-card-border-alpha)',
                borderRadius: radius.xl,
                aspectRatio: '16 / 9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div style={{ textAlign: 'center' }}>
                <svg
                  width="40"
                  height="40"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={colors.text.secondary}
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ margin: '0 auto 12px' }}
                >
                  <path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <p
                  style={{
                    fontFamily: typography.fonts.body,
                    fontSize: typography.text.sm.fontSize,
                    fontWeight: typography.weights.medium,
                    color: colors.text.secondary,
                    margin: 0,
                  }}
                >
                  {text}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Comparison table */}
        <div className="reveal" style={{ maxWidth: '768px', margin: '0 auto 64px' }}>
          <div
            style={{
              backgroundColor: 'var(--color-card-bg-alpha)',
              border: '1px solid var(--color-card-border-alpha)',
              borderRadius: radius['2xl'],
              overflow: 'hidden',
            }}
          >
            <div style={{ overflowX: 'auto' }}>
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
                      }}
                    >
                      Feature
                    </th>
                    <th
                      style={{
                        textAlign: 'center',
                        fontSize: typography.text.sm.fontSize,
                        lineHeight: typography.text.sm.lineHeight,
                        fontWeight: typography.weights.medium,
                        fontFamily: typography.fonts.body,
                        color: colors.text.secondary,
                        padding: '16px 24px',
                      }}
                    >
                      Open Source
                    </th>
                    <th
                      style={{
                        textAlign: 'center',
                        fontSize: typography.text.sm.fontSize,
                        lineHeight: typography.text.sm.lineHeight,
                        fontWeight: typography.weights.medium,
                        fontFamily: typography.fonts.body,
                        padding: '16px 24px',
                      }}
                    >
                      <span style={{ color: colors.brand[600] }}>Hosted</span>
                      <span
                        style={{
                          color: colors.text.secondary,
                          fontSize: typography.text.xs.fontSize,
                          marginLeft: '4px',
                        }}
                      >
                        (Coming Soon)
                      </span>
                    </th>
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
                      <td
                        style={{
                          padding: '14px 24px',
                          fontSize: typography.text.sm.fontSize,
                          lineHeight: typography.text.sm.lineHeight,
                          fontFamily: typography.fonts.body,
                          color: colors.text.secondary,
                        }}
                      >
                        {row.feature}
                      </td>
                      <td style={{ padding: '14px 24px', textAlign: 'center' }}>{renderCellValue(row.oss)}</td>
                      <td style={{ padding: '14px 24px', textAlign: 'center' }}>{renderCellValue(row.hosted)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Waitlist CTA */}
        <div className="reveal" style={{ maxWidth: '448px', margin: '0 auto', textAlign: 'center' }}>
          <h3
            style={{
              fontFamily: typography.fonts.body,
              fontSize: typography.text.xl.fontSize,
              lineHeight: typography.text.xl.lineHeight,
              fontWeight: typography.weights.semibold,
              color: colors.text.heading,
              margin: 0,
              marginBottom: '8px',
            }}
          >
            {ctaTitle}
          </h3>
          <p
            style={{
              fontFamily: typography.fonts.body,
              fontSize: typography.text.sm.fontSize,
              lineHeight: typography.text.sm.lineHeight,
              fontWeight: typography.weights.regular,
              color: colors.text.secondary,
              margin: 0,
              marginBottom: '24px',
            }}
          >
            {ctaSubtitle}
          </p>
          {waitlistEnabled && <WaitlistForm isEditing={puck.isEditing} />}
        </div>
      </Section>
    </section>
  );
};

export const HostedComparison: ComponentConfig<HostedComparisonProps> = {
  label: 'Hosted Comparison',
  fields: {
    badgeText: { type: 'text', label: 'Badge Text' },
    title: { type: 'text', contentEditable: true },
    subtitle: { type: 'textarea' },
    rows: {
      type: 'array',
      getItemSummary: (item) => item.feature || 'Row',
      defaultItemProps: { id: `row-${Date.now()}`, feature: 'Feature', oss: 'true', hosted: 'true' },
      arrayFields: {
        id: { type: 'text', label: 'ID' },
        feature: { type: 'text' },
        oss: { type: 'text', label: 'OSS (true/false/text)' },
        hosted: { type: 'text', label: 'Hosted (true/false/text)' },
      },
    },
    ctaTitle: { type: 'text', label: 'CTA Title' },
    ctaSubtitle: { type: 'textarea', label: 'CTA Subtitle' },
    waitlistEnabled: {
      type: 'radio',
      label: 'Show Waitlist Form',
      options: [
        { label: 'Yes', value: 'true' },
        { label: 'No', value: 'false' },
      ],
    },
  },
  defaultProps: {
    badgeText: 'Coming Soon',
    title: 'Conloca Cloud -- visual editing without the setup',
    subtitle: 'All the power of Conloca, fully managed. Your team edits visually while you keep full git ownership.',
    rows: [],
    ctaTitle: 'Get early access',
    ctaSubtitle: 'Be first to know when Conloca Cloud launches.',
    waitlistEnabled: true,
  },
  render: withHydration(HostedComparisonRender, 'visible'),
};
