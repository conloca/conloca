import cn from 'clsx';
import { useCallback, useRef, useState } from 'react';
import { buildUploadFormData, useImportAssetUrl, useUploadAsset } from '../../hooks';

const ACCEPTED_TYPES = 'image/jpeg,image/png,image/gif,image/webp,image/svg+xml,image/avif';

interface UploadZoneProps {
  /** Folder to upload files to */
  folder?: string;
  onUploadComplete?: () => void;
}

interface UploadProgress {
  total: number;
  completed: number;
  failed: number;
  inProgress: boolean;
}

export function UploadZone({ folder = '/', onUploadComplete }: UploadZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [altText, setAltText] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [activeTab, setActiveTab] = useState<'file' | 'url'>('file');
  const [importUrl, setImportUrl] = useState('');
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadMutation = useUploadAsset();
  const importMutation = useImportAssetUrl();

  const isUploading = uploadMutation.isPending || importMutation.isPending || (uploadProgress?.inProgress ?? false);
  const error = uploadMutation.error || importMutation.error;

  // Handle single file selection (shows alt text input)
  const handleSingleFile = useCallback((file: File) => {
    setPendingFile(file);
    setAltText('');
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

      // Clear progress after a delay
      setTimeout(() => {
        setUploadProgress(null);
        if (completed > 0) {
          onUploadComplete?.();
        }
      }, 2000);
    },
    [folder, uploadMutation, handleSingleFile, onUploadComplete],
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
        setPendingFile(null);
        setAltText('');
        if (fileInputRef.current) fileInputRef.current.value = '';
        onUploadComplete?.();
      },
    });
  };

  const handleImportUrl = () => {
    if (!importUrl.trim()) return;

    importMutation.mutate(
      { url: importUrl.trim(), alt: altText || undefined, folder },
      {
        onSuccess: () => {
          setImportUrl('');
          setAltText('');
          onUploadComplete?.();
        },
      },
    );
  };

  const handleCancel = () => {
    setPendingFile(null);
    setAltText('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="border border-grey-09 rounded-lg bg-grey-11 p-4">
      {/* Tabs */}
      <div className="flex gap-2 mb-3">
        <button
          type="button"
          onClick={() => setActiveTab('file')}
          className={cn(
            'px-3 py-1 text-sm rounded transition-colors',
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
            'px-3 py-1 text-sm rounded transition-colors',
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
            <div className="mb-4 p-3 bg-white rounded border border-grey-09">
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
                  className={cn('h-full transition-all', uploadProgress.failed > 0 ? 'bg-yellow-06' : 'bg-azure-04')}
                  style={{
                    width: `${((uploadProgress.completed + uploadProgress.failed) / uploadProgress.total) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}

          {pendingFile ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-16 h-16 bg-grey-09 rounded overflow-hidden flex-shrink-0">
                  <img src={URL.createObjectURL(pendingFile)} alt="Preview" className="w-full h-full object-contain" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-grey-01 truncate">{pendingFile.name}</p>
                  <p className="text-xs text-grey-04">{(pendingFile.size / 1024).toFixed(1)} KB</p>
                </div>
              </div>

              <input
                type="text"
                value={altText}
                onChange={(e) => setAltText(e.target.value)}
                placeholder="Alt text (recommended for accessibility)"
                className="w-full px-3 py-2 border border-grey-09 rounded text-sm focus:outline-none focus:ring-2 focus:ring-azure-04"
              />

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleUpload}
                  disabled={isUploading}
                  className="px-4 py-2 bg-azure-04 text-white text-sm rounded hover:bg-azure-03 disabled:opacity-50 transition-colors"
                >
                  {uploadMutation.isPending ? 'Uploading...' : 'Upload'}
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={isUploading}
                  className="px-4 py-2 bg-white border border-grey-09 text-grey-04 text-sm rounded hover:bg-grey-11 disabled:opacity-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={cn(
                'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors bg-white',
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
              <svg
                className="mx-auto h-10 w-10 text-grey-04"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M12 16V4m0 0l-4 4m4-4l4 4M4 20h16"
                />
              </svg>
              <p className="mt-2 text-sm text-grey-04">Drag and drop images here, or click to browse</p>
              <p className="mt-1 text-xs text-grey-07">JPEG, PNG, GIF, WebP, SVG, AVIF - Multiple files supported</p>
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
        <div className="space-y-3">
          <input
            type="url"
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
            placeholder="https://example.com/image.jpg"
            className="w-full px-3 py-2 border border-grey-09 rounded text-sm focus:outline-none focus:ring-2 focus:ring-azure-04"
          />
          <input
            type="text"
            value={altText}
            onChange={(e) => setAltText(e.target.value)}
            placeholder="Alt text (recommended for accessibility)"
            className="w-full px-3 py-2 border border-grey-09 rounded text-sm focus:outline-none focus:ring-2 focus:ring-azure-04"
          />
          <button
            type="button"
            onClick={handleImportUrl}
            disabled={isUploading || !importUrl.trim()}
            className="px-4 py-2 bg-azure-04 text-white text-sm rounded hover:bg-azure-03 disabled:opacity-50 transition-colors"
          >
            {importMutation.isPending ? 'Importing...' : 'Import'}
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-04">{error instanceof Error ? error.message : 'Upload failed'}</p>}
    </div>
  );
}
