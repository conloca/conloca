import { Upload, X } from 'lucide-react';
import { useEffect } from 'react';
import { ACCEPTED_TYPES, useUploadFlow } from '../../hooks';
import { cn } from '../../utils/cn';
import { Button, IconButton, Input } from '../ui';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  folder: string;
  onUploadComplete?: () => void;
}

export function UploadModal({ isOpen, onClose, folder, onUploadComplete }: UploadModalProps) {
  const {
    activeTab,
    setActiveTab,
    isDragOver,
    pendingFile,
    altText,
    setAltText,
    importUrl,
    setImportUrl,
    uploadProgress,
    fileInputRef,
    previewUrl,
    isUploading,
    error,
    uploadMutationIsPending,
    importMutationIsPending,
    handleFiles,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleUpload,
    handleImportUrl,
    handleCancel,
    reset,
  } = useUploadFlow({ folder, onUploadComplete, onSuccess: onClose });

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
      reset();
    }
  }, [isOpen, reset]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-overlay rounded-lg w-full max-w-md mx-4 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <h2 className="text-lg font-semibold text-grey-01 dark:text-grey-12">Upload Assets</h2>
          <IconButton icon={X} ariaLabel="Close" onClick={onClose} variant="ghost" />
        </div>

        {/* Body */}
        <div className="p-6">
          {/* Tabs */}
          <div className="flex gap-2 mb-4">
            <Button
              variant={activeTab === 'file' ? 'primary' : 'outline'}
              size="sm"
              onClick={() => setActiveTab('file')}
            >
              Upload File
            </Button>
            <Button variant={activeTab === 'url' ? 'primary' : 'outline'} size="sm" onClick={() => setActiveTab('url')}>
              Import URL
            </Button>
          </div>

          {activeTab === 'file' && (
            <>
              {/* Multi-file upload progress */}
              {uploadProgress && (
                <div className="mb-4 p-3 bg-subtle rounded-md border border-line">
                  <p className="text-sm font-medium text-grey-01 dark:text-grey-12">
                    {uploadProgress.inProgress
                      ? `Uploading ${uploadProgress.total} files...`
                      : `Upload complete: ${uploadProgress.completed}/${uploadProgress.total} succeeded`}
                  </p>
                  {uploadProgress.failed > 0 && (
                    <p className="text-sm text-red-04 mt-1">{uploadProgress.failed} file(s) failed to upload</p>
                  )}
                  <div className="mt-2 h-2 bg-grey-09 rounded-md overflow-hidden">
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
                    <div className="w-16 h-16 bg-grey-09 rounded-md overflow-hidden flex-shrink-0">
                      <img src={previewUrl!} alt="Preview" className="w-full h-full object-contain" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-grey-01 dark:text-grey-12 truncate">{pendingFile.name}</p>
                      <p className="text-xs text-grey-04 dark:text-grey-07">
                        {(pendingFile.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                  </div>

                  {/* Alt text field */}
                  <div>
                    <label
                      htmlFor="alt-text"
                      className="block text-xs text-grey-04 dark:text-grey-07 uppercase tracking-wide mb-1"
                    >
                      Alt Text
                    </label>
                    <Input
                      size="sm"
                      id="alt-text"
                      type="text"
                      value={altText}
                      onChange={(e) => setAltText(e.target.value)}
                      placeholder="Describe the image for accessibility"
                    />
                  </div>
                </div>
              ) : (
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={cn(
                    'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors bg-subtle',
                    isDragOver ? 'border-azure-04 bg-azure-11 dark:bg-azure-02' : 'border-line hover:border-grey-07',
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
                  <Upload className="mx-auto h-10 w-10 text-grey-04 dark:text-grey-07" />
                  <p className="mt-2 text-sm text-grey-04 dark:text-grey-07">
                    Drag and drop images here, or click to browse
                  </p>
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
                <label
                  htmlFor="import-url"
                  className="block text-xs text-grey-04 dark:text-grey-07 uppercase tracking-wide mb-1"
                >
                  Image URL
                </label>
                <Input
                  size="sm"
                  id="import-url"
                  type="url"
                  value={importUrl}
                  onChange={(e) => setImportUrl(e.target.value)}
                  placeholder="https://example.com/image.jpg"
                />
              </div>
              <div>
                <label
                  htmlFor="url-alt-text"
                  className="block text-xs text-grey-04 dark:text-grey-07 uppercase tracking-wide mb-1"
                >
                  Alt Text
                </label>
                <Input
                  size="sm"
                  id="url-alt-text"
                  type="text"
                  value={altText}
                  onChange={(e) => setAltText(e.target.value)}
                  placeholder="Describe the image for accessibility"
                />
              </div>
            </div>
          )}

          {error && (
            <p className="mt-4 text-sm text-red-04">{error instanceof Error ? error.message : 'Upload failed'}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-line bg-subtle rounded-b-lg">
          <Button variant="outline" size="sm" onClick={pendingFile ? handleCancel : onClose} disabled={isUploading}>
            {pendingFile ? 'Clear' : 'Cancel'}
          </Button>
          {activeTab === 'file' ? (
            <Button
              variant="primary"
              size="sm"
              onClick={handleUpload}
              disabled={isUploading || !pendingFile}
              className="flex items-center gap-2"
            >
              <Upload className="w-4 h-4" />
              {uploadMutationIsPending ? 'Uploading...' : 'Upload'}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={handleImportUrl}
              disabled={isUploading || !importUrl.trim()}
              className="flex items-center gap-2"
            >
              <Upload className="w-4 h-4" />
              {importMutationIsPending ? 'Importing...' : 'Import'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
