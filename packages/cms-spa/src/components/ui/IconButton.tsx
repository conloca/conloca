import type { LucideIcon } from 'lucide-react';
import { cn } from '../../utils/cn';

interface IconButtonProps {
  icon: LucideIcon;
  onClick?: () => void;
  ariaLabel: string;
  title?: string;
  className?: string;
  iconSize?: string;
  variant?: 'default' | 'ghost';
}

export function IconButton({
  icon: Icon,
  onClick,
  ariaLabel,
  title,
  className,
  iconSize = 'h-4 w-4',
  variant = 'default',
}: IconButtonProps) {
  const baseClasses = 'p-2 rounded-md transition-all duration-150 cursor-pointer';
  const variantClasses = {
    default: 'text-grey-03 dark:text-grey-09 hover:bg-hover hover:text-grey-01 dark:hover:text-grey-12',
    ghost: 'text-grey-04 dark:text-grey-07 hover:bg-hover hover:text-grey-01 dark:hover:text-grey-12',
  };

  return (
    <button
      onClick={onClick}
      className={cn(baseClasses, variantClasses[variant], className)}
      aria-label={ariaLabel}
      title={title || ariaLabel}
    >
      <Icon className={iconSize} />
    </button>
  );
}
