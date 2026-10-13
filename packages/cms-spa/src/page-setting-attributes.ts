import type { HostPageMeta } from '@conloca/content-api-client';

/** Marks an element on the editor canvas as showing one of the page's settings. */
export const PAGE_SETTING_ATTRIBUTE = 'data-conloca-page-setting';

/**
 * The fields Page settings renders for every page, whatever the site declares.
 * PageMetadataDialog proves at compile time that this is exactly its core fields.
 */
export type CorePageSettingName =
  | 'canonical'
  | 'description'
  | 'pathname'
  | 'publishAt'
  | 'robots'
  | 'title'
  | 'unpublishAt';

/** The keys a type declares, without a catch-all index signature. */
type DeclaredKeys<T> = keyof { [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K] };

/** A page setting a block can show: a core field, or one the site declares on `HostPageMeta` through its page schemas. */
// oxlint-disable-next-line typescript/no-redundant-type-constituents -- HostPageMeta is deliberately empty here; downstream sites add keys through module augmentation.
export type PageSettingName = CorePageSettingName | Extract<DeclaredKeys<HostPageMeta>, string>;

export interface PageSettingAttributes {
  readonly 'data-conloca-page-setting'?: PageSettingName;
}

/**
 * Attributes for an element a block renders from one of the page's settings rather than its own props.
 * On the editor canvas they mark the element, so a click opens Page settings at that field; everywhere
 * else (the published page, a preview, a hydrated block without `puck`) they are empty, so the markup is unchanged.
 */
export function pageSettingAttributes(
  puck: { readonly isEditing: boolean } | undefined,
  name: PageSettingName,
): PageSettingAttributes {
  return puck?.isEditing ? { [PAGE_SETTING_ATTRIBUTE]: name } : {};
}
