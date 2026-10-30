import { createHash } from 'node:crypto';

const CHECKSUM_LINE = /^ {2}checksum: "sha256:([0-9a-f]{64})"$/;
const VERSION_LINE = /^ {2}version: ".*"$/;

/** Hex sha256 of a skill page, CRLF read as LF so a Windows checkout of an unedited page hashes the same. */
export function skillChecksum(text: string): string {
  return createHash('sha256').update(text.replaceAll('\r\n', '\n')).digest('hex');
}

/** The index of the frontmatter's closing `---` line, -1 when the page opens without frontmatter. */
function frontmatterEnd(lines: string[]): number {
  return lines[0] === '---' ? lines.indexOf('---', 1) : -1;
}

/** The index of the `metadata:` line inside the frontmatter, -1 when there is none. */
function metadataLine(lines: string[]): number {
  const index = lines.indexOf('metadata:', 1);
  return index !== -1 && index < frontmatterEnd(lines) ? index : -1;
}

/** The template with its release and the checksum of the template itself recorded at the end of its frontmatter. */
export function stampSkill(template: string, version: string): string {
  const lines = template.split('\n');
  const end = frontmatterEnd(lines);
  if (end === -1) throw new Error('the skill template has no frontmatter to stamp');
  if (metadataLine(lines) !== -1) throw new Error('the skill template already carries a metadata: block');
  lines.splice(end, 0, 'metadata:', `  version: "${version}"`, `  checksum: "sha256:${skillChecksum(template)}"`);
  return lines.join('\n');
}

/**
 * Whether a skill page is still the text a release wrote: a stamped page must hash, stamp removed, to its recorded
 * checksum; an unstamped page must hash to one of the given released checksums.
 */
export function isUneditedSkill(text: string, legacyChecksums: readonly string[]): boolean {
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  const at = metadataLine(lines);
  const checksum = at === -1 ? undefined : CHECKSUM_LINE.exec(lines[at + 2] ?? '')?.[1];
  if (checksum === undefined || !VERSION_LINE.test(lines[at + 1] ?? '')) {
    return legacyChecksums.includes(skillChecksum(text));
  }
  lines.splice(at, 3);
  return skillChecksum(lines.join('\n')) === checksum;
}
