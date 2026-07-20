import { useCallback, useState } from 'react';
import type { ErrorModalProps } from '../components/dialogs/ErrorModal';

export interface UseErrorModalReturn {
  errorModal: {
    isOpen: boolean;
    message: string;
    error?: unknown;
    actions?: ErrorModalProps['actions'];
  };
  showError: (message: string, error?: unknown, actions?: ErrorModalProps['actions']) => void;
  showStaleWriteError: (error?: unknown) => void;
  hideError: () => void;
  errorModalProps: Omit<ErrorModalProps, 'title'>;
}

export function useErrorModal(): UseErrorModalReturn {
  const [errorModal, setErrorModal] = useState<{
    isOpen: boolean;
    message: string;
    error?: unknown;
    actions?: ErrorModalProps['actions'];
  }>({ isOpen: false, message: '' });

  const showError = useCallback((message: string, error?: unknown, actions?: ErrorModalProps['actions']) => {
    setErrorModal({
      isOpen: true,
      message,
      error,
      actions,
    });
  }, []);

  const hideError = useCallback(() => {
    setErrorModal({ isOpen: false, message: '', error: undefined, actions: undefined });
  }, []);

  const showStaleWriteError = useCallback(
    (error?: unknown) => {
      showError('This entry has been modified by someone else. Would you like to reload and try again?', error, [
        { label: 'Reload', onClick: () => window.location.reload(), variant: 'primary' },
        { label: 'Cancel', onClick: hideError, variant: 'secondary' },
      ]);
    },
    [hideError, showError],
  );

  const errorModalProps: Omit<ErrorModalProps, 'title'> = {
    isOpen: errorModal.isOpen,
    onClose: hideError,
    message: errorModal.message,
    error: errorModal.error,
    actions: errorModal.actions,
  };

  return {
    errorModal,
    showError,
    showStaleWriteError,
    hideError,
    errorModalProps,
  };
}
