import cn from 'clsx';
import type { CTAButton } from './fields';

type CTAButtonGroupProps = {
  buttons: CTAButton[];
  isEditing: boolean;
};

export function CTAButtonGroup({ buttons, isEditing }: CTAButtonGroupProps) {
  return (
    <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
      {buttons.map((button) => (
        <a
          key={button.id}
          href={button.href}
          className={cn(
            button.variant === 'primary'
              ? 'inline-flex items-center gap-2 bg-brand-500 hover:bg-brand-400 text-surface-950 font-semibold px-6 py-3 rounded-lg transition-all duration-200 hover:shadow-lg hover:shadow-brand-500/20 text-sm'
              : 'inline-flex items-center gap-2 border border-surface-300 dark:border-surface-600 hover:border-surface-400 dark:hover:border-surface-500 text-surface-600 dark:text-surface-300 hover:text-surface-900 dark:hover:text-white font-medium px-6 py-3 rounded-lg transition-all duration-200 text-sm',
          )}
          onClick={isEditing ? (e) => e.preventDefault() : undefined}
        >
          {button.label}
          {button.variant === 'primary' && (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          )}
        </a>
      ))}
    </div>
  );
}
