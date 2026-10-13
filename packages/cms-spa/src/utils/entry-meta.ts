import { type ContentMeta, type ContentMetaPatch, metaString } from '@conloca/content-api-client';

/** The editable fields a properties dialog shows for a fragment or data entry. */
export interface EditableEntryMeta {
  title: string;
  description?: string;
  category?: string;
  tags?: string[];
}

/**
 * The stored metadata a properties dialog needs, read back in full.
 *
 * Every field the dialog can write has to be read here, because the dialog
 * always saves all of them: a field left out arrives as undefined and renders
 * blank, which reads as "this entry has none". Both backends shallow-merge
 * meta on save, so the blank was a lying display rather than a destructive
 * write — but only for as long as every written field is also read here.
 * Category and tags are narrowed rather than asserted, since content is
 * hand-editable in git and only a real string belongs in a text field.
 */
export function editableEntryMeta(meta: ContentMeta | undefined, fallbackTitle: string): EditableEntryMeta | undefined {
  if (!meta) return undefined;

  return {
    title: metaString(meta.title) || fallbackTitle,
    description: metaString(meta.description),
    category: metaString(meta.category),
    tags: Array.isArray(meta.tags) ? meta.tags.filter((tag): tag is string => typeof tag === 'string') : undefined,
  };
}

/**
 * The write-side dual of `editableEntryMeta`: the dialog owns these four
 * fields and always saves all of them, so a cleared field must reach the
 * server as an explicit null. Undefined would be dropped by JSON.stringify
 * and the server's merge would keep the old value — the save reported
 * success while the field quietly came back.
 */
export function entryMetaPatch(meta: EditableEntryMeta): ContentMetaPatch {
  return {
    title: meta.title,
    description: meta.description ?? null,
    category: meta.category ?? null,
    tags: meta.tags ?? null,
  };
}
