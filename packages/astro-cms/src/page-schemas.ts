/**
 * Light page-schema helpers for Astro content configs and host schema modules.
 * Does not import the CMS SPA / MDX editor.
 */
export {
  type CoreFieldsMode,
  type DataSchemas,
  defineHostSchema,
  definePageSchema,
  type FieldHint,
  type FieldHintCommon,
  type FieldHints,
  type FieldHintVariant,
  type HostSchema,
  type HostSchemaType,
  type PageSchemaDescriptor,
  type PageSchemaEntry,
  type PageSchemaGroup,
  type PageSchemas,
  type ResolveSchemaContext,
  resolvePageSchemaEntry,
  toPageSchemaDescriptor,
} from '@conloca/cms-spa/page-schema-define';
