import cn from 'clsx';
import type { ReactNode } from 'react';

type SectionMaxWidth = 'narrow' | 'default' | 'wide' | 'full';
type SectionSpacing = 'none' | 'sm' | 'md' | 'lg';

type SectionContainerProps = {
  children: ReactNode;
  maxWidth?: SectionMaxWidth;
  spacing?: SectionSpacing;
  id?: string;
  className?: string;
  as?: 'section' | 'div' | 'header';
};

const maxWidthClasses: Record<SectionMaxWidth, string> = {
  narrow: 'max-w-3xl',
  default: 'max-w-4xl',
  wide: 'max-w-6xl',
  full: 'max-w-7xl',
};

const spacingClasses: Record<SectionSpacing, string> = {
  none: '',
  sm: 'py-12 sm:py-16',
  md: 'py-16 sm:py-24',
  lg: 'py-24 sm:py-32',
};

export function SectionContainer({
  children,
  maxWidth = 'wide',
  spacing = 'md',
  id,
  className,
  as: Tag = 'section',
}: SectionContainerProps) {
  return (
    <Tag id={id} className={cn(spacingClasses[spacing], className)}>
      <div className={cn('mx-auto px-4 sm:px-6 lg:px-8', maxWidthClasses[maxWidth])}>{children}</div>
    </Tag>
  );
}
