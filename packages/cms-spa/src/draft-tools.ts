/**
 * Draft tools an embedding host may offer the editor: the conflicts on a page still to decide, settling one, discarding a page's
 * draft, and the page's earlier versions. Types only; the host implements them and the editor frame reaches them
 * through the parent (`Init.draftTools`).
 */
import type { FieldConflict, JsonValue } from '@conloca/content-api';

/** One page in one locale. */
export interface PageRef {
  site: string;
  id: string;
  locale: string;
}

/** A conflict on a page still to decide, with every side inline; a side that deleted the value is `undefined`. */
export interface PageConflict extends FieldConflict {
  valueId: string;
  source: 'github' | 'review';
  authorLabel: string;
  createdAt: number;
}

/** A version of a page set aside earlier; `restorable: false` versions can only be read. */
export interface EarlierVersion {
  snapshotId: string;
  reason: string;
  authors: string[];
  at: number;
  expiresAt: number;
  restorable: boolean;
}

/** `unknown`: no answer arrived, so the outcome is not known; check the page again before retrying. */
export type DiscardOutcome =
  | { ok: true }
  | { ok: false; reason: 'kept' | 'changed' | 'committed' | 'not-found' | 'refused' | 'unknown'; message?: string };

export type ResolveConflictOutcome =
  | { ok: true }
  | {
      ok: false;
      reason: 'changed' | 'not-found' | 'anchor-gone' | 'too-large' | 'bad-value' | 'refused' | 'unknown';
      message?: string;
    };

export type RestoreVersionOutcome =
  | { ok: true; kept: string[] }
  | {
      ok: false;
      reason: 'changed' | 'expired' | 'not-found' | 'not-a-page' | 'too-large' | 'path-taken' | 'refused' | 'unknown';
      message?: string;
    };

export interface ResolveConflictInput extends PageRef {
  anchor: string;
  valueId: string;
  /** The value the person saw at `anchor`, `undefined` where the page has none; a page holding another is `changed`. */
  expectedCurrent: JsonValue | undefined;
  choice: 'mine' | 'theirs' | 'value';
  /** Required with `choice: 'value'`; without it the host answers `bad-value`. */
  value?: JsonValue;
}

/** A short note the host shows beside one page in the Pages list, such as where its published change waits. */
export interface PageNote extends PageRef {
  note: string;
}

export interface DraftToolsHost {
  listConflicts(page: PageRef): Promise<PageConflict[]>;
  resolveConflict(input: ResolveConflictInput): Promise<ResolveConflictOutcome>;
  discardPage(page: PageRef): Promise<DiscardOutcome>;
  listVersions(page: PageRef): Promise<EarlierVersion[]>;
  restoreVersion(input: { snapshotId: string }): Promise<RestoreVersionOutcome>;
  /** The host's note for each page that has one; pages without a note are left out. */
  listPageNotes(): Promise<PageNote[]>;
}
