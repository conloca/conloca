import { AlertTriangle, X } from 'lucide-react';
import { useEffect } from 'react';
import { cn } from '../../utils/cn';

export interface ErrorModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  message: string;
  error?: Error | unknown;
  actions?: Array<{
    label: string;
    onClick: () => void;
    variant?: 'primary' | 'secondary' | 'danger';
  }>;
}

export function ErrorModal({ isOpen, onClose, title = 'Error', message, error, actions = [] }: ErrorModalProps) {
  // Close on escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const getErrorDetails = () => {
    if (!error) return null;

    if (error instanceof Error) {
      return error.stack || error.message;
    }

    return JSON.stringify(error, null, 2);
  };

  const errorDetails = getErrorDetails();

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white dark:bg-grey-03 rounded-lg shadow-xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-grey-09 dark:border-grey-03">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-red-04" />
            <h2 className="text-lg font-semibold text-grey-01 dark:text-grey-12">{title}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-grey-11 dark:hover:bg-grey-03 rounded-md transition-colors"
            aria-label="Close error dialog"
          >
            <X className="h-5 w-5 text-grey-04 dark:text-grey-07" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          <p className="text-grey-02 dark:text-grey-10 mb-4">{message}</p>

          {errorDetails && (
            <details className="mb-4">
              <summary className="text-sm text-grey-04 dark:text-grey-07 cursor-pointer hover:text-grey-02 transition-colors">
                Show technical details
              </summary>
              <pre className="mt-2 p-3 bg-grey-11 dark:bg-grey-03 rounded-md text-xs text-grey-03 dark:text-grey-09 overflow-x-auto max-h-40 overflow-y-auto">
                {errorDetails}
              </pre>
            </details>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 p-4 border-t border-grey-09 dark:border-grey-03">
          {actions.length > 0 ? (
            actions.map((action, index) => {
              const baseClasses = 'px-4 py-2 rounded-md font-medium transition-colors';
              const variantClasses = {
                primary: 'bg-azure-04 text-white hover:bg-azure-03',
                secondary: 'border border-grey-09 dark:border-grey-03 hover:bg-grey-11 dark:hover:bg-grey-03',
                danger: 'bg-red-04 text-white hover:bg-red-03',
              };

              return (
                <button
                  key={index}
                  onClick={() => {
                    action.onClick();
                    onClose();
                  }}
                  className={cn(baseClasses, variantClasses[action.variant || 'secondary'])}
                >
                  {action.label}
                </button>
              );
            })
          ) : (
            <button
              onClick={onClose}
              className="px-4 py-2 bg-azure-04 text-white rounded-md hover:bg-azure-03 transition-colors"
            >
              Dismiss
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
