/**
 * Fragment edits the save check holds unsent, by entry (id + locale), as `heldByEntry` keeps data values: the doc
 * channel reports them held until they are sent or the user leaves without them. A replaced doc (a discard or restore)
 * or a locale switched back does not apply them again; the editor offers them to copy, and they stay reported held
 * (leaving asks) until the user copies or dismisses them.
 */

import { getUIConfig } from '../ui-config.js';

const heldByEntry = new Map<string, { docKey: string; notice: string; markdown: string }>();
// Held edits turned into a not-applied notice, by the doc they are reported under.
const notAppliedByDoc = new Map<string, string>();

/** Tells the doc channel what `docKey` holds: its held edit's notice, else a not-applied edit's, else nothing. */
function report(docKey: string) {
  const held = [...heldByEntry.values()].find((edit) => edit.docKey === docKey)?.notice;
  getUIConfig().docChannel?.setValuesHeld(docKey, held ?? notAppliedByDoc.get(docKey) ?? null);
}

/** The text `entry` holds unsent, or undefined. */
export function heldFragmentEdit(entry: string): string | undefined {
  return heldByEntry.get(entry)?.markdown;
}

/** Records `entry`'s held edit under `docKey` (a null notice releases it), moving the report off a replaced doc. */
export function setHeldFragmentEdit(entry: string, docKey: string, notice: string | null, markdown: string | null) {
  const before = heldByEntry.get(entry);
  if (notice === null || markdown === null) heldByEntry.delete(entry);
  else heldByEntry.set(entry, { docKey, notice, markdown });
  if (before && before.docKey !== docKey) report(before.docKey);
  report(docKey);
}

/** Keeps a not-applied edit reported held under `docKey` until it is copied or dismissed (a null notice). */
export function setNotAppliedFragmentEdit(docKey: string, notice: string | null) {
  if (notice === null) notAppliedByDoc.delete(docKey);
  else notAppliedByDoc.set(docKey, notice);
  report(docKey);
}

/** Lets go of every held fragment edit, in the doc channel too: the user left without them. */
export function dropHeldFragmentEdits(): void {
  const docKeys = new Set([...[...heldByEntry.values()].map((edit) => edit.docKey), ...notAppliedByDoc.keys()]);
  heldByEntry.clear();
  notAppliedByDoc.clear();
  for (const docKey of docKeys) getUIConfig().docChannel?.setValuesHeld(docKey, null);
}
