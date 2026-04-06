import type { ComponentConfig } from '@puckeditor/core';
import cn from 'clsx';
import { type CTAButton, ctaButtonArrayField } from '../shared';

export type HeroProps = {
  badgeText: string;
  title: string;
  description: string;
  buttons: CTAButton[];
};

export const Hero: ComponentConfig<HeroProps> = {
  label: 'Hero Section',
  resolvePermissions: () => ({ duplicate: false }),
  fields: {
    badgeText: {
      type: 'text',
      label: 'Badge Text',
      contentEditable: true,
    },
    title: {
      type: 'textarea',
      contentEditable: true,
    },
    description: {
      type: 'textarea',
      contentEditable: true,
    },
    buttons: ctaButtonArrayField(),
  },
  defaultProps: {
    badgeText: 'Open source - MIT Licensed',
    title: 'The file-based CMS that lives in your git repo',
    description:
      'Visual editing for marketers, full git ownership for developers. Powered by Puck with drag-and-drop components.',
    buttons: [
      { id: 'btn-1', label: 'Get Started', href: '#quickstart', variant: 'primary' },
      { id: 'btn-2', label: 'Join Waitlist', href: '#waitlist', variant: 'secondary' },
    ],
  },
  render: ({ badgeText, title, description, buttons, puck }) => {
    const isStringTitle = typeof title === 'string';
    const lines = isStringTitle ? title.split('\n') : [];
    const hasButtons = buttons.length > 0;

    if (!hasButtons) {
      return (
        <div className="text-center mb-16">
          {badgeText && (
            <p className="text-brand-600 dark:text-brand-400 text-sm font-medium tracking-wide uppercase mb-3">
              {badgeText}
            </p>
          )}
          <h1 className="text-3xl sm:text-4xl font-bold text-surface-900 dark:text-white mb-4">
            {isStringTitle
              ? lines.map((line, idx) => (
                  <span key={`${line.slice(0, 10)}-${idx}`}>
                    {idx === 0 ? line : <span className="text-brand-600 dark:text-brand-400">{line}</span>}
                    {idx < lines.length - 1 && <br />}
                  </span>
                ))
              : title}
          </h1>
          <p className="text-surface-500 dark:text-surface-400 max-w-2xl mx-auto">{description}</p>
        </div>
      );
    }

    return (
      <section
        itemScope
        itemType="https://schema.org/SoftwareApplication"
        className="relative flex items-center justify-center overflow-hidden min-h-screen pt-16"
      >
        <meta itemProp="applicationCategory" content="Content Management System" />
        <meta itemProp="operatingSystem" content="Cross-platform" />
        <meta
          itemProp="description"
          content="Conloca is a free, open-source, file-based content management system (CMS) built specifically for Astro websites. It stores all content as version-controlled files in your git repository -- no database required. Developers define drag-and-drop components with Puck, and content editors build pages visually through a browser-based interface at the /__cms route."
        />

        {/* Radial gradient overlay */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(6,182,212,0.04)_0%,transparent_70%)] dark:bg-[radial-gradient(ellipse_at_center,rgba(6,182,212,0.08)_0%,transparent_70%)]" />
        {/* Grid dots overlay */}
        <div className="absolute inset-0 grid-dots" />

        {/* Content container */}
        <div className="relative mx-auto px-4 sm:px-6 lg:px-8 text-center max-w-4xl">
          {/* Badge */}
          {badgeText && (
            <div
              className={cn(
                'inline-flex items-center gap-2 border border-surface-300 dark:border-surface-700/60 rounded-full px-4 py-1.5 mb-8 text-xs text-surface-500 dark:text-surface-400',
                { 'animate-fade-in': !puck.isEditing },
              )}
            >
              <span className={cn('w-1.5 h-1.5 rounded-full bg-brand-400', { 'animate-pulse': !puck.isEditing })} />
              {badgeText}
            </div>
          )}

          {/* Title */}
          <h1
            itemProp="name"
            className={cn(
              'font-bold text-surface-900 dark:text-white leading-tight tracking-tight mb-6 text-4xl sm:text-5xl lg:text-6xl',
              puck.isEditing ? '' : 'opacity-0 animate-slide-up',
            )}
          >
            {isStringTitle
              ? lines.map((line, idx) => (
                  <span key={`${line.slice(0, 10)}-${idx}`}>
                    {idx === 0 ? line : <span className="text-brand-600 dark:text-brand-400">{line}</span>}
                    {idx < lines.length - 1 && <br />}
                  </span>
                ))
              : title}
          </h1>

          {/* Description */}
          <p
            className={cn(
              'text-lg sm:text-xl text-surface-500 dark:text-surface-400 max-w-2xl mx-auto mb-10',
              puck.isEditing ? '' : 'opacity-0 animate-slide-up',
            )}
            style={puck.isEditing ? undefined : { animationDelay: '0.15s' }}
          >
            {description}
          </p>

          {/* Buttons */}
          <div
            className={cn(
              'flex flex-col sm:flex-row items-center justify-center gap-4 mb-8',
              puck.isEditing ? '' : 'opacity-0 animate-slide-up',
            )}
            style={puck.isEditing ? undefined : { animationDelay: '0.3s' }}
          >
            {buttons.map((button) => (
              <a
                key={button.id}
                href={button.href}
                className={cn(
                  button.variant === 'primary'
                    ? 'inline-flex items-center gap-2 bg-brand-500 hover:bg-brand-400 text-surface-950 font-semibold px-6 py-3 rounded-lg transition-all duration-200 hover:shadow-lg hover:shadow-brand-500/20 text-sm'
                    : 'inline-flex items-center gap-2 border border-surface-300 dark:border-surface-600 hover:border-surface-400 dark:hover:border-surface-500 text-surface-600 dark:text-surface-300 hover:text-surface-900 dark:hover:text-white font-medium px-6 py-3 rounded-lg transition-all duration-200 text-sm',
                )}
                onClick={puck.isEditing ? (e) => e.preventDefault() : undefined}
              >
                {button.label}
                {button.variant === 'primary' && (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                )}
              </a>
            ))}
          </div>

          {/* Terminal mock-up */}
          {hasButtons && (
            <div
              className={cn('max-w-lg mx-auto', puck.isEditing ? '' : 'opacity-0 animate-slide-up')}
              style={puck.isEditing ? undefined : { animationDelay: '0.45s' }}
            >
              <div className="bg-surface-100 dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-xl overflow-hidden shadow-2xl">
                {/* Title bar */}
                <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-200 dark:border-surface-800">
                  <div className="w-3 h-3 rounded-full bg-surface-300 dark:bg-surface-700" />
                  <div className="w-3 h-3 rounded-full bg-surface-300 dark:bg-surface-700" />
                  <div className="w-3 h-3 rounded-full bg-surface-300 dark:bg-surface-700" />
                  <span className="text-xs text-surface-500 dark:text-surface-400 ml-2 font-mono">Terminal</span>
                </div>
                {/* Command line */}
                <div className="px-5 py-4 font-mono text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-brand-600 dark:text-brand-400">$</span>
                    <span id="typed-command" className="text-surface-800 dark:text-surface-200" />
                    <span
                      id="cursor"
                      className={cn('inline-block w-2 h-5 bg-brand-400', { 'animate-blink': !puck.isEditing })}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Scroll-down arrow */}
        {hasButtons && (
          <div
            className={cn(
              'absolute bottom-8 left-1/2 -translate-x-1/2',
              puck.isEditing ? '' : 'opacity-0 animate-fade-in',
            )}
            style={puck.isEditing ? undefined : { animationDelay: '1.5s' }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={cn('text-surface-400', { 'animate-bounce': !puck.isEditing })}
            >
              <path d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </div>
        )}
      </section>
    );
  },
};
