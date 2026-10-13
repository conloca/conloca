import * as Dialog from '@radix-ui/react-dialog';
import cn from 'clsx';
import { X } from 'lucide-react';
import type React from 'react';
/* oxlint-disable anti-slop/no-unsafe-dictionary-type -- Form state intentionally mirrors SchemaForm/HintForm's validated Record<string, unknown> contract until schema parsing materializes PageMetadata. */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { type PageSchemaDescriptor, resolvePageSchemaEntry, usePageSchemas } from '../../page-schemas.js';
import type { CorePageSettingName } from '../../page-setting-attributes.js';
import type { PageMetadata } from '../../types.js';
import {
  flattenForHints,
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
  unflattenFromHints,
} from '../../utils/pageMetadata.js';
import { HintForm } from '../forms/HintForm.js';
import { SchemaForm } from '../forms/SchemaForm.js';
import { Button, FieldError, IconButton, Input } from '../ui/index.js';

const pathnameOnlySchema = z.object({
  pathname: z.string().describe('URL path (e.g., /about)'),
});

const publishWindowSchema = z.object({
  publishAt: z.coerce
    .date()
    .nullable()
    .optional()
    .describe(
      'When the page goes live. Page lists that sort by date use this date, or the date the page was created when it is empty.',
    ),
  unpublishAt: z.coerce.date().nullable().optional().describe('Schedule unpublish date/time'),
});

const seoPublishingSchema = z
  .object({
    description: z.string().optional().describe('Meta description for search engines'),
    robots: z.string().optional().describe('Robots meta tag (e.g., index, follow)'),
    canonical: z.string().url().optional().describe('Canonical URL for duplicate content'),
  })
  .extend(publishWindowSchema.shape);

type Assert<T extends true> = T;
type DialogCoreField = 'title' | keyof z.infer<typeof pathnameOnlySchema> | keyof z.infer<typeof seoPublishingSchema>;
/** A block can name exactly the core fields this dialog renders (CorePageSettingName): renaming a field here breaks the typecheck. */
export type CoreFieldNamesProof = Assert<
  [DialogCoreField] extends [CorePageSettingName]
    ? [CorePageSettingName] extends [DialogCoreField]
      ? true
      : false
    : false
>;

/**
 * Focuses the control of the form field named `name` and scrolls the field into view, label included; false
 * when the form has no such field. The label names the control both ways a form here pairs them: `for` and
 * `id`, and a label wrapping its checkbox. A field without one (a group of controls) focuses its first control.
 */
function focusSettingField(form: HTMLFormElement | null, name: string): boolean {
  const field = Array.from(form?.querySelectorAll<HTMLElement>('[data-field-name]') ?? []).find(
    (candidate) => candidate.dataset.fieldName === name,
  );
  const control =
    field?.querySelector('label')?.control ?? field?.querySelector<HTMLElement>('input, textarea, select, button');
  if (!field || !control) return false;
  control.focus({ preventScroll: true });
  field.scrollIntoView({ block: 'center' });
  return true;
}

interface PageMetadataDialogProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  page: PageMetadata;
  onSave?: (metadata: PageMetadata) => void | Promise<void>;
  /** The field to open at: focused and scrolled into view. */
  focusField?: string;
}

export function PageMetadataDialog({ open, onOpenChange, page, onSave, focusField }: PageMetadataDialogProps) {
  const pageSchemas = usePageSchemas();
  const formRef = useRef<HTMLFormElement>(null);

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

  const headerLabel = descriptor?.label ?? 'Page Metadata';

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 bg-overlay rounded-lg shadow-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto"
          onOpenAutoFocus={(event) => {
            if (focusField === undefined) return;
            if (focusSettingField(formRef.current, focusField)) {
              event.preventDefault();
              return;
            }
            console.warn(`This page's settings have no "${focusField}" field; Page settings opened at the top.`);
          }}
        >
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-lg font-semibold">{headerLabel}</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton icon={X} ariaLabel="Close" variant="ghost" />
            </Dialog.Close>
          </div>

          {/* Dialog.Content mounts the form on every open, so each open starts from the page's saved
              settings and closing without saving discards the edits. */}
          <PageMetadataForm
            formRef={formRef}
            page={page}
            descriptor={descriptor}
            onSave={onSave}
            onSaved={() => onOpenChange?.(false)}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface PageMetadataFormProps {
  formRef: React.Ref<HTMLFormElement>;
  page: PageMetadata;
  descriptor: PageSchemaDescriptor | null;
  onSave?: (metadata: PageMetadata) => void | Promise<void>;
  onSaved: () => void;
}

/** Edits a copy of the page's settings taken when the form mounts; unmounting it discards unsaved edits. */
function PageMetadataForm({ formRef, page, descriptor, onSave, onSaved }: PageMetadataFormProps) {
  const mode = descriptor?.coreFields?.mode ?? 'full';

  // Convert PageMetadata to form values (flatten dates to strings).
  // In 'full' mode the conloca sections own title/description/robots/canonical
  // (read from explicit PageMetadata fields). In 'minimal'/'none' modes those
  // come from customMeta — extractPageMetadata already routed them there.
  const [coreValues, setCoreValues] = useState<Record<string, unknown>>(() => ({
    title: page.title,
    pathname: page.pathname,
    description: page.description,
    publishAt: toDatetimeLocalValue(page.publishDate),
    unpublishAt: toDatetimeLocalValue(page.unpublishDate),
    robots: page.robots || '',
    canonical: page.canonical || '',
  }));
  const [customValues, setCustomValues] = useState<Record<string, unknown>>(() =>
    flattenForHints(page.customMeta || {}, new Set(Object.keys(descriptor?.ui ?? {}))),
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const revision = useRef(0);
  const changeCoreValues = (values: Record<string, unknown>) => {
    revision.current += 1;
    setCoreValues(values);
  };
  const changeCustomValues = (values: Record<string, unknown>) => {
    revision.current += 1;
    setCustomValues(values);
  };
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Every backend refuses a page without a title, so say so before Save sends one. In the
  // 'minimal' and 'none' modes the site's schema may hold the title, and Save sends it as is.
  const titleMissing = mode === 'full' ? !coreValues.title : 'title' in customValues && !customValues.title;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Guard the operation itself: a disabled button does not guard every submit path.
    if (pending.current || titleMissing) return;
    const submittedRevision = revision.current;
    setSaveError(null);

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
      publishDate: mode === 'none' ? page.publishDate : fromDatetimeLocalValue(coreValues.publishAt),
      unpublishDate: mode === 'none' ? page.unpublishDate : fromDatetimeLocalValue(coreValues.unpublishAt),
      robots: mode === 'full' ? (coreValues.robots as string) || undefined : page.robots,
      canonical: mode === 'full' ? (coreValues.canonical as string) || undefined : page.canonical,
      customMeta: materializedCustom,
      collection: page.collection,
      type: page.type,
    };

    // Await the save. A rejected write with the dialog already gone looks like success.
    try {
      pending.current = true;
      setSaving(true);
      await onSave?.(metadata);
    } catch (error) {
      if (mounted.current) {
        setSaveError(
          error instanceof Error ? error.message : 'Saving failed. Your changes are still here — try again.',
        );
      }
      return;
    } finally {
      pending.current = false;
      if (mounted.current) setSaving(false);
    }

    // Closing abandons this form, not a later form opened while its write was in flight.
    if (mounted.current && revision.current === submittedRevision) onSaved();
  };

  const titleId = useId();
  const titleErrorId = `${titleId}-error`;

  return (
    <form ref={formRef} onSubmit={handleSubmit}>
      {/* Rendered here rather than by SchemaForm so the field can point at its error. */}
      {mode === 'full' && (
        <div data-field-name="title">
          <label htmlFor={titleId} className="block text-sm font-medium mb-1 text-grey-01 dark:text-grey-12">
            Title
            <span className="text-red-04 dark:text-red-08 ml-1">*</span>
          </label>
          <Input
            id={titleId}
            type="text"
            value={typeof coreValues.title === 'string' ? coreValues.title : ''}
            onChange={(e) => changeCoreValues({ ...coreValues, title: e.target.value || undefined })}
            aria-invalid={titleMissing}
            aria-describedby={titleMissing ? titleErrorId : undefined}
          />
          <p className="mt-1 text-sm text-grey-04 dark:text-grey-07">Page title for SEO and browser tab</p>
          {titleMissing && (
            <FieldError id={titleErrorId} className="mt-1">
              Enter a page title before saving.
            </FieldError>
          )}
        </div>
      )}
      <SchemaForm
        className={cn({ 'mt-6': mode === 'full' })}
        schema={pathnameOnlySchema}
        values={coreValues}
        onChange={changeCoreValues}
      />

      {descriptor &&
        (descriptor.ui ? (
          <HintForm
            className="mt-6"
            hints={descriptor.ui}
            groups={descriptor.groups}
            values={customValues}
            onChange={changeCustomValues}
          />
        ) : (
          <SchemaForm className="mt-6" schema={descriptor.schema} values={customValues} onChange={changeCustomValues} />
        ))}

      {mode === 'full' && (
        <SchemaForm className="mt-6" schema={seoPublishingSchema} values={coreValues} onChange={changeCoreValues} />
      )}
      {mode === 'minimal' && (
        <SchemaForm className="mt-6" schema={publishWindowSchema} values={coreValues} onChange={changeCoreValues} />
      )}

      {titleMissing && mode !== 'full' && <FieldError className="mt-6">Enter a page title before saving.</FieldError>}
      {saveError && (
        <p role="alert" className="mt-6 text-sm text-red-04 dark:text-red-08">
          {saveError}
        </p>
      )}

      <div className="flex gap-2 pt-6">
        <Button type="submit" variant="primary" className="flex-1" disabled={saving || titleMissing}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Dialog.Close asChild>
          <Button variant="outline" className="flex-1">
            Cancel
          </Button>
        </Dialog.Close>
      </div>
    </form>
  );
}
