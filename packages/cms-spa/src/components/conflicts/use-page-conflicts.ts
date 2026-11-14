import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { PageConflict, PageRef, ResolveConflictOutcome } from '../../draft-tools.js';
import { useLiveMessage } from '../../live/use-live.js';
import { getUIConfig } from '../../ui-config.js';
import type { ConflictChoice } from './FieldConflictPicker.js';

export interface PageConflicts {
  conflicts: PageConflict[];
  /** The anchor whose choice is being sent. */
  pendingAnchor?: string;
  /** Anchors whose block was removed: only `Keep mine` settles them. */
  goneAnchors: ReadonlySet<string>;
  pick: (conflict: PageConflict, choice: ConflictChoice) => Promise<void>;
  /** The last refusal, with the anchor it answers. */
  error: { anchor: string; text: string } | null;
}

const NO_CONFLICTS: PageConflict[] = [];
const NO_ANCHORS: ReadonlySet<string> = new Set();

export const pageConflictsKey = (page: PageRef) => ['page-conflicts', page.site, page.id, page.locale] as const;

export function samePage(a: PageRef, b: PageRef): boolean {
  return a.site === b.site && a.id === b.id && a.locale === b.locale;
}

/** The page's ref for the draft tools, or null when the host serves none (`configureUI` refuses tools without a site). */
export function draftToolsPage(id: string | undefined, locale: string): PageRef | null {
  const { draftTools, siteId } = getUIConfig();
  return draftTools && siteId && id ? { site: siteId, id, locale } : null;
}

/** Where the other value came from, as the picker names it. */
export function conflictSource(conflict: PageConflict): string {
  return conflict.source === 'review' ? `from a review by ${conflict.authorLabel}` : 'from GitHub';
}

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/** How long ago the other value arrived, for example `2 days ago`. */
export function conflictAge(conflict: PageConflict, now = Date.now()): string {
  const elapsed = now - conflict.createdAt;
  const [unit, size] = STEPS.find(([, ms]) => elapsed >= ms) ?? ['minute', 60_000];
  return RELATIVE.format(-Math.floor(elapsed / size), unit);
}

function refusalText(outcome: Extract<ResolveConflictOutcome, { ok: false }>): string | null {
  switch (outcome.reason) {
    case 'changed':
      return 'Changed just now. Check the values again.';
    case 'anchor-gone':
      return 'This block was removed. Keep yours to settle it.';
    case 'not-found':
      // Settled in another tab: the list refreshes without it.
      return null;
    case 'refused':
    case 'too-large':
      return outcome.message ?? 'This field could not be settled.';
    default:
      return 'This field could not be settled. Try again.';
  }
}

/** The page's stored field clashes, refreshed on each live clash message for it, and a way to settle one. */
export function usePageConflicts(page: PageRef): PageConflicts {
  const tools = getUIConfig().draftTools;
  const client = useQueryClient();
  const [pendingAnchor, setPendingAnchor] = useState<string>();
  const [error, setError] = useState<PageConflicts['error']>(null);
  const [goneAnchors, setGoneAnchors] = useState<ReadonlySet<string>>(NO_ANCHORS);
  const query = useQuery({
    queryKey: pageConflictsKey(page),
    queryFn: () => (tools ? tools.listConflicts(page) : NO_CONFLICTS),
    enabled: Boolean(tools),
  });
  const refresh = useCallback(() => client.invalidateQueries({ queryKey: pageConflictsKey(page) }), [client, page]);
  useLiveMessage('conloca:conflict', (message) => {
    if (samePage(message, page)) void refresh();
  });

  const pick = async (conflict: PageConflict, choice: ConflictChoice) => {
    if (!tools) return;
    setPendingAnchor(conflict.anchor);
    setError(null);
    const outcome = await tools
      .resolveConflict({
        ...page,
        anchor: conflict.anchor,
        valueId: conflict.valueId,
        expectedCurrent: conflict.ours,
        ...(typeof choice === 'string' ? { choice } : { choice: 'value', value: choice.value }),
      })
      .catch((): ResolveConflictOutcome => ({ ok: false, reason: 'unknown' }));
    setPendingAnchor(undefined);
    if (!outcome.ok) {
      const text = refusalText(outcome);
      setError(text === null ? null : { anchor: conflict.anchor, text });
      if (outcome.reason === 'anchor-gone') setGoneAnchors((gone) => new Set(gone).add(conflict.anchor));
      // Nothing changed on a refusal; every other answer may have.
      if (outcome.reason === 'refused') return;
    }
    await refresh();
  };

  return { conflicts: query.data ?? NO_CONFLICTS, pendingAnchor, goneAnchors, pick, error };
}
