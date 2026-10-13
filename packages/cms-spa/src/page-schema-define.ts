import type { z } from 'zod';

/**
 * Form-UI hint vocabulary for page metadata fields.
 *
 * Hosts attach a hint to each field they want surfaced in the page-settings
 * dialog. The hint drives form rendering — control type, grouping, helper
 * text, etc. — independently of the Zod schema, which still owns validation.
 *
 * Dotted keys ('sidebar.label') are supported in the hint record; on save
 * they materialize into nested objects in YAML frontmatter, and on load
 * they flatten back to dotted keys for the form.
 */
export type FieldHintCommon = {
  label?: string;
  help?: string;
  /** Refs a `groups[].id` to bucket fields into sections in the dialog. */
  group?: string;
  required?: boolean;
  hidden?: boolean | ((doc: Record<string, unknown>) => boolean);
  defaultValue?: unknown;
};

export type FieldHintVariant = {
  id: string;
  label: string;
  /** Concrete value written when this variant is selected (for literal variants). */
  value?: unknown;
} & Partial<FieldHint>;

export type FieldHint = FieldHintCommon &
  (
    | {
        control: 'text' | 'textarea' | 'url' | 'email' | 'number' | 'switch' | 'date' | 'image' | 'markdown' | 'code';
      }
    | { control: 'select'; options: ReadonlyArray<{ value: string; label: string }> }
    | { control: 'chips' }
    | { control: 'object'; fields: Record<string, FieldHint> }
    | { control: 'array'; of: FieldHint }
    | { control: 'variant'; variants: ReadonlyArray<FieldHintVariant> }
  );

export type FieldHints = Record<string, FieldHint>;

export type PageSchemaGroup = {
  id: string;
  label: string;
  description?: string;
};

/**
 * Which conloca-managed sections to render alongside the host schema.
 *
 * - `'full'` (default): show the title and pathname fields +
 *   host fields + `seoPublishingSchema` (description/robots/canonical/
 *   publishAt/unpublishAt). Backwards-compatible with existing dialogs.
 * - `'minimal'`: show pathname only + host fields + publishAt/unpublishAt.
 *   Use when the host owns title/description in its own schema.
 * - `'none'`: host fields only. Host must declare `title` in its schema
 *   (validated at registration; ContentMeta.title is required at the
 *   content-api level).
 */
export type CoreFieldsMode = 'full' | 'minimal' | 'none';

export interface PageSchemaDescriptor<S extends z.ZodObject<z.ZodRawShape> = z.ZodObject<z.ZodRawShape>> {
  /** Human-readable label shown in the dialog header. */
  label?: string;
  /** Zod schema used for validation and field-shape introspection. */
  schema: S;
  /** Form-UI hints keyed by field name (dotted keys allowed for nested fields). */
  ui?: FieldHints;
  /** Section definitions; `FieldHint.group` references `id`. */
  groups?: ReadonlyArray<PageSchemaGroup>;
  /** Which conloca core fields to render alongside the host schema. */
  coreFields?: { mode: CoreFieldsMode };
}

/**
 * Identity helper that gives `pageSchemas` entries a typed shape.
 *
 * Mirrors Astro's `defineConfig` — purely for editor inference. The schema's
 * concrete type is carried through the descriptor (not widened), so a host
 * can recover its metadata type from `z.infer<typeof descriptor.schema>`.
 *
 * Import this from `@conloca/astro-cms/page-schemas` in a content config so
 * the MDX editor / React registry is not pulled into Astro's content layer.
 */
export function definePageSchema<S extends z.ZodObject<z.ZodRawShape>>(
  descriptor: PageSchemaDescriptor<S>,
): PageSchemaDescriptor<S> {
  if (descriptor.coreFields?.mode === 'none' && !('title' in descriptor.schema.shape)) {
    throw new Error(
      "definePageSchema: coreFields.mode 'none' requires the schema to declare a `title` field " +
        '(ContentMeta.title is required by the content-api).',
    );
  }
  return descriptor;
}

/**
 * Registry entry value: either a bare Zod object (legacy — wrapped as a
 * descriptor with `coreFields.mode: 'full'`) or an explicit descriptor.
 */
export type PageSchemaEntry = z.ZodObject<z.ZodRawShape> | PageSchemaDescriptor;

/**
 * Page-schema registry keyed by match expression.
 *
 * Match key forms (resolved in order):
 * - `collection:<name>` — matches when the loaded entry's collection equals `<name>`.
 * - `type:<puck|mdx>` — matches all pages of the given content type.
 * - pathname prefix (must start with `/`) — longest-prefix-match against the page's pathname.
 */
export type PageSchemas = Record<string, PageSchemaEntry>;

/**
 * Normalize an entry to a descriptor. Bare Zod objects (legacy) get wrapped
 * with default `coreFields.mode: 'full'` so the dialog can render today's
 * three-section layout unchanged.
 */
export function toPageSchemaDescriptor(entry: PageSchemaEntry): PageSchemaDescriptor {
  if (isPageSchemaDescriptor(entry)) return entry;
  return { schema: entry, coreFields: { mode: 'full' } };
}

function isPageSchemaDescriptor(value: PageSchemaEntry): value is PageSchemaDescriptor {
  return typeof value === 'object' && value !== null && 'schema' in value && !('shape' in value);
}

/**
 * Context the resolver needs to pick the right schema.
 *
 * - `collection` and `type` come from the loaded entry's `ContentIdentity`.
 * - `pathname` comes from the page's `LocaleVersion`.
 */
export interface ResolveSchemaContext {
  pathname: string;
  collection?: string;
  type?: 'puck' | 'mdx';
}

/**
 * Resolve the best-matching descriptor for a page.
 *
 * Resolution order: `collection:<name>` > `type:<puck|mdx>` >
 * pathname-prefix (longest match wins). Returns `null` if no key matches.
 */
export function resolvePageSchemaEntry(
  schemas: PageSchemas,
  context: ResolveSchemaContext,
): { key: string; descriptor: PageSchemaDescriptor } | null {
  if (context.collection) {
    const key = `collection:${context.collection}`;
    if (key in schemas) return { key, descriptor: toPageSchemaDescriptor(schemas[key]) };
  }

  if (context.type) {
    const key = `type:${context.type}`;
    if (key in schemas) return { key, descriptor: toPageSchemaDescriptor(schemas[key]) };
  }

  let bestPrefix: string | null = null;
  for (const key of Object.keys(schemas)) {
    if (!key.startsWith('/')) continue;
    if (context.pathname.startsWith(key) && (!bestPrefix || key.length > bestPrefix.length)) {
      bestPrefix = key;
    }
  }
  if (bestPrefix) return { key: bestPrefix, descriptor: toPageSchemaDescriptor(schemas[bestPrefix]) };

  return null;
}

// The data-collection registry type, re-exported so content configs can
// reference it without touching the runtime data-schemas module.
export type { DataSchemas } from './data-schemas.js';
