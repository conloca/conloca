import cn from 'clsx';
import { Upload, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { buildUploadFormData, useImportAssetUrl, useUploadAsset } from '../../hooks';

const ACCEPTED_TYPES = 'image/jpeg,image/png,image/gif,image/webp,image/svg+xml,image/avif';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  folder: string;
  onUploadComplete?: () => void;
}

interface UploadProgress {
  total: number;
  completed: number;
  failed: number;
  inProgress: boolean;
}

export function UploadModal({ isOpen, onClose, folder, onUploadComplete }: UploadModalProps) {
  const [activeTab, setActiveTab] = useState<'file' | 'url'>('file');
  const [isDragOver, setIsDragOver] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [altText, setAltText] = useState('');
  const [customName, setCustomName] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadMutation = useUploadAsset();
  const importMutation = useImportAssetUrl();

  const isUploading = uploadMutation.isPending || importMutation.isPending || (uploadProgress?.inProgress ?? false);
  const error = uploadMutation.error || importMutation.error;

  // Reset all state when modal closes
  const resetState = useCallback(() => {
    setPendingFile(null);
    setAltText('');
    setCustomName('');
    setImportUrl('');
    setUploadProgress(null);
    setActiveTab('file');
    setIsDragOver(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  // Handle escape key to close modal
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      resetState();
    }
  }, [isOpen, resetState]);

  // Handle single file selection (shows alt text input)
  const handleSingleFile = useCallback((file: File) => {
    setPendingFile(file);
    setAltText('');
    setCustomName('');
  }, []);

  // Handle multiple files (uploads directly without alt text prompt)
  const handleMultipleFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      // If only one file, use the single file flow with alt text prompt
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

      // Clear progress after a delay and close modal
      setTimeout(() => {
        if (completed > 0) {
          onUploadComplete?.();
        }
        onClose();
      }, 2000);
    },
    [folder, uploadMutation, handleSingleFile, onUploadComplete, onClose],
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

    // NOTE: customName is UI-only for display purposes. The backend buildUploadFormData
    // signature is `buildUploadFormData(file: File, alt?: string, folder?: string)` and
    // does NOT accept a custom name. The uploaded file uses its original filename.
    const formData = await buildUploadFormData(pendingFile, altText || undefined, folder);
    uploadMutation.mutate(formData, {
      onSuccess: () => {
        onUploadComplete?.();
        onClose();
      },
    });
  };

  const handleImportUrl = () => {
    if (!importUrl.trim()) return;

    importMutation.mutate(
      { url: importUrl.trim(), alt: altText || undefined, folder },
      {
        onSuccess: () => {
          onUploadComplete?.();
          onClose();
        },
      },
    );
  };

  const handleCancel = () => {
    setPendingFile(null);
    setAltText('');
    setCustomName('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-lg w-full max-w-md mx-4 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-grey-09">
          <h2 className="text-lg font-semibold text-grey-01">Upload Assets</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-grey-04 hover:text-grey-01 transition-colors rounded hover:bg-grey-11"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          {/* Tabs */}
          <div className="flex gap-2 mb-4">
            <button
              type="button"
              onClick={() => setActiveTab('file')}
              className={cn(
                'px-3 py-1.5 text-sm rounded transition-colors',
                activeTab === 'file'
                  ? 'bg-azure-04 text-white'
                  : 'bg-white border border-grey-09 text-grey-04 hover:bg-grey-11',
              )}
            >
              Upload File
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('url')}
              className={cn(
                'px-3 py-1.5 text-sm rounded transition-colors',
                activeTab === 'url'
                  ? 'bg-azure-04 text-white'
                  : 'bg-white border border-grey-09 text-grey-04 hover:bg-grey-11',
              )}
            >
              Import URL
            </button>
          </div>

          {activeTab === 'file' && (
            <>
              {/* Multi-file upload progress */}
              {uploadProgress && (
                <div className="mb-4 p-3 bg-grey-11 rounded border border-grey-09">
                  <p className="text-sm font-medium text-grey-01">
                    {uploadProgress.inProgress
                      ? `Uploading ${uploadProgress.total} files...`
                      : `Upload complete: ${uploadProgress.completed}/${uploadProgress.total} succeeded`}
                  </p>
                  {uploadProgress.failed > 0 && (
                    <p className="text-sm text-red-04 mt-1">{uploadProgress.failed} file(s) failed to upload</p>
                  )}
                  <div className="mt-2 h-2 bg-grey-09 rounded overflow-hidden">
                    <div
                      className={cn(
                        'h-full transition-all',
                        uploadProgress.failed > 0 ? 'bg-yellow-06' : 'bg-azure-04',
                      )}
                      style={{
                        width: `${((uploadProgress.completed + uploadProgress.failed) / uploadProgress.total) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {pendingFile ? (
                <div className="space-y-4">
                  {/* File preview */}
                  <div className="flex items-center gap-3">
                    <div className="w-16 h-16 bg-grey-09 rounded overflow-hidden flex-shrink-0">
                      <img
                        src={URL.createObjectURL(pendingFile)}
                        alt="Preview"
                        className="w-full h-full object-contain"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-grey-01 truncate">{pendingFile.name}</p>
                      <p className="text-xs text-grey-04">{(pendingFile.size / 1024).toFixed(1)} KB</p>
                    </div>
                  </div>

                  {/* Custom name field (UI-only for display purposes) */}
                  <div>
                    <label htmlFor="custom-name" className="block text-xs text-grey-04 uppercase tracking-wide mb-1">
                      Asset Name (optional)
                    </label>
                    <input
                      id="custom-name"
                      type="text"
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      placeholder={pendingFile.name}
                      className="w-full px-3 py-2 border border-grey-09 rounded text-sm focus:outline-none focus:ring-2 focus:ring-azure-04 focus:border-azure-04"
                    />
                    <p className="mt-1 text-xs text-grey-07">Leave blank to use original filename</p>
                  </div>

                  {/* Alt text field */}
                  <div>
                    <label htmlFor="alt-text" className="block text-xs text-grey-04 uppercase tracking-wide mb-1">
                      Alt Text
                    </label>
                    <input
                      id="alt-text"
                      type="text"
                      value={altText}
                      onChange={(e) => setAltText(e.target.value)}
                      placeholder="Describe the image for accessibility"
                      className="w-full px-3 py-2 border border-grey-09 rounded text-sm focus:outline-none focus:ring-2 focus:ring-azure-04 focus:border-azure-04"
                    />
                  </div>
                </div>
              ) : (
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={cn(
                    'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors bg-grey-11',
                    isDragOver ? 'border-azure-04 bg-azure-11' : 'border-grey-09 hover:border-grey-07',
                  )}
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <Upload className="mx-auto h-10 w-10 text-grey-04" />
                  <p className="mt-2 text-sm text-grey-04">Drag and drop images here, or click to browse</p>
                  <p className="mt-1 text-xs text-grey-07">
                    JPEG, PNG, GIF, WebP, SVG, AVIF - Multiple files supported
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPTED_TYPES}
                    multiple
                    onChange={(e) => handleFiles(e.target.files)}
                    className="hidden"
                  />
                </div>
              )}
            </>
          )}

          {activeTab === 'url' && (
            <div className="space-y-4">
              <div>
                <label htmlFor="import-url" className="block text-xs text-grey-04 uppercase tracking-wide mb-1">
                  Image URL
                </label>
                <input
                  id="import-url"
                  type="url"
                  value={importUrl}
                  onChange={(e) => setImportUrl(e.target.value)}
                  placeholder="https://example.com/image.jpg"
                  className="w-full px-3 py-2 border border-grey-09 rounded text-sm focus:outline-none focus:ring-2 focus:ring-azure-04 focus:border-azure-04"
                />
              </div>
              <div>
                <label htmlFor="url-alt-text" className="block text-xs text-grey-04 uppercase tracking-wide mb-1">
                  Alt Text
                </label>
                <input
                  id="url-alt-text"
                  type="text"
                  value={altText}
                  onChange={(e) => setAltText(e.target.value)}
                  placeholder="Describe the image for accessibility"
                  className="w-full px-3 py-2 border border-grey-09 rounded text-sm focus:outline-none focus:ring-2 focus:ring-azure-04 focus:border-azure-04"
                />
              </div>
            </div>
          )}

          {error && (
            <p className="mt-4 text-sm text-red-04">{error instanceof Error ? error.message : 'Upload failed'}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-grey-09 bg-grey-11 rounded-b-lg">
          <button
            type="button"
            onClick={pendingFile ? handleCancel : onClose}
            disabled={isUploading}
            className="px-4 py-2 bg-white border border-grey-09 text-grey-04 text-sm rounded hover:bg-grey-11 disabled:opacity-50 transition-colors"
          >
            {pendingFile ? 'Clear' : 'Cancel'}
          </button>
          {activeTab === 'file' ? (
            <button
              type="button"
              onClick={handleUpload}
              disabled={isUploading || !pendingFile}
              className="flex items-center gap-2 px-4 py-2 bg-azure-04 text-white text-sm rounded hover:bg-azure-03 disabled:opacity-50 transition-colors"
            >
              <Upload className="w-4 h-4" />
              {uploadMutation.isPending ? 'Uploading...' : 'Upload'}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleImportUrl}
              disabled={isUploading || !importUrl.trim()}
              className="flex items-center gap-2 px-4 py-2 bg-azure-04 text-white text-sm rounded hover:bg-azure-03 disabled:opacity-50 transition-colors"
            >
              <Upload className="w-4 h-4" />
              {importMutation.isPending ? 'Importing...' : 'Import'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
