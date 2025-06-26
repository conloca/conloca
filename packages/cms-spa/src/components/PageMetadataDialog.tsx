import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type React from 'react';
import { useState } from 'react';
import type { PageMetadata } from '../types';

interface PageMetadataDialogProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  page: PageMetadata;
  onSave?: (metadata: PageMetadata) => void;
}

export function PageMetadataDialog({ open, onOpenChange, page, onSave }: PageMetadataDialogProps) {
  const [metadata, setMetadata] = useState<PageMetadata>(page);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave?.(metadata);
    onOpenChange?.(false);
  };

  const updateField = <K extends keyof PageMetadata>(field: K, value: PageMetadata[K]) => {
    setMetadata((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-lg font-semibold">Page Metadata</Dialog.Title>
            <Dialog.Close className="p-1 hover:bg-grey-11 rounded">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* SEO Section */}
            <div>
              <h3 className="text-sm font-medium mb-3">SEO</h3>
              <div className="space-y-4">
                <div>
                  <label htmlFor="title" className="block text-sm font-medium mb-1">
                    Title
                  </label>
                  <input
                    id="title"
                    type="text"
                    value={metadata.title}
                    onChange={(e) => updateField('title', e.target.value)}
                    className="w-full px-3 py-2 border border-grey-09 rounded focus:outline-none focus:ring-2 focus:ring-azure-04"
                  />
                </div>

                <div>
                  <label htmlFor="description" className="block text-sm font-medium mb-1">
                    Description
                  </label>
                  <textarea
                    id="description"
                    value={metadata.description}
                    onChange={(e) => updateField('description', e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 border border-grey-09 rounded focus:outline-none focus:ring-2 focus:ring-azure-04"
                  />
                </div>
              </div>
            </div>

            {/* URL Management */}
            <div>
              <h3 className="text-sm font-medium mb-3">URL Management</h3>
              <div className="space-y-4">
                <div>
                  <label htmlFor="pathname" className="block text-sm font-medium mb-1">
                    URL Path
                  </label>
                  <input
                    id="pathname"
                    type="text"
                    value={metadata.pathname}
                    onChange={(e) => updateField('pathname', e.target.value)}
                    className="w-full px-3 py-2 border border-grey-09 rounded focus:outline-none focus:ring-2 focus:ring-azure-04"
                  />
                  <p className="text-xs text-grey-04 mt-1">
                    Previous paths will automatically redirect to the new path
                  </p>
                </div>
              </div>
            </div>

            {/* Publishing Control */}
            <div>
              <h3 className="text-sm font-medium mb-3">Publishing Control</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="publishDate" className="block text-sm font-medium mb-1">
                    Publish Date
                  </label>
                  <input
                    id="publishDate"
                    type="datetime-local"
                    value={metadata.publishDate?.toISOString().slice(0, 16) || ''}
                    onChange={(e) => updateField('publishDate', e.target.value ? new Date(e.target.value) : null)}
                    className="w-full px-3 py-2 border border-grey-09 rounded focus:outline-none focus:ring-2 focus:ring-azure-04"
                  />
                </div>

                <div>
                  <label htmlFor="unpublishDate" className="block text-sm font-medium mb-1">
                    Unpublish Date
                  </label>
                  <input
                    id="unpublishDate"
                    type="datetime-local"
                    value={metadata.unpublishDate?.toISOString().slice(0, 16) || ''}
                    onChange={(e) => updateField('unpublishDate', e.target.value ? new Date(e.target.value) : null)}
                    className="w-full px-3 py-2 border border-grey-09 rounded focus:outline-none focus:ring-2 focus:ring-azure-04"
                  />
                </div>
              </div>
            </div>

            {/* Advanced */}
            <div>
              <h3 className="text-sm font-medium mb-3">Advanced</h3>
              <div className="space-y-4">
                <div>
                  <label htmlFor="robots" className="block text-sm font-medium mb-1">
                    Robots Meta
                  </label>
                  <input
                    id="robots"
                    type="text"
                    value={metadata.robots || ''}
                    onChange={(e) => updateField('robots', e.target.value)}
                    placeholder="index, follow"
                    className="w-full px-3 py-2 border border-grey-09 rounded focus:outline-none focus:ring-2 focus:ring-azure-04"
                  />
                </div>

                <div>
                  <label htmlFor="canonical" className="block text-sm font-medium mb-1">
                    Canonical URL
                  </label>
                  <input
                    id="canonical"
                    type="url"
                    value={metadata.canonical || ''}
                    onChange={(e) => updateField('canonical', e.target.value)}
                    className="w-full px-3 py-2 border border-grey-09 rounded focus:outline-none focus:ring-2 focus:ring-azure-04"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-4">
              <button
                type="submit"
                className="flex-1 px-4 py-2 bg-azure-04 text-white rounded hover:bg-azure-03 transition-colors"
              >
                Save
              </button>
              <Dialog.Close className="flex-1 px-4 py-2 border border-grey-09 rounded hover:bg-grey-11 transition-colors">
                Cancel
              </Dialog.Close>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
