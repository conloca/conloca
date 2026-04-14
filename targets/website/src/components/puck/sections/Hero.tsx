import type { ComponentConfig } from '@puckeditor/core';
import cn from 'clsx';
import { type CTAButton, CTAButtonGroup, ctaButtonArrayField } from '../shared';

type HeroVariant = 'marketing' | 'product' | 'minimal';

export type HeroProps = {
  variant: HeroVariant;
  badgeText: string;
  title: string;
  description: string;
  buttons: CTAButton[];
  terminalCommand: string;
  imageUrl: string;
  imageAlt: string;
};

function HeroBadge({ text, isEditing }: { text: string; isEditing: boolean }) {
  if (!text) return null;
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 border border-surface-300 dark:border-surface-700/60 rounded-full px-4 py-1.5 mb-8 text-xs text-surface-500 dark:text-surface-400',
        { 'animate-fade-in': !isEditing },
      )}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full bg-brand-400', { 'animate-pulse': !isEditing })} />
      {text}
    </div>
  );
}

function HeroTitle({ title, isEditing, large }: { title: string; isEditing: boolean; large: boolean }) {
  const lines = typeof title === 'string' ? title.split('\n') : [];
  return (
    <h1
      className={cn(
        'font-bold text-surface-900 dark:text-white leading-tight tracking-tight mb-6',
        large ? 'text-4xl sm:text-5xl lg:text-6xl' : 'text-3xl sm:text-4xl lg:text-5xl',
        isEditing ? '' : 'opacity-0 animate-slide-up',
      )}
    >
      {lines.map((line, idx) => (
        <span key={idx}>
          {idx === 0 ? line : <span className="text-brand-600 dark:text-brand-400">{line}</span>}
          {idx < lines.length - 1 && <br />}
        </span>
      ))}
    </h1>
  );
}

function TerminalMockup({ command, isEditing }: { command: string; isEditing: boolean }) {
  return (
    <div
      className={cn('max-w-lg mx-auto', isEditing ? '' : 'opacity-0 animate-slide-up')}
      style={isEditing ? undefined : { animationDelay: '0.45s' }}
    >
      <div className="bg-surface-100 dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-xl overflow-hidden shadow-2xl">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-200 dark:border-surface-800">
          <div className="w-3 h-3 rounded-full bg-surface-300 dark:bg-surface-700" />
          <div className="w-3 h-3 rounded-full bg-surface-300 dark:bg-surface-700" />
          <div className="w-3 h-3 rounded-full bg-surface-300 dark:bg-surface-700" />
          <span className="text-xs text-surface-500 dark:text-surface-400 ml-2 font-mono">Terminal</span>
        </div>
        <div className="px-5 py-4 font-mono text-sm">
          <div className="flex items-center gap-2">
            <span className="text-brand-600 dark:text-brand-400">$</span>
            <span data-typed-command={command} className="text-surface-800 dark:text-surface-200">
              {isEditing ? command : ''}
            </span>
            <span className={cn('inline-block w-2 h-5 bg-brand-400', { 'animate-blink': !isEditing })} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ScrollArrow({ isEditing }: { isEditing: boolean }) {
  return (
    <div
      className={cn('absolute bottom-8 left-1/2 -translate-x-1/2', isEditing ? '' : 'opacity-0 animate-fade-in')}
      style={isEditing ? undefined : { animationDelay: '1.5s' }}
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
        className={cn('text-surface-400', { 'animate-bounce': !isEditing })}
      >
        <path d="M19 14l-7 7m0 0l-7-7m7 7V3" />
      </svg>
    </div>
  );
}

function MarketingHero({
  badgeText,
  title,
  description,
  buttons,
  terminalCommand,
  puck,
}: HeroProps & { puck: { isEditing: boolean } }) {
  return (
    <section
      itemScope
      itemType="https://schema.org/SoftwareApplication"
      className="relative flex items-center justify-center overflow-hidden min-h-screen pt-16"
    >
      <meta itemProp="applicationCategory" content="Content Management System" />
      <meta itemProp="operatingSystem" content="Cross-platform" />
      <meta itemProp="description" content={description} />

      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(6,182,212,0.04)_0%,transparent_70%)] dark:bg-[radial-gradient(ellipse_at_center,rgba(6,182,212,0.08)_0%,transparent_70%)]" />
      <div className="absolute inset-0 grid-dots" />

      <div className="relative mx-auto px-4 sm:px-6 lg:px-8 text-center max-w-4xl">
        <HeroBadge text={badgeText} isEditing={puck.isEditing} />
        <HeroTitle title={title} isEditing={puck.isEditing} large />

        <p
          className={cn(
            'text-lg sm:text-xl text-surface-500 dark:text-surface-400 max-w-2xl mx-auto mb-10',
            puck.isEditing ? '' : 'opacity-0 animate-slide-up',
          )}
          style={puck.isEditing ? undefined : { animationDelay: '0.15s' }}
        >
          {description}
        </p>

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

        <TerminalMockup command={terminalCommand} isEditing={puck.isEditing} />
      </div>

      <ScrollArrow isEditing={puck.isEditing} />
    </section>
  );
}

function ProductHero({
  badgeText,
  title,
  description,
  buttons,
  imageUrl,
  imageAlt,
  puck,
}: HeroProps & { puck: { isEditing: boolean } }) {
  const hasImage = !!imageUrl;

  return (
    <section className="relative overflow-hidden pt-24 sm:pt-32 pb-16 sm:pb-24">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(6,182,212,0.04)_0%,transparent_70%)] dark:bg-[radial-gradient(ellipse_at_center,rgba(6,182,212,0.08)_0%,transparent_70%)]" />

      <div
        className={cn(
          'relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8',
          hasImage ? 'grid lg:grid-cols-2 gap-12 lg:gap-16 items-center' : 'text-center',
        )}
      >
        <div className={hasImage ? '' : 'max-w-3xl mx-auto'}>
          <HeroBadge text={badgeText} isEditing={puck.isEditing} />
          <HeroTitle title={title} isEditing={puck.isEditing} large={!hasImage} />

          <p
            className={cn(
              'text-lg text-surface-500 dark:text-surface-400 mb-8',
              !hasImage && 'max-w-2xl mx-auto',
              puck.isEditing ? '' : 'opacity-0 animate-slide-up',
            )}
            style={puck.isEditing ? undefined : { animationDelay: '0.15s' }}
          >
            {description}
          </p>

          <div
            className={cn(
              'flex flex-col sm:flex-row gap-4',
              !hasImage && 'items-center justify-center',
              puck.isEditing ? '' : 'opacity-0 animate-slide-up',
            )}
            style={puck.isEditing ? undefined : { animationDelay: '0.3s' }}
          >
            <CTAButtonGroup buttons={buttons} isEditing={puck.isEditing} />
          </div>
        </div>

        {hasImage && (
          <div
            className={cn(
              'relative rounded-2xl overflow-hidden border border-surface-200 dark:border-surface-800 shadow-2xl',
              puck.isEditing ? '' : 'opacity-0 animate-slide-up',
            )}
            style={puck.isEditing ? undefined : { animationDelay: '0.3s' }}
          >
            <img src={imageUrl} alt={imageAlt} className="w-full h-auto" loading="eager" />
          </div>
        )}
      </div>
    </section>
  );
}

function MinimalHero({ badgeText, title, description, buttons, puck }: HeroProps & { puck: { isEditing: boolean } }) {
  const lines = typeof title === 'string' ? title.split('\n') : [];

  return (
    <div className="text-center mb-16">
      {badgeText && (
        <p className="text-brand-600 dark:text-brand-400 text-sm font-medium tracking-wide uppercase mb-3">
          {badgeText}
        </p>
      )}
      <h1 className="text-3xl sm:text-4xl font-bold text-surface-900 dark:text-white mb-4">
        {lines.map((line, idx) => (
          <span key={idx}>
            {idx === 0 ? line : <span className="text-brand-600 dark:text-brand-400">{line}</span>}
            {idx < lines.length - 1 && <br />}
          </span>
        ))}
      </h1>
      <p className="text-surface-500 dark:text-surface-400 max-w-2xl mx-auto">{description}</p>
      {buttons.length > 0 && (
        <div className="mt-8">
          <CTAButtonGroup buttons={buttons} isEditing={puck.isEditing} />
        </div>
      )}
    </div>
  );
}

const VARIANT_RENDERERS: Record<HeroVariant, React.FC<HeroProps & { puck: { isEditing: boolean } }>> = {
  marketing: MarketingHero,
  product: ProductHero,
  minimal: MinimalHero,
};

export const Hero: ComponentConfig<HeroProps> = {
  label: 'Hero Section',
  resolvePermissions: (_data, { appState }) => {
    const heroCount = appState.data.content.filter((item) => item.type === 'Hero').length;
    return { duplicate: false, insert: heroCount < 1 };
  },
  resolveFields: (data, { fields }) => ({
    ...fields,
    terminalCommand: { ...fields.terminalCommand, visible: data.props.variant === 'marketing' },
    imageUrl: { ...fields.imageUrl, visible: data.props.variant === 'product' },
    imageAlt: { ...fields.imageAlt, visible: data.props.variant === 'product' && !!data.props.imageUrl },
  }),
  fields: {
    variant: {
      type: 'radio',
      label: 'Variant',
      options: [
        { label: 'Marketing (full-bleed, terminal)', value: 'marketing' },
        { label: 'Product (with optional image)', value: 'product' },
        { label: 'Minimal (text only)', value: 'minimal' },
      ],
    },
    badgeText: {
      type: 'text',
      label: 'Badge Text',
      contentEditable: true,
    },
    title: {
      type: 'text',
      contentEditable: true,
    },
    description: {
      type: 'text',
      contentEditable: true,
    },
    buttons: ctaButtonArrayField(),
    terminalCommand: {
      type: 'text',
      label: 'Terminal Command',
    },
    imageUrl: {
      type: 'text',
      label: 'Image URL',
    },
    imageAlt: {
      type: 'text',
      label: 'Image Alt Text',
    },
  },
  defaultProps: {
    variant: 'marketing',
    badgeText: 'Open source - MIT Licensed',
    title: 'The file-based CMS that lives in your git repo',
    description:
      'Visual editing for marketers, full git ownership for developers. Powered by Puck with drag-and-drop components.',
    buttons: [
      { id: crypto.randomUUID(), label: 'Get Started', href: '#quickstart', variant: 'primary' },
      { id: crypto.randomUUID(), label: 'Join Waitlist', href: '#waitlist', variant: 'secondary' },
    ],
    terminalCommand: 'bun add @conloca/astro-cms',
    imageUrl: '',
    imageAlt: '',
  },
  render: ({ puck, ...props }) => {
    const Renderer = VARIANT_RENDERERS[props.variant] || MarketingHero;
    return <Renderer {...props} puck={puck} />;
  },
};
