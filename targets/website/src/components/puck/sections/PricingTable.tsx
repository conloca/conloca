import type { ComponentConfig } from '@puckeditor/core';
import cn from 'clsx';
import { type CTAButton, CTAButtonGroup, ctaButtonArrayField, SectionHeader } from '../shared';
import { EmptySlotPlaceholder } from '../shared/EmptySlotPlaceholder';

type PricingFeature = {
  id: string;
  text: string;
  included: 'true' | 'false';
};

type PricingTier = {
  id: string;
  name: string;
  price: string;
  period: string;
  description: string;
  features: PricingFeature[];
  highlighted: 'true' | 'false';
  buttons: CTAButton[];
};

export type PricingTableProps = {
  label: string;
  title: string;
  subtitle: string;
  tiers: PricingTier[];
};

function CheckIcon({ included }: { included: boolean }) {
  return included ? (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-brand-500 shrink-0"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  ) : (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-surface-300 dark:text-surface-700 shrink-0"
    >
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

export const PricingTable: ComponentConfig<PricingTableProps> = {
  label: 'Pricing Table',
  fields: {
    label: { type: 'text', label: 'Section Label', contentEditable: true },
    title: { type: 'text', contentEditable: true },
    subtitle: { type: 'textarea', contentEditable: true },
    tiers: {
      type: 'array',
      min: 1,
      max: 4,
      getItemSummary: (item) => (item.name && item.price ? `${item.name} — ${item.price}` : item.name || 'Tier'),
      defaultItemProps: () => ({
        id: crypto.randomUUID(),
        name: 'Plan',
        price: '$0',
        period: '/month',
        description: 'For individuals getting started.',
        features: [
          { id: crypto.randomUUID(), text: 'Basic features', included: 'true' as const },
          { id: crypto.randomUUID(), text: 'Community support', included: 'true' as const },
          { id: crypto.randomUUID(), text: 'Premium features', included: 'false' as const },
        ],
        highlighted: 'false' as const,
        buttons: [{ id: crypto.randomUUID(), label: 'Get Started', href: '#', variant: 'secondary' as const }],
      }),
      arrayFields: {
        id: { type: 'text', visible: false },
        name: { type: 'text', label: 'Plan Name' },
        price: { type: 'text', label: 'Price' },
        period: { type: 'text', label: 'Period (e.g. /month)' },
        description: { type: 'textarea' },
        highlighted: {
          type: 'radio',
          label: 'Highlighted',
          options: [
            { label: 'No', value: 'false' },
            { label: 'Yes (recommended tier)', value: 'true' },
          ],
        },
        features: {
          type: 'array',
          label: 'Features',
          getItemSummary: (item: PricingFeature) => item.text || 'Feature',
          defaultItemProps: () => ({
            id: crypto.randomUUID(),
            text: 'Feature',
            included: 'true' as const,
          }),
          arrayFields: {
            id: { type: 'text', visible: false },
            text: { type: 'text' },
            included: {
              type: 'radio',
              label: 'Included',
              options: [
                { label: 'Yes', value: 'true' },
                { label: 'No', value: 'false' },
              ],
            },
          },
        },
        buttons: ctaButtonArrayField({ max: 2 }),
      },
    },
  },
  defaultProps: {
    label: 'Pricing',
    title: 'Simple, transparent pricing',
    subtitle: 'Choose the plan that works for you.',
    tiers: [
      {
        id: crypto.randomUUID(),
        name: 'Open Source',
        price: 'Free',
        period: '',
        description: 'Everything you need for personal projects.',
        highlighted: 'false',
        features: [
          { id: crypto.randomUUID(), text: 'Unlimited pages', included: 'true' },
          { id: crypto.randomUUID(), text: 'Visual drag & drop editor', included: 'true' },
          { id: crypto.randomUUID(), text: 'Git-native storage', included: 'true' },
          { id: crypto.randomUUID(), text: 'Community support', included: 'true' },
          { id: crypto.randomUUID(), text: 'Team collaboration', included: 'false' },
        ],
        buttons: [{ id: crypto.randomUUID(), label: 'Get Started', href: '#', variant: 'secondary' }],
      },
      {
        id: crypto.randomUUID(),
        name: 'Cloud',
        price: '$29',
        period: '/month',
        description: 'For teams that need collaboration features.',
        highlighted: 'true',
        features: [
          { id: crypto.randomUUID(), text: 'Unlimited pages', included: 'true' },
          { id: crypto.randomUUID(), text: 'Visual drag & drop editor', included: 'true' },
          { id: crypto.randomUUID(), text: 'Git-native storage', included: 'true' },
          { id: crypto.randomUUID(), text: 'Priority support', included: 'true' },
          { id: crypto.randomUUID(), text: 'Team collaboration', included: 'true' },
        ],
        buttons: [{ id: crypto.randomUUID(), label: 'Start Free Trial', href: '#', variant: 'primary' }],
      },
    ],
  },
  render: ({ label, title, subtitle, tiers, puck }) => {
    return (
      <section className="py-16 sm:py-24">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader label={label} title={title} subtitle={subtitle} />

          {tiers.length === 0 ? (
            <EmptySlotPlaceholder label="Add pricing tiers using the sidebar panel" />
          ) : (
            <div
              className={cn(
                'grid gap-6',
                tiers.length === 1
                  ? 'max-w-md mx-auto'
                  : tiers.length === 2
                    ? 'sm:grid-cols-2 max-w-3xl mx-auto'
                    : tiers.length === 3
                      ? 'sm:grid-cols-2 lg:grid-cols-3'
                      : 'sm:grid-cols-2 lg:grid-cols-4',
              )}
            >
              {tiers.map((tier, idx) => {
                const isHighlighted = tier.highlighted === 'true';
                return (
                  <div
                    key={tier.id}
                    className={cn(
                      'rounded-xl p-6 flex flex-col',
                      isHighlighted
                        ? 'bg-brand-500/5 border-2 border-brand-500/30 relative'
                        : 'bg-surface-100/60 dark:bg-surface-900/40 border border-surface-200/80 dark:border-surface-800/50',
                      { reveal: !puck.isEditing },
                    )}
                    style={puck.isEditing ? undefined : { animationDelay: `${idx * 0.08}s` }}
                  >
                    {isHighlighted && (
                      <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-brand-500 text-surface-950 text-xs font-semibold px-3 py-1 rounded-full">
                        Recommended
                      </span>
                    )}

                    <h3 className="text-surface-900 dark:text-white font-semibold">{tier.name}</h3>

                    <div className="mt-3 mb-4">
                      <span className="text-3xl font-bold text-surface-900 dark:text-white">{tier.price}</span>
                      {tier.period && (
                        <span className="text-surface-500 dark:text-surface-400 text-sm">{tier.period}</span>
                      )}
                    </div>

                    <p className="text-surface-500 dark:text-surface-400 text-sm mb-6">{tier.description}</p>

                    <ul className="space-y-3 mb-8 flex-1">
                      {tier.features.map((feature) => (
                        <li key={feature.id} className="flex items-start gap-2">
                          <CheckIcon included={feature.included === 'true'} />
                          <span
                            className={cn(
                              'text-sm',
                              feature.included === 'true'
                                ? 'text-surface-700 dark:text-surface-300'
                                : 'text-surface-400 dark:text-surface-600',
                            )}
                          >
                            {feature.text}
                          </span>
                        </li>
                      ))}
                    </ul>

                    <CTAButtonGroup buttons={tier.buttons} isEditing={puck.isEditing} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    );
  },
};
