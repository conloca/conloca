import type { ComponentConfig } from '@puckeditor/core';
import cn from 'clsx';
import type { JSX } from 'react';
import { EmptySlotPlaceholder } from '../shared/EmptySlotPlaceholder';

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
  /** String 'true'/'false' from radio field, or boolean from legacy saved data */
  waitlistEnabled: boolean | 'true' | 'false';
};

function shouldShowWaitlist(waitlistEnabled: HostedComparisonProps['waitlistEnabled']) {
  return waitlistEnabled === true || waitlistEnabled === 'true';
}

function CheckIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      className="text-brand-600 dark:text-brand-400 mx-auto"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
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
      className="text-surface-400 mx-auto"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 12H6" />
    </svg>
  );
}

function renderCellValue(value: string) {
  if (value === 'true') return <CheckIcon />;
  if (value === 'false') return <DashIcon />;
  return <span className="text-xs text-surface-500">{value}</span>;
}

function WaitlistForm({ isEditing }: { isEditing: boolean }) {
  return (
    <div>
      <form
        data-subscribe-form
        data-subscribe-success-message="You're on the list! We'll be in touch."
        action="/api/subscribe"
        method="post"
        className="flex flex-col sm:flex-row gap-3"
      >
        <input type="hidden" name="intent" value="hosted" />
        <input
          type="email"
          name="email"
          required
          placeholder="you@company.com"
          autoComplete="email"
          aria-label="Email address for waitlist"
          disabled={isEditing}
          className="flex-1 bg-surface-100 dark:bg-surface-800/60 border border-surface-300 dark:border-surface-700/60 rounded-lg px-4 py-3 text-sm text-surface-900 dark:text-white placeholder:text-surface-400 dark:placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500"
        />
        <button
          type="submit"
          disabled={isEditing}
          className="bg-brand-500 hover:bg-brand-400 text-surface-950 font-semibold px-6 py-3 rounded-lg transition-all duration-200 text-sm whitespace-nowrap hover:shadow-lg hover:shadow-brand-500/20"
        >
          Join Waitlist
        </button>
      </form>
      <p data-subscribe-message className={cn('mt-3 text-sm', isEditing && 'hidden')} />
      {isEditing && <p className="mt-3 text-sm text-surface-500">Form submission is disabled while editing in Puck.</p>}
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
    <section id="cloud" className="py-24 sm:py-32 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-surface-50 dark:from-surface-950 via-surface-100/50 dark:via-surface-900/50 to-surface-50 dark:to-surface-950" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,rgba(6,182,212,0.03)_0%,transparent_60%)] dark:bg-[radial-gradient(ellipse_at_bottom,rgba(6,182,212,0.06)_0%,transparent_60%)]" />
      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          {badgeText && (
            <span className="inline-flex items-center gap-2 border border-brand-500/30 bg-brand-500/5 rounded-full px-4 py-1.5 text-xs text-brand-600 dark:text-brand-400 font-medium mb-6">
              {badgeText}
            </span>
          )}
          <h2 className="text-3xl sm:text-4xl font-bold text-surface-900 dark:text-white mb-4">{title}</h2>
          <p className="text-surface-500 dark:text-surface-400 max-w-2xl mx-auto">{subtitle}</p>
        </div>

        {/* Image placeholders */}
        <div className="grid md:grid-cols-2 gap-6 mb-16">
          {['Screenshot: Visual editor', 'Screenshot: Git commit by marketer'].map((text) => (
            <div
              key={text}
              className={cn(
                'bg-surface-100/60 dark:bg-surface-900/60 border border-surface-200/80 dark:border-surface-800/50 border-dashed rounded-xl aspect-video flex items-center justify-center',
                { reveal: !puck.isEditing },
              )}
            >
              <div className="text-center">
                <svg
                  width="40"
                  height="40"
                  viewBox="0 0 24 24"
                  fill="none"
                  className="text-surface-400 mx-auto mb-3"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <p className="text-surface-500 text-sm font-medium">{text}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Comparison table */}
        {rows.length === 0 ? (
          <div className="max-w-3xl mx-auto mb-16">
            <EmptySlotPlaceholder label="Add comparison rows using the sidebar panel" />
          </div>
        ) : (
          <div className={cn('max-w-3xl mx-auto mb-16', { reveal: !puck.isEditing })}>
            <div className="bg-surface-100/60 dark:bg-surface-900/60 border border-surface-200/80 dark:border-surface-800/50 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-surface-200/80 dark:border-surface-800/60">
                      <th className="text-left text-sm font-medium text-surface-500 dark:text-surface-400 px-6 py-4">
                        Feature
                      </th>
                      <th className="text-center text-sm font-medium text-surface-500 dark:text-surface-400 px-6 py-4">
                        Open Source
                      </th>
                      <th className="text-center text-sm font-medium px-6 py-4">
                        <span className="text-brand-600 dark:text-brand-400">Hosted</span>
                        <span className="text-surface-500 text-xs ml-1">(Coming Soon)</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr
                        key={row.id}
                        className={cn(
                          'border-b border-surface-200/30 dark:border-surface-800/30',
                          i % 2 === 0 && 'bg-surface-200/30 dark:bg-surface-800/10',
                        )}
                      >
                        <td className="px-6 py-3.5 text-sm text-surface-600 dark:text-surface-300">{row.feature}</td>
                        <td className="px-6 py-3.5 text-center">{renderCellValue(row.oss)}</td>
                        <td className="px-6 py-3.5 text-center">{renderCellValue(row.hosted)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Waitlist CTA */}
        {shouldShowWaitlist(waitlistEnabled) && (
          <div className={cn('max-w-md mx-auto text-center', { reveal: !puck.isEditing })}>
            <h3 className="text-xl font-semibold text-surface-900 dark:text-white mb-2">{ctaTitle}</h3>
            <p className="text-surface-500 dark:text-surface-400 text-sm mb-6">{ctaSubtitle}</p>
            <WaitlistForm isEditing={puck.isEditing} />
          </div>
        )}
      </div>
    </section>
  );
};

export const HostedComparison: ComponentConfig<HostedComparisonProps> = {
  label: 'Hosted Comparison',
  resolveFields: (data, { fields }) => {
    const showCta = shouldShowWaitlist(data.props.waitlistEnabled);
    return {
      ...fields,
      ctaTitle: { ...fields.ctaTitle, visible: showCta },
      ctaSubtitle: { ...fields.ctaSubtitle, visible: showCta },
    };
  },
  fields: {
    badgeText: { type: 'text', label: 'Badge Text', contentEditable: true },
    title: { type: 'text', contentEditable: true },
    subtitle: { type: 'textarea', contentEditable: true },
    rows: {
      type: 'array',
      min: 1,
      getItemSummary: (item) => item.feature || 'Row',
      defaultItemProps: () => ({ id: crypto.randomUUID(), feature: 'Feature', oss: 'true', hosted: 'true' }),
      arrayFields: {
        id: { type: 'text', visible: false },
        feature: { type: 'text' },
        oss: {
          type: 'select',
          label: 'Open Source',
          options: [
            { label: 'Yes', value: 'true' },
            { label: 'No', value: 'false' },
          ],
        },
        hosted: {
          type: 'select',
          label: 'Hosted',
          options: [
            { label: 'Yes', value: 'true' },
            { label: 'No', value: 'false' },
          ],
        },
      },
    },
    waitlistEnabled: {
      type: 'radio',
      label: 'Show Waitlist Form',
      options: [
        { label: 'Yes', value: 'true' },
        { label: 'No', value: 'false' },
      ],
    },
    ctaTitle: { type: 'text', label: 'CTA Title', contentEditable: true },
    ctaSubtitle: { type: 'textarea', label: 'CTA Subtitle', contentEditable: true },
  },
  defaultProps: {
    badgeText: 'Coming Soon',
    title: 'Conloca Cloud -- visual editing without the setup',
    subtitle: 'All the power of Conloca, fully managed. Your team edits visually while you keep full git ownership.',
    rows: [
      { id: crypto.randomUUID(), feature: 'Visual Editor', oss: 'true', hosted: 'true' },
      { id: crypto.randomUUID(), feature: 'Managed Hosting', oss: 'false', hosted: 'true' },
    ],
    ctaTitle: 'Get early access',
    ctaSubtitle: 'Be first to know when Conloca Cloud launches.',
    waitlistEnabled: 'true',
  },
  render: HostedComparisonRender,
};
