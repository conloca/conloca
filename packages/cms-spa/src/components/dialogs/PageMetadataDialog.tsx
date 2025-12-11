import { pageEditableSchema } from '@conloca/content-api';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import type { PageMetadata } from '../../types';
import { SchemaForm } from '../forms/SchemaForm';

interface PageMetadataDialogProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  page: PageMetadata;
  onSave?: (metadata: PageMetadata) => void;
}

export function PageMetadataDialog({ open, onOpenChange, page, onSave }: PageMetadataDialogProps) {
  // Convert PageMetadata to form values (flatten dates to strings)
  const initialValues = useMemo(
    () => ({
      title: page.title,
      description: page.description,
      pathname: page.pathname,
      publishAt: page.publishDate?.toISOString().slice(0, 16) || '',
      unpublishAt: page.unpublishDate?.toISOString().slice(0, 16) || '',
      robots: page.robots || '',
      canonical: page.canonical || '',
    }),
    [page],
  );

  const [formValues, setFormValues] = useState<Record<string, unknown>>(initialValues);

  // Reset form when page changes
  useEffect(() => {
    setFormValues(initialValues);
  }, [initialValues]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Convert form values back to PageMetadata
    const metadata: PageMetadata = {
      title: (formValues.title as string) || '',
      description: (formValues.description as string) || '',
      pathname: (formValues.pathname as string) || '',
      publishDate: formValues.publishAt ? new Date(formValues.publishAt as string) : null,
      unpublishDate: formValues.unpublishAt ? new Date(formValues.unpublishAt as string) : null,
      robots: (formValues.robots as string) || undefined,
      canonical: (formValues.canonical as string) || undefined,
    };

    onSave?.(metadata);
    onOpenChange?.(false);
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

          <form onSubmit={handleSubmit}>
            <SchemaForm schema={pageEditableSchema} values={formValues} onChange={setFormValues} />

            <div className="flex gap-2 pt-6">
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
