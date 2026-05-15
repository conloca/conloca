import { useEffect, useState } from 'react';
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
 * - `'full'` (default): show today's `pageInfoSchema` (title/pathname) +
 *   host fields + `seoPublishingSchema` (description/robots/canonical/
 *   publishAt/unpublishAt). Backwards-compatible with existing dialogs.
 * - `'minimal'`: show pathname only + host fields + publishAt/unpublishAt.
 *   Use when the host owns title/description in its own schema.
 * - `'none'`: host fields only. Host must declare `title` in its schema
 *   (validated at registration; ContentMeta.title is required at the
 *   content-api level).
 */
export type CoreFieldsMode = 'full' | 'minimal' | 'none';

export interface PageSchemaDescriptor {
  /** Human-readable label shown in the dialog header. */
  label?: string;
  /** Zod schema used for validation and field-shape introspection. */
  schema: z.ZodObject<z.ZodRawShape>;
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
 * Mirrors Astro's `defineConfig` — purely for editor inference.
 *
 * @example
 * ```ts
 * export const pageSchemas = {
 *   'type:mdx': definePageSchema({
 *     label: 'MDX page',
 *     schema: mdxPageSchema,
 *     ui: { title: { control: 'text', group: 'basics', required: true } },
 *     groups: [{ id: 'basics', label: 'Basics' }],
 *     coreFields: { mode: 'minimal' },
 *   }),
 * };
 * ```
 */
export function definePageSchema(descriptor: PageSchemaDescriptor): PageSchemaDescriptor {
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
 * Shared state for page schemas across module instances.
 * Uses window to ensure virtual modules and bundled code share the same state.
 */

interface SharedPageSchemaState {
  schemas: PageSchemas;
  subscribers: Set<(schemas: PageSchemas) => void>;
}

const getSharedState = (): SharedPageSchemaState => {
  if (typeof window !== 'undefined') {
    if (!(window as any).__PAGE_SCHEMAS_STATE__) {
      (window as any).__PAGE_SCHEMAS_STATE__ = {
        schemas: {},
        subscribers: new Set(),
      };
    }
    return (window as any).__PAGE_SCHEMAS_STATE__;
  }
  // SSR fallback
  return { schemas: {}, subscribers: new Set() };
};

/**
 * Set the page schemas for all match keys.
 * Called by the virtual module that loads user's schema definitions.
 * Notifies all subscribers of the change (enables HMR).
 */
export function setPageSchemas(schemas: PageSchemas): void {
  const state = getSharedState();
  state.schemas = schemas;
  state.subscribers.forEach((fn) => fn(schemas));
}

/**
 * Get the current page schemas synchronously.
 */
export function getPageSchemas(): PageSchemas {
  return getSharedState().schemas;
}

/**
 * React hook to subscribe to page schema changes.
 * Returns the current schemas and updates when they change (HMR support).
 */
export function usePageSchemas(): PageSchemas {
  const [schemas, setSchemas] = useState(() => getSharedState().schemas);

  useEffect(() => {
    const state = getSharedState();

    // Update immediately in case schemas changed between render and effect
    if (state.schemas !== schemas) {
      setSchemas(state.schemas);
    }

    state.subscribers.add(setSchemas);
    return () => {
      state.subscribers.delete(setSchemas);
    };
  }, []);

  return schemas;
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
