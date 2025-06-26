import { useState } from 'react';
import type { ErrorModalProps } from '../components/ErrorModal';

export interface UseErrorModalReturn {
  errorModal: {
    isOpen: boolean;
    message: string;
    error?: unknown;
    actions?: ErrorModalProps['actions'];
  };
  showError: (message: string, error?: unknown, actions?: ErrorModalProps['actions']) => void;
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

  const showError = (message: string, error?: unknown, actions?: ErrorModalProps['actions']) => {
    setErrorModal({
      isOpen: true,
      message,
      error,
      actions,
    });
  };

  const hideError = () => {
    setErrorModal({ isOpen: false, message: '', error: undefined, actions: undefined });
  };

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
    hideError,
    errorModalProps,
  };
}
