import type { ComponentConfig } from '@puckeditor/core';
import cn from 'clsx';
import { SectionHeader } from '../shared';
import { EmptySlotPlaceholder } from '../shared/EmptySlotPlaceholder';

type Testimonial = {
  id: string;
  quote: string;
  authorName: string;
  authorRole: string;
  authorCompany: string;
  authorAvatarUrl: string;
  rating: number;
};

type TestimonialColumns = '1' | '2' | '3';

export type TestimonialsProps = {
  label: string;
  title: string;
  subtitle: string;
  items: Testimonial[];
  columns: TestimonialColumns;
};

const gridColsClass: Record<TestimonialColumns, string> = {
  '1': 'grid gap-6 max-w-2xl mx-auto',
  '2': 'grid sm:grid-cols-2 gap-6',
  '3': 'grid sm:grid-cols-2 lg:grid-cols-3 gap-6',
};

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5 mb-3">
      {Array.from({ length: 5 }, (_, i) => (
        <svg
          key={i}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill={i < rating ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="2"
          className={i < rating ? 'text-amber-400' : 'text-surface-300 dark:text-surface-700'}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
          />
        </svg>
      ))}
    </div>
  );
}

export const Testimonials: ComponentConfig<TestimonialsProps> = {
  label: 'Testimonials',
  resolveFields: (data, { fields }) => {
    const count = data.props.items?.length || 0;
    const allOptions = [
      { label: '1 Column', value: '1' },
      { label: '2 Columns', value: '2' },
      { label: '3 Columns', value: '3' },
    ];
    const filtered = count > 0 ? allOptions.filter((o) => Number(o.value) <= count) : allOptions;
    return {
      ...fields,
      columns: {
        ...fields.columns,
        visible: count > 1,
        options: filtered.length > 0 ? filtered : allOptions,
      },
    } as typeof fields;
  },
  fields: {
    label: { type: 'text', label: 'Section Label', contentEditable: true },
    title: { type: 'text', contentEditable: true },
    subtitle: { type: 'textarea', contentEditable: true },
    items: {
      type: 'array',
      min: 1,
      max: 9,
      getItemSummary: (item) => item.authorName || 'Testimonial',
      defaultItemProps: () => ({
        id: crypto.randomUUID(),
        quote: 'This product has completely transformed our workflow.',
        authorName: 'Jane Smith',
        authorRole: 'CTO',
        authorCompany: 'Acme Corp',
        authorAvatarUrl: '',
        rating: 5,
      }),
      arrayFields: {
        id: { type: 'text', visible: false },
        quote: { type: 'textarea' },
        authorName: { type: 'text', label: 'Name' },
        authorRole: { type: 'text', label: 'Role' },
        authorCompany: { type: 'text', label: 'Company' },
        authorAvatarUrl: { type: 'text', label: 'Avatar URL (optional)' },
        rating: { type: 'number', label: 'Star Rating (0-5)', min: 0, max: 5 },
      },
    },
    columns: {
      type: 'select',
      label: 'Columns',
      options: [
        { label: '1 Column', value: '1' },
        { label: '2 Columns', value: '2' },
        { label: '3 Columns', value: '3' },
      ],
    },
  },
  defaultProps: {
    label: 'Testimonials',
    title: 'What people are saying',
    subtitle: '',
    columns: '3',
    items: [
      {
        id: crypto.randomUUID(),
        quote: 'Finally a CMS that respects our git workflow. No more vendor lock-in.',
        authorName: 'Alex Chen',
        authorRole: 'Lead Developer',
        authorCompany: 'TechStart',
        authorAvatarUrl: '',
        rating: 5,
      },
      {
        id: crypto.randomUUID(),
        quote: 'The visual editor is intuitive enough for our marketing team, and everything stays in the repo.',
        authorName: 'Sarah Park',
        authorRole: 'Marketing Director',
        authorCompany: 'GrowthCo',
        authorAvatarUrl: '',
        rating: 5,
      },
      {
        id: crypto.randomUUID(),
        quote: 'Setup took 10 minutes. No database, no external service. Just works.',
        authorName: 'Marcus Liu',
        authorRole: 'Freelance Developer',
        authorCompany: '',
        authorAvatarUrl: '',
        rating: 4,
      },
    ],
  },
  render: ({ label, title, subtitle, items, columns, puck }) => {
    return (
      <section className="py-16 sm:py-24">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader label={label} title={title} subtitle={subtitle} />

          {items.length === 0 ? (
            <EmptySlotPlaceholder label="Add testimonials using the sidebar panel" />
          ) : (
            <div className={gridColsClass[columns]}>
              {items.map((item, idx) => (
                <div
                  key={item.id}
                  className={cn(
                    'bg-surface-100/60 dark:bg-surface-900/40 border border-surface-200/80 dark:border-surface-800/50 rounded-xl p-6 flex flex-col',
                    { reveal: !puck.isEditing },
                  )}
                  style={puck.isEditing ? undefined : { animationDelay: `${idx * 0.08}s` }}
                >
                  {item.rating > 0 && <StarRating rating={item.rating} />}

                  <blockquote className="text-surface-700 dark:text-surface-300 text-sm leading-relaxed mb-6 flex-1">
                    &ldquo;{item.quote}&rdquo;
                  </blockquote>

                  <div className="flex items-center gap-3 pt-4 border-t border-surface-200/50 dark:border-surface-800/50">
                    {item.authorAvatarUrl ? (
                      <img
                        src={item.authorAvatarUrl}
                        alt={item.authorName}
                        className="w-10 h-10 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-brand-500/10 border border-brand-500/20 flex items-center justify-center">
                        <span className="text-brand-600 dark:text-brand-400 font-semibold text-sm">
                          {item.authorName.charAt(0)}
                        </span>
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-medium text-surface-900 dark:text-white">{item.authorName}</p>
                      <p className="text-xs text-surface-500 dark:text-surface-400">
                        {[item.authorRole, item.authorCompany].filter(Boolean).join(', ')}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    );
  },
};
