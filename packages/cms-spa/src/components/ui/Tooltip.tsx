import type { ReactNode } from 'react';

interface TooltipProps {
  content: string;
  children: ReactNode;
  className?: string;
}

export function Tooltip({ content, children, className = '' }: TooltipProps) {
  return (
    <div className="relative inline-block group/tooltip">
      {children}
      <div
        role="tooltip"
        className={`invisible group-hover/tooltip:visible group-focus-within/tooltip:visible pointer-events-none absolute z-10 px-3 py-2 text-sm text-white bg-grey-01 rounded-lg shadow-sm
          bottom-full left-1/2 transform -translate-x-1/2 mb-2 whitespace-nowrap ${className}`}
      >
        {content}
        <div className="absolute top-full left-1/2 transform -translate-x-1/2 -mt-1">
          <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-grey-01" />
        </div>
      </div>
    </div>
  );
}
