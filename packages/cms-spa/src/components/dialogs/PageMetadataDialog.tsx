import type { FieldConflict } from '@conloca/content-api';
import * as Dialog from '@radix-ui/react-dialog';
import cn from 'clsx';
import { X } from 'lucide-react';
import type React from 'react';
/* oxlint-disable anti-slop/no-unsafe-dictionary-type -- Form state intentionally mirrors SchemaForm/HintForm's validated Record<string, unknown> contract until schema parsing materializes PageMetadata. */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { pathnameOnlyFields, publishWindowFields, seoPublishingFields } from '../../content-form-fields.js';
import { type PageSchemaDescriptor, resolvePageSchemaEntry, usePageSchemas } from '../../page-schemas.js';
import type { CorePageSettingName } from '../../page-setting-attributes.js';
import type { PageMetadata } from '../../types.js';
import { ApplyClashError, clashPath, withTheirs } from '../../utils/apply-clash.js';
import {
  flattenForHints,
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
  unflattenFromHints,
} from '../../utils/pageMetadata.js';
import { HintForm } from '../forms/HintForm.js';
import { SchemaForm } from '../forms/SchemaForm.js';
import { Button, FieldError, IconButton, Input } from '../ui/index.js';

type Assert<T extends true> = T;
type DialogCoreField = 'title' | keyof typeof pathnameOnlyFields | keyof typeof seoPublishingFields;
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
  /** The version `page` was read from; the form keeps the one it opened with, as a refetch must not move it. */
  etag?: string;
  /** `etag`: the version the form's values came from, which a live write merges from. */
  onSave?: (metadata: PageMetadata, etag: string | undefined) => void | Promise<void>;
  /** The field to open at: focused and scrolled into view. */
  focusField?: string;
  /** Disables the URL path field and says why under it. */
  pathnameNote?: string;
  /** Edited live: the form keeps the page it opened with and takes no edits while a save is out. */
  live?: boolean;
}

export function PageMetadataDialog({
  open,
  onOpenChange,
  page,
  etag,
  onSave,
  focusField,
  pathnameNote,
  live,
}: PageMetadataDialogProps) {
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
            etag={etag}
            live={live}
            descriptor={descriptor}
            onSave={onSave}
            onSaved={() => onOpenChange?.(false)}
            pathnameNote={pathnameNote}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface PageMetadataFormProps {
  formRef: React.Ref<HTMLFormElement>;
  page: PageMetadata;
  etag?: string;
  live?: boolean;
  descriptor: PageSchemaDescriptor | null;
  onSave?: (metadata: PageMetadata, etag: string | undefined) => void | Promise<void>;
  onSaved: () => void;
  pathnameNote?: string;
}

/** The values conloca's own sections show for `page`, dates as the datetime-local text their inputs edit. */
function coreFormValues(page: PageMetadata) {
  return {
    title: page.title,
    pathname: page.pathname,
    description: page.description,
    publishAt: toDatetimeLocalValue(page.publishDate),
    unpublishAt: toDatetimeLocalValue(page.unpublishDate),
    robots: page.robots || '',
    canonical: page.canonical || '',
  };
}

/** Edits a copy of the page's settings taken when the form mounts; unmounting it discards unsaved edits. */
function PageMetadataForm({
  formRef,
  page: pageProp,
  etag,
  live,
  descriptor,
  onSave,
  onSaved,
  pathnameNote,
}: PageMetadataFormProps) {
  const mode = descriptor?.coreFields?.mode ?? 'full';

  // Convert PageMetadata to form values (flatten dates to strings).
  // In 'full' mode the conloca sections own title/description/robots/canonical
  // (read from explicit PageMetadata fields). In 'minimal'/'none' modes those
  // come from customMeta — extractPageMetadata already routed them there.
  const [coreValues, setCoreValues] = useState<Record<string, unknown>>(() => coreFormValues(pageProp));
  const [customValues, setCustomValues] = useState<Record<string, unknown>>(() =>
    flattenForHints(pageProp.customMeta || {}, new Set(Object.keys(descriptor?.ui ?? {}))),
  );
  // The version the form's values came from: fixed at open, as a refetch changes no value the form shows.
  const version = useRef(etag);
  // Live, the page the form opened with (or last reloaded): a refetch's newer schedule text must not reach the save.
  const opened = useRef(pageProp);
  // The values the form showed at open (or at the last clash reload), to tell the alert which fields the person changed.
  const opening = useRef({ ...coreValues, ...customValues });
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

  const loadTheirs = ({ fields, latest }: ApplyClashError) => {
    const hintKeys = new Set(Object.keys(descriptor?.ui ?? {}));
    if (latest) {
      // Live, the whole form moves to the page as it is now and the version it was read at, so the next Apply sends
      // nothing older than that read; the alert says what the person had tried to set.
      changeCoreValues(coreFormValues(latest.page));
      const custom = flattenForHints(latest.page.customMeta || {}, hintKeys);
      changeCustomValues(custom);
      opening.current = { ...coreFormValues(latest.page), ...custom };
      version.current = latest.etag;
      opened.current = latest.page;
      return;
    }
    // The keys conloca's own sections show; in 'minimal' and 'none' the site's schema holds the title and the rest.
    const coreKeys = new Set(mode === 'full' ? Object.keys(coreValues) : ['pathname', 'publishAt', 'unpublishAt']);
    const isCore = (field: FieldConflict) => coreKeys.has(clashPath(field.anchor));
    changeCoreValues(withTheirs(coreValues, fields.filter(isCore)));
    changeCustomValues(
      withTheirs(
        customValues,
        fields.filter((field) => !isCore(field)),
        hintKeys,
      ),
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Guard the operation itself: a disabled button does not guard every submit path.
    if (pending.current || titleMissing) return;
    const submittedRevision = revision.current;
    setSaveError(null);

    const materializedCustom = descriptor?.ui ? unflattenFromHints(customValues) : customValues;
    // Live, every setting the form does not hold comes from the page the form opened with, never from a refetch.
    const page = live ? opened.current : pageProp;

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
      publishAtText: page.publishAtText,
      unpublishAtText: page.unpublishAtText,
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
      await onSave?.(metadata, version.current);
    } catch (error) {
      if (mounted.current) {
        // A clash loads the other value of each clashing field, so the next Apply starts from it.
        if (error instanceof ApplyClashError) {
          const shown = { ...coreValues, ...customValues };
          const changed = error.latest
            ? Object.keys(shown)
                .filter((path) => JSON.stringify(shown[path]) !== JSON.stringify(opening.current[path]))
                .map((path) => ({ path, value: shown[path] }))
            : undefined;
          loadTheirs(error);
          setSaveError(error.describe((path) => descriptor?.ui?.[path]?.label, changed));
        } else {
          setSaveError(
            error instanceof Error ? error.message : 'Saving failed. Your changes are still here — try again.',
          );
        }
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
      {/* Live, no edits while a save is out: the form would hold values the next save sends from a version that is gone. */}
      <fieldset disabled={live && saving}>
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
        <fieldset disabled={pathnameNote !== undefined} className={cn({ 'mt-6': mode === 'full' })}>
          <SchemaForm fields={pathnameOnlyFields} values={coreValues} onChange={changeCoreValues} />
          {pathnameNote && <p className="mt-1 text-sm text-grey-04 dark:text-grey-07">{pathnameNote}</p>}
        </fieldset>

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
            <SchemaForm
              className="mt-6"
              schema={descriptor.schema}
              values={customValues}
              onChange={changeCustomValues}
            />
          ))}

        {mode === 'full' && (
          <SchemaForm className="mt-6" fields={seoPublishingFields} values={coreValues} onChange={changeCoreValues} />
        )}
        {mode === 'minimal' && (
          <SchemaForm className="mt-6" fields={publishWindowFields} values={coreValues} onChange={changeCoreValues} />
        )}
      </fieldset>

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
