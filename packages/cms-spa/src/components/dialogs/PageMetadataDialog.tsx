import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { type PageSchemas, usePageSchemas } from '../../page-schemas';
import type { PageMetadata } from '../../types';
import { SchemaForm } from '../forms/SchemaForm';

const pageInfoSchema = z.object({
  title: z.string().describe('Page title for SEO and browser tab'),
  pathname: z.string().describe('URL path (e.g., /about)'),
});

const seoPublishingSchema = z.object({
  description: z.string().optional().describe('Meta description for search engines'),
  robots: z.string().optional().describe('Robots meta tag (e.g., index, follow)'),
  canonical: z.string().url().optional().describe('Canonical URL for duplicate content'),
  publishAt: z.coerce.date().nullable().optional().describe('Schedule publish date/time'),
  unpublishAt: z.coerce.date().nullable().optional().describe('Schedule unpublish date/time'),
});

function resolvePageSchema(
  pathname: string,
  pageSchemas: PageSchemas,
): { schema: z.ZodObject<z.ZodRawShape>; sectionName: string } | null {
  let bestMatch: string | null = null;
  for (const prefix of Object.keys(pageSchemas)) {
    if (pathname.startsWith(prefix)) {
      if (!bestMatch || prefix.length > bestMatch.length) {
        bestMatch = prefix;
      }
    }
  }
  if (!bestMatch) return null;
  const name = bestMatch.replace(/^\/|\/$/g, '');
  const segments = name.split('/');
  const sectionName = segments.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(' ') + ' Details';
  return { schema: pageSchemas[bestMatch], sectionName };
}

interface PageMetadataDialogProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  page: PageMetadata;
  onSave?: (metadata: PageMetadata) => void;
}

export function PageMetadataDialog({ open, onOpenChange, page, onSave }: PageMetadataDialogProps) {
  const pageSchemas = usePageSchemas();

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
  const [customValues, setCustomValues] = useState<Record<string, unknown>>(page.customMeta || {});

  // Reset form when page changes
  useEffect(() => {
    setFormValues(initialValues);
  }, [initialValues]);

  useEffect(() => {
    setCustomValues(page.customMeta || {});
  }, [page.customMeta]);

  const resolvedSchema = useMemo(
    () => resolvePageSchema((formValues.pathname as string) || page.pathname, pageSchemas),
    [formValues.pathname, page.pathname, pageSchemas],
  );

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
      customMeta: resolvedSchema ? customValues : undefined,
    };

    onSave?.(metadata);
    onOpenChange?.(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-grey-03 rounded-lg shadow-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-lg font-semibold">Page Metadata</Dialog.Title>
            <Dialog.Close className="p-1 hover:bg-grey-11 dark:hover:bg-grey-03 rounded">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit}>
            <SchemaForm schema={pageInfoSchema} values={formValues} onChange={setFormValues} />

            {resolvedSchema && (
              <SchemaForm
                className="mt-6"
                schema={resolvedSchema.schema}
                values={customValues}
                onChange={setCustomValues}
              />
            )}

            <SchemaForm className="mt-6" schema={seoPublishingSchema} values={formValues} onChange={setFormValues} />

            <div className="flex gap-2 pt-6">
              <button
                type="submit"
                className="flex-1 px-4 py-2 bg-azure-04 text-white rounded hover:bg-azure-03 transition-colors"
              >
                Save
              </button>
              <Dialog.Close className="flex-1 px-4 py-2 border border-grey-09 dark:border-grey-04 rounded hover:bg-grey-11 dark:hover:bg-grey-03 transition-colors">
                Cancel
              </Dialog.Close>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
