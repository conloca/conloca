import cn from 'clsx';
import { useCallback, useRef, useState } from 'react';
import { buildUploadFormData, useImportUrl, useUpload } from '../../hooks';

const ACCEPTED_TYPES = 'image/jpeg,image/png,image/gif,image/webp,image/svg+xml,image/avif';

interface UploadZoneProps {
  onUploadComplete?: () => void;
}

export function UploadZone({ onUploadComplete }: UploadZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [altText, setAltText] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [activeTab, setActiveTab] = useState<'file' | 'url'>('file');
  const [importUrl, setImportUrl] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadMutation = useUpload();
  const importMutation = useImportUrl();

  const isUploading = uploadMutation.isPending || importMutation.isPending;
  const error = uploadMutation.error || importMutation.error;

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    setPendingFile(file);
    setAltText('');
  }, []);

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

    const formData = await buildUploadFormData(pendingFile, altText || undefined);
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
      { url: importUrl.trim(), alt: altText || undefined },
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
    <div className="border rounded-lg bg-gray-50 p-4">
      {/* Tabs */}
      <div className="flex gap-2 mb-3">
        <button
          type="button"
          onClick={() => setActiveTab('file')}
          className={cn(
            'px-3 py-1 text-sm rounded',
            activeTab === 'file' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300',
          )}
        >
          Upload File
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('url')}
          className={cn(
            'px-3 py-1 text-sm rounded',
            activeTab === 'url' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300',
          )}
        >
          Import URL
        </button>
      </div>

      {activeTab === 'file' && (
        <>
          {pendingFile ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-16 h-16 bg-gray-200 rounded overflow-hidden flex-shrink-0">
                  <img src={URL.createObjectURL(pendingFile)} alt="Preview" className="w-full h-full object-contain" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{pendingFile.name}</p>
                  <p className="text-xs text-gray-500">{(pendingFile.size / 1024).toFixed(1)} KB</p>
                </div>
              </div>

              <input
                type="text"
                value={altText}
                onChange={(e) => setAltText(e.target.value)}
                placeholder="Alt text (recommended for accessibility)"
                className="w-full px-3 py-2 border rounded text-sm"
              />

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleUpload}
                  disabled={isUploading}
                  className="px-4 py-2 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 disabled:opacity-50"
                >
                  {isUploading ? 'Uploading...' : 'Upload'}
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={isUploading}
                  className="px-4 py-2 bg-gray-300 text-gray-700 text-sm rounded hover:bg-gray-400 disabled:opacity-50"
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
                'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
                isDragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400',
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
                className="mx-auto h-10 w-10 text-gray-400"
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
              <p className="mt-2 text-sm text-gray-600">Drag and drop an image here, or click to browse</p>
              <p className="mt-1 text-xs text-gray-400">JPEG, PNG, GIF, WebP, SVG, AVIF</p>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_TYPES}
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
            className="w-full px-3 py-2 border rounded text-sm"
          />
          <input
            type="text"
            value={altText}
            onChange={(e) => setAltText(e.target.value)}
            placeholder="Alt text (recommended for accessibility)"
            className="w-full px-3 py-2 border rounded text-sm"
          />
          <button
            type="button"
            onClick={handleImportUrl}
            disabled={isUploading || !importUrl.trim()}
            className="px-4 py-2 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 disabled:opacity-50"
          >
            {isUploading ? 'Importing...' : 'Import'}
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-600">{error instanceof Error ? error.message : 'Upload failed'}</p>}
    </div>
  );
}
