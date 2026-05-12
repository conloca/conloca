import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { type PageSchemaDescriptor, resolvePageSchemaEntry, usePageSchemas } from '../../page-schemas';
import type { PageMetadata } from '../../types';
import { flattenForHints, unflattenFromHints } from '../../utils/pageMetadata';
import { HintForm } from '../forms/HintForm';
import { SchemaForm } from '../forms/SchemaForm';
import { Button, IconButton } from '../ui';

const pathnameOnlySchema = z.object({
  pathname: z.string().describe('URL path (e.g., /about)'),
});

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

const publishWindowSchema = z.object({
  publishAt: z.coerce.date().nullable().optional().describe('Schedule publish date/time'),
  unpublishAt: z.coerce.date().nullable().optional().describe('Schedule unpublish date/time'),
});

interface PageMetadataDialogProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  page: PageMetadata;
  onSave?: (metadata: PageMetadata) => void;
}

export function PageMetadataDialog({ open, onOpenChange, page, onSave }: PageMetadataDialogProps) {
  const pageSchemas = usePageSchemas();

  const resolved = useMemo(
    () =>
      resolvePageSchemaEntry(pageSchemas, {
        pathname: page.pathname,
        collection: page.collection,
        type: page.type,
      }),
    [pageSchemas, page.pathname, page.collection, page.type],
  );
  const descriptor: PageSchemaDescriptor | null = resolved?.descriptor ?? null;
  const mode = descriptor?.coreFields?.mode ?? 'full';

  // Convert PageMetadata to form values (flatten dates to strings).
  // In 'full' mode the conloca sections own title/description/robots/canonical
  // (read from explicit PageMetadata fields). In 'minimal'/'none' modes those
  // come from customMeta — extractPageMetadata already routed them there.
  const initialCoreValues = useMemo(
    () => ({
      title: page.title,
      pathname: page.pathname,
      description: page.description,
      publishAt: page.publishDate?.toISOString().slice(0, 16) || '',
      unpublishAt: page.unpublishDate?.toISOString().slice(0, 16) || '',
      robots: page.robots || '',
      canonical: page.canonical || '',
    }),
    [page],
  );

  const hintKeys = useMemo(() => new Set(Object.keys(descriptor?.ui ?? {})), [descriptor]);

  const initialCustomValues = useMemo(() => {
    const base = page.customMeta || {};
    return flattenForHints(base, hintKeys);
  }, [page.customMeta, hintKeys]);

  const [coreValues, setCoreValues] = useState<Record<string, unknown>>(initialCoreValues);
  const [customValues, setCustomValues] = useState<Record<string, unknown>>(initialCustomValues);

  useEffect(() => setCoreValues(initialCoreValues), [initialCoreValues]);
  useEffect(() => setCustomValues(initialCustomValues), [initialCustomValues]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const materializedCustom = descriptor?.ui ? unflattenFromHints(customValues) : customValues;

    const metadata: PageMetadata = {
      title:
        mode === 'full'
          ? (coreValues.title as string) || ''
          : (materializedCustom.title as string | undefined) || page.title || '',
      description:
        mode === 'full'
          ? (coreValues.description as string) || ''
          : (materializedCustom.description as string | undefined) || page.description || '',
      pathname: (coreValues.pathname as string) || '',
      publishDate:
        mode !== 'none' && coreValues.publishAt ? new Date(coreValues.publishAt as string) : page.publishDate,
      unpublishDate:
        mode !== 'none' && coreValues.unpublishAt ? new Date(coreValues.unpublishAt as string) : page.unpublishDate,
      robots: mode === 'full' ? (coreValues.robots as string) || undefined : page.robots,
      canonical: mode === 'full' ? (coreValues.canonical as string) || undefined : page.canonical,
      customMeta: materializedCustom,
      collection: page.collection,
      type: page.type,
    };

    onSave?.(metadata);
    onOpenChange?.(false);
  };

  const headerLabel = descriptor?.label ?? 'Page Metadata';

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-overlay rounded-lg shadow-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-lg font-semibold">{headerLabel}</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton icon={X} ariaLabel="Close" variant="ghost" />
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit}>
            {mode === 'full' && <SchemaForm schema={pageInfoSchema} values={coreValues} onChange={setCoreValues} />}
            {(mode === 'minimal' || mode === 'none') && (
              <SchemaForm schema={pathnameOnlySchema} values={coreValues} onChange={setCoreValues} />
            )}

            {descriptor &&
              (descriptor.ui ? (
                <HintForm
                  className="mt-6"
                  hints={descriptor.ui}
                  groups={descriptor.groups}
                  values={customValues}
                  onChange={setCustomValues}
                />
              ) : (
                <SchemaForm
                  className="mt-6"
                  schema={descriptor.schema}
                  values={customValues}
                  onChange={setCustomValues}
                />
              ))}

            {mode === 'full' && (
              <SchemaForm className="mt-6" schema={seoPublishingSchema} values={coreValues} onChange={setCoreValues} />
            )}
            {mode === 'minimal' && (
              <SchemaForm className="mt-6" schema={publishWindowSchema} values={coreValues} onChange={setCoreValues} />
            )}

            <div className="flex gap-2 pt-6">
              <Button type="submit" variant="primary" className="flex-1">
                Save
              </Button>
              <Dialog.Close asChild>
                <Button variant="outline" className="flex-1">
                  Cancel
                </Button>
              </Dialog.Close>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
