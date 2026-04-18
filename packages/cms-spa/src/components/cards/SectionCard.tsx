import { ArrowRight, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../utils/cn';

interface SectionCardProps {
  to: string;
  icon: ReactNode;
  title: string;
  description: string;
  count: number | undefined;
  countLabel: string;
  isLoading: boolean;
  testId?: string;
  variant?: 'full' | 'compact';
}

export function SectionCard({
  to,
  icon,
  title,
  description,
  count,
  countLabel,
  isLoading,
  testId,
  variant = 'full',
}: SectionCardProps) {
  if (variant === 'compact') {
    return (
      <Link
        to={to}
        data-testid={testId}
        className={cn(
          'group flex items-center gap-4 bg-white dark:bg-grey-02 border border-grey-09 dark:border-grey-03 rounded-lg px-4 py-3',
          'hover:border-azure-05 hover:shadow-sm transition-all',
        )}
      >
        <div className="p-2 bg-grey-12 dark:bg-grey-03 rounded-lg group-hover:bg-azure-11 dark:group-hover:bg-azure-02 transition-colors">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-grey-04 dark:text-grey-07">{title}</p>
          {isLoading ? (
            <Loader2
              className="h-4 w-4 animate-spin text-grey-06 dark:text-grey-05 mt-0.5"
              data-testid={testId ? `${testId}-loading` : undefined}
            />
          ) : (
            <p
              className="text-3xl font-semibold tabular-nums text-grey-01 dark:text-grey-12 leading-tight"
              data-testid={testId ? `${testId}-count` : undefined}
            >
              {count ?? 0} <span className="text-sm font-normal text-grey-05 dark:text-grey-06">{countLabel}</span>
            </p>
          )}
        </div>
        <ArrowRight className="h-4 w-4 text-grey-08 dark:text-grey-05 group-hover:text-azure-05 transition-colors flex-shrink-0" />
      </Link>
    );
  }

  return (
    <Link
      to={to}
      data-testid={testId}
      className={cn(
        'group flex flex-col bg-white dark:bg-grey-02 border border-grey-09 dark:border-grey-03 rounded-lg p-6',
        'hover:border-azure-05 hover:shadow-sm transition-all',
      )}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="p-2 bg-grey-12 dark:bg-grey-03 rounded-lg group-hover:bg-azure-11 dark:group-hover:bg-azure-02 transition-colors">
          {icon}
        </div>
        <ArrowRight className="h-5 w-5 text-grey-08 dark:text-grey-05 group-hover:text-azure-05 transition-colors" />
      </div>
      <h3 className="text-lg font-medium text-grey-01 dark:text-grey-12 mb-1">{title}</h3>
      <p className="text-sm text-grey-05 dark:text-grey-06 mb-4">{description}</p>
      <div className="mt-auto pt-4 border-t border-grey-11 dark:border-grey-03">
        {isLoading ? (
          <div
            className="flex items-center gap-2 text-grey-06 dark:text-grey-05"
            data-testid={testId ? `${testId}-loading` : undefined}
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading...</span>
          </div>
        ) : (
          <p className="text-sm">
            <span
              className="text-2xl font-semibold text-grey-01 dark:text-grey-12"
              data-testid={testId ? `${testId}-count` : undefined}
            >
              {count ?? 0}
            </span>
            <span className="text-grey-05 dark:text-grey-06 ml-2">{countLabel}</span>
          </p>
        )}
      </div>
    </Link>
  );
}
