import { AlertTriangle, Check, Loader2, X } from 'lucide-react';
import type { SaveState } from '../../types';
import { cn } from '../../utils/cn';

interface SaveIndicatorProps {
  state: SaveState;
  className?: string;
}

export function SaveIndicator({ state, className }: SaveIndicatorProps) {
  const stateConfig = {
    idle: null,
    saving: {
      icon: <Loader2 className="lucide lucide-loader-2 h-4 w-4 animate-spin" />,
      text: 'Saving...',
      className: 'text-grey-04',
    },
    saved: {
      icon: <Check className="lucide lucide-check h-4 w-4" />,
      text: 'Saved',
      className: 'text-green-06',
    },
    error: {
      icon: <X className="lucide lucide-x h-4 w-4" />,
      text: 'Error',
      className: 'text-red-04',
    },
    conflict: {
      icon: <AlertTriangle className="lucide lucide-alert-triangle h-4 w-4" />,
      text: 'Conflict',
      className: 'text-yellow-06',
    },
  };

  const config = stateConfig[state];
  if (!config) return null;

  return (
    <div className={cn('flex items-center gap-2', config.className, className)} data-testid={`save-indicator-${state}`}>
      {config.icon}
      <span className="text-sm">{config.text}</span>
    </div>
  );
}
