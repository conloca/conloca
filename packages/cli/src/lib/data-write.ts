import { join } from 'node:path';
import { FileSystemContentAPI } from '@conloca/content-api/node';
import { PageWriteError, siteLocale } from './page-write.js';

export interface DataWriteInput {
  contentRoot: string;
  /** The site whose default locale the entry is written in. */
  site: string;
  collection: string;
  name: string;
  /** Defaults to the name. */
  title?: string;
  data: Record<string, unknown>;
}

export interface DataUpdateInput {
  contentRoot: string;
  site: string;
  collection: string;
  /** The entry id, or its name in `collection`. */
  ref: string;
  /** Left as stored when not given. */
  title?: string;
  /** Replaces the entry's data. */
  data: Record<string, unknown>;
}

export interface DataWriteResult {
  id: string;
  filePath: string;
}

/** Where the backend stores a data entry (its getFilePath). */
function dataFilePath(contentRoot: string, collection: string, name: string, locale: string): string {
  return join(contentRoot, 'data', collection, `${name}.${locale}.json`);
}

/** Write one data entry in the site's default locale and return where it landed. */
export async function writeDataEntry(input: DataWriteInput): Promise<DataWriteResult> {
  const { contentRoot, collection, name } = input;
  const locale = await siteLocale(contentRoot, input.site);
  const api = await FileSystemContentAPI.create({ contentRoot });
  const result = await api.data.create({
    collection,
    name,
    locales: { [locale]: { meta: { title: input.title ?? name }, content: { data: input.data } } },
  });
  if (!result.success || !result.id) {
    throw new PageWriteError(
      'write_failed',
      result.error?.message ?? `Create failed (${result.reason ?? 'unknown reason'})`,
      result.field,
    );
  }
  return { id: result.id, filePath: dataFilePath(contentRoot, collection, name, locale) };
}

/** Replace the data of one entry of `collection` in the site's default locale, found by id or by name. */
export async function updateDataEntry(input: DataUpdateInput): Promise<DataWriteResult> {
  const { contentRoot, collection, ref } = input;
  const locale = await siteLocale(contentRoot, input.site);
  const api = await FileSystemContentAPI.create({ contentRoot });
  const manifest = (await api.getContent(ref)) ?? api.data.getByName(collection, ref, locale);
  if (manifest && (manifest.kind !== 'data' || manifest.collection !== collection)) {
    throw new PageWriteError('wrong_kind', `"${ref}" is not a data entry of "${collection}"`);
  }
  const localized = manifest?.locales[locale];
  if (!manifest || !localized?.name) {
    throw new PageWriteError('not_found', `no data entry "${ref}" in ${collection}`);
  }

  const result = await api.updateLocalized({
    id: manifest.id,
    locale,
    etag: localized.etag,
    data: { ...(input.title === undefined ? {} : { meta: { title: input.title } }), content: { data: input.data } },
  });
  if (!result.success) {
    throw new PageWriteError(
      'write_failed',
      result.error?.message ?? `Update failed (${result.reason ?? 'unknown reason'})`,
    );
  }
  return { id: manifest.id, filePath: dataFilePath(contentRoot, collection, localized.name, locale) };
}
