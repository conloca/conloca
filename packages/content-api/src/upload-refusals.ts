/**
 * Every sentence an upload is refused or warned with, in every editor and on every server. Each names the file and
 * the next step, so no raw server string reaches the person uploading. Pure strings: the browser entry re-exports
 * them.
 */

/** Megabytes as people count them, rounded up so a file just over the limit never reads as "25 MB". */
function megabytes(bytes: number): number {
  return Math.ceil(bytes / 2 ** 20);
}

function overLimit(limit: number): string {
  return `over the ${megabytes(limit)} MB limit for files stored in your site`;
}

/** A file over the size limit. */
export function tooLargeRefusal(name: string, bytes: number, limit: number): string {
  return `${name} is ${megabytes(bytes)} MB, ${overLimit(limit)}. Save a smaller copy and upload that.`;
}

/** A video: the site's own embed component is where it belongs. */
export function videoRefusal(name: string): string {
  return `${name} is a video. Videos are not stored with your site’s images: upload it to a video service and add it to the page with your site’s video embed component.`;
}

/** A file whose type the site does not store, with the formats it does. */
export function unsupportedTypeRefusal(name: string, formats: readonly string[]): string {
  return `${name} is not an image the editor can store. Use one of: ${formats.map((f) => f.toUpperCase()).join(', ')}.`;
}

/** A file named as an image whose bytes are not one. */
export function unreadableImageRefusal(name: string): string {
  return `${name} could not be read as an image. Export it again from the program that made it and upload the new file.`;
}

/** A URL import that failed; `detail` says why in plain words. */
export function importRefusal(detail: string): string {
  return `The image at that link could not be downloaded: ${detail}. Check the link, or download the image and upload the file.`;
}

/** A URL import whose body passed the size limit. */
export function importTooLargeRefusal(limit: number): string {
  return importRefusal(`it is ${overLimit(limit)}`);
}

/** An online editor upload a Git LFS rule in the repository would catch. */
export function lfsRefusal(name: string, attributesPath: string, pattern: string): string {
  return `${name} would be stored in Git LFS by the rule "${pattern}" in ${attributesPath}, and the online editor cannot store files in Git LFS. Remove that rule from the repository, or add the image with Git on your computer.`;
}

/** An online editor upload checked before the branch's files are in the editor's copy. */
export function repoNotReadyRefusal(): string {
  return 'The editor is still reading this branch from your repository. Try again in a minute.';
}

/** A large photo stored unshrunk because the optional `sharp` is not installed. */
export function shrinkUnavailableWarning(name: string): string {
  return `${name} is larger than 2560 pixels and was stored without shrinking, because the image library sharp is not installed. Run "bun add sharp" in the site to shrink future uploads.`;
}
