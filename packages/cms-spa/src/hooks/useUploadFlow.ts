import { useImportAssetUrl, useUploadAsset } from '@conloca/content-api-client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildUploadFormData } from './useUpload';

export const ACCEPTED_TYPES = 'image/jpeg,image/png,image/gif,image/webp,image/svg+xml,image/avif';

export interface UploadProgress {
  total: number;
  completed: number;
  failed: number;
  inProgress: boolean;
}

interface UseUploadFlowOptions {
  folder: string;
  onUploadComplete?: () => void;
  /** Called after single-file upload/import succeeds or multi-file batch finishes (e.g. onClose for modals) */
  onSuccess?: () => void;
}

export interface UseUploadFlowReturn {
  // State
  isDragOver: boolean;
  altText: string;
  setAltText: (v: string) => void;
  pendingFile: File | null;
  activeTab: 'file' | 'url';
  setActiveTab: (tab: 'file' | 'url') => void;
  importUrl: string;
  setImportUrl: (v: string) => void;
  uploadProgress: UploadProgress | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  previewUrl: string | null;
  // Derived
  isUploading: boolean;
  error: Error | null;
  uploadMutationIsPending: boolean;
  importMutationIsPending: boolean;
  // Handlers
  handleFiles: (fileList: FileList | null) => void;
  handleDragOver: (e: React.DragEvent) => void;
  handleDragLeave: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => void;
  handleUpload: () => Promise<void>;
  handleImportUrl: () => void;
  handleCancel: () => void;
  /** Reset all hook state to initial values */
  reset: () => void;
}

export function useUploadFlow({ folder, onUploadComplete, onSuccess }: UseUploadFlowOptions): UseUploadFlowReturn {
  const [isDragOver, setIsDragOver] = useState(false);
  const [altText, setAltText] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [activeTab, setActiveTab] = useState<'file' | 'url'>('file');
  const [importUrl, setImportUrl] = useState('');
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadMutation = useUploadAsset();
  const importMutation = useImportAssetUrl();

  const previewUrl = useMemo(() => {
    if (!pendingFile) return null;
    return URL.createObjectURL(pendingFile);
  }, [pendingFile]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const isUploading = uploadMutation.isPending || importMutation.isPending || (uploadProgress?.inProgress ?? false);
  const error = uploadMutation.error || importMutation.error;

  const reset = useCallback(() => {
    setPendingFile(null);
    setAltText('');
    setImportUrl('');
    setUploadProgress(null);
    setActiveTab('file');
    setIsDragOver(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleSingleFile = useCallback((file: File) => {
    setPendingFile(file);
    setAltText('');
  }, []);

  const handleMultipleFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      if (files.length === 1) {
        handleSingleFile(files[0]);
        return;
      }

      // Multi-file upload: upload all in parallel without alt text prompts
      setUploadProgress({ total: files.length, completed: 0, failed: 0, inProgress: true });

      const uploadPromises = files.map(async (file) => {
        const formData = await buildUploadFormData(file, undefined, folder);
        return uploadMutation.mutateAsync(formData);
      });

      const results = await Promise.allSettled(uploadPromises);

      const completed = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.filter((r) => r.status === 'rejected').length;

      setUploadProgress({ total: files.length, completed, failed, inProgress: false });

      // Clear progress after a delay, notify completion, then call onSuccess
      setTimeout(() => {
        setUploadProgress(null);
        if (completed > 0) {
          onUploadComplete?.();
        }
        onSuccess?.();
      }, 2000);
    },
    [folder, uploadMutation, handleSingleFile, onUploadComplete, onSuccess],
  );

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      const files = Array.from(fileList);
      handleMultipleFiles(files);
    },
    [handleMultipleFiles],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const handleUpload = async () => {
    if (!pendingFile) return;

    const formData = await buildUploadFormData(pendingFile, altText || undefined, folder);
    uploadMutation.mutate(formData, {
      onSuccess: () => {
        // Reset shared state
        setPendingFile(null);
        setAltText('');
        if (fileInputRef.current) fileInputRef.current.value = '';
        onUploadComplete?.();
        onSuccess?.();
      },
    });
  };

  const handleImportUrl = () => {
    if (!importUrl.trim()) return;

    importMutation.mutate(
      { url: importUrl.trim(), alt: altText || undefined, folder },
      {
        onSuccess: () => {
          // Reset shared state
          setImportUrl('');
          setAltText('');
          onUploadComplete?.();
          onSuccess?.();
        },
      },
    );
  };

  const handleCancel = () => {
    setPendingFile(null);
    setAltText('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return {
    isDragOver,
    altText,
    setAltText,
    pendingFile,
    activeTab,
    setActiveTab,
    importUrl,
    setImportUrl,
    uploadProgress,
    fileInputRef,
    previewUrl,
    isUploading,
    error,
    uploadMutationIsPending: uploadMutation.isPending,
    importMutationIsPending: importMutation.isPending,
    handleFiles,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleUpload,
    handleImportUrl,
    handleCancel,
    reset,
  };
}
