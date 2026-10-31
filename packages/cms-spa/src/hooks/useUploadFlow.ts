import {
  DEFAULT_MAX_FILE_SIZE,
  IMAGE_EXTENSION_MIME,
  useImportAssetUrl,
  useUploadAsset,
} from '@conloca/content-api-client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { prepareImageUpload } from '../media/prepare-image-upload.js';
import { buildUploadFormData } from './useUpload.js';

/**
 * The `accept` attribute for the media file pickers, derived from the allowlist
 * the upload backends enforce so the dialog never greys out a type they accept.
 * De-duplicated because several extensions share one content type (jpg/jpeg).
 */
export const ACCEPTED_TYPES = [...new Set(Object.values(IMAGE_EXTENSION_MIME))].join(',');

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
  /** A file refused in the browser, before any request. */
  const [processingError, setProcessingError] = useState<Error | null>(null);
  /** True while a picked photo is shrunk, so a second click cannot send it twice. */
  const [isPreparing, setIsPreparing] = useState(false);
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

  const isUploading =
    isPreparing || uploadMutation.isPending || importMutation.isPending || (uploadProgress?.inProgress ?? false);
  const error = processingError || uploadMutation.error || importMutation.error;

  const reset = useCallback(() => {
    setPendingFile(null);
    setAltText('');
    setImportUrl('');
    setUploadProgress(null);
    setProcessingError(null);
    setActiveTab('file');
    setIsDragOver(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleSingleFile = useCallback((file: File) => {
    setPendingFile(file);
    setAltText('');
    setProcessingError(null);
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

      let refusal: Error | null = null;
      // One file decoded at a time: decoding many camera photos at once can exhaust a phone's memory.
      let previous: Promise<unknown> = Promise.resolve();
      const uploadPromises = files.map(async (file) => {
        const preparing = previous.then(() => prepareImageUpload(file, DEFAULT_MAX_FILE_SIZE));
        previous = preparing.catch(() => undefined);
        let ready: File;
        try {
          ready = await preparing;
        } catch (reason) {
          refusal ??= reason instanceof Error ? reason : new Error(String(reason));
          throw reason;
        }
        return uploadMutation.mutateAsync(buildUploadFormData(ready, undefined, folder));
      });

      const results = await Promise.allSettled(uploadPromises);
      setProcessingError(refusal);

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
    if (!pendingFile || isUploading) return;

    setProcessingError(null);
    setIsPreparing(true);
    let file: File;
    try {
      file = await prepareImageUpload(pendingFile, DEFAULT_MAX_FILE_SIZE);
    } catch (reason) {
      setProcessingError(reason instanceof Error ? reason : new Error(String(reason)));
      return;
    } finally {
      setIsPreparing(false);
    }
    const formData = buildUploadFormData(file, altText || undefined, folder);
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
    setProcessingError(null);
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
