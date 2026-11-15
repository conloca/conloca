const REASON_LABELS = new Map([
  ['discard', 'Discarded'],
  ['reset', 'Discarded by a reset'],
  ['delete', 'Deleted'],
  ['pick', 'Not chosen in a clash'],
  ['overwrite', 'Overwritten while editing'],
  ['superseded', 'Older GitHub value'],
  ['upstream', 'Replaced by a GitHub push'],
  ['stale', 'Unsynced edits from an older tab'],
  ['unbased', 'Saved by an older editor'],
  ['refused', 'Not saved after an access change'],
  ['clashed', 'Kept from a clash'],
]);

/** Why a version was set aside, in the Recent versions list's words; a reason this editor doesn't know reads `Saved copy`. */
export function versionReasonLabel(reason: string): string {
  return REASON_LABELS.get(reason) ?? 'Saved copy';
}

/** The status after a restore; `kept` are the fields that changed since the version and kept their newer value. */
export function restoredMessage(label: string, kept: string[]): string {
  if (kept.length === 0) return `Restored ${label}.`;
  return kept.length === 1
    ? `Restored ${label}. 1 field kept its newer value.`
    : `Restored ${label}. ${kept.length} fields kept their newer value.`;
}

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** A day as the version copy writes it, `5 Dec 2026`. */
export function versionDay(at: number): string {
  return DAY.format(at);
}
