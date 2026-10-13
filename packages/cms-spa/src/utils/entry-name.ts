import { type ContentManifest, localesOf } from '@conloca/content-api-client';

/**
 * The name for a new fragment or data entry whose title has no letters a–z or digits to make one
 * from (Фото, 照片): 'untitled', else the first of 'untitled-2', 'untitled-3' and so on that none of
 * `entries`, the rest of its collection, has in any letter case. The name is the file's name, and
 * names that differ only in letter case share one file on a case-insensitive disk.
 */
export function untitledName(entries: ContentManifest[]): string {
  const taken = new Set(
    entries.flatMap((entry) => Array.from(localesOf(entry), (locale) => locale.name?.toLowerCase())),
  );
  let name = 'untitled';
  for (let number = 2; taken.has(name); number++) name = `untitled-${number}`;
  return name;
}

/** Where `name`, the untitled name made for a title with none to give, came from, for the author. */
export function untitledNameNote(name: string): string {
  return `The title has no letters a–z or digits to make a name from, so it was named ${name}.`;
}
