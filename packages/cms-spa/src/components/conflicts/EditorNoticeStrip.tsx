import { isRecord } from '@conloca/content-api/component-vocabulary';
import type { Config } from '@puckeditor/core';
import { useState } from 'react';
import type { PageRef } from '../../draft-tools.js';
import type { LiveMessage } from '../../live/messages.js';
import { type DocEditValue, useDocEdit, useDocRead, useLiveMessage } from '../../live/use-live.js';
import { cn } from '../../utils/cn.js';
import { type ConflictLabel, resolveConflictLabel } from './conflict-label.js';
import { FieldConflictList } from './FieldConflictList.js';
import { OverwriteNotice } from './OverwriteNotice.js';
import { conflictAge, conflictSource, draftToolsPage, samePage, usePageConflicts } from './use-page-conflicts.js';

type Overwritten = Extract<LiveMessage, { type: 'conloca:overwritten' }>;

export interface EditorNoticeStripProps {
  page: PageRef;
  /** The page's data as the editor holds it; labels resolve against it and `config` (Puck), else name the key. */
  data?: unknown;
  config?: Config;
  /** The page's shared doc key, where `Restore yours` writes; without it there is nothing to restore into. */
  docKey?: string;
  /**
   * Set where the fields panel shows each block's pickers (Puck): the strip only counts them and links each field to its
   * block. Without it the strip shows the full pickers itself.
   */
  onSelect?: (anchor: string) => void;
}

const NO_COMPONENTS: Config = { components: {} };

const fieldName = (label: ConflictLabel) => `${label.field}${label.component === null ? '' : ` on ${label.component}`}`;

/** A rich-text value is overwritten whole (`…props.body`), but its field is `…props.body.value`. */
export function overwriteFieldAnchor(message: Overwritten): string {
  return isRecord(message.value) && 'value' in message.value ? `${message.anchor}.value` : message.anchor;
}

/** An overwrite notice, with the teammate's value the field held when it arrived. */
type OpenOverwrite = Overwritten & { seen: DocEditValue };

/**
 * The page's open overwrite notices, one per anchor, newest kept; prose (`body#…`) merges and is never one. `read`
 * records the field's value at notice time, so Restore can tell a newer change from the one announced.
 */
export function useOverwrites(page: PageRef, read: (anchor: string) => DocEditValue = () => undefined) {
  const [notices, setNotices] = useState<OpenOverwrite[]>([]);
  useLiveMessage('conloca:overwritten', (message) => {
    if (!samePage(message, page) || message.anchor.startsWith('body#')) return;
    const notice = { ...message, seen: read(message.anchor) };
    setNotices((open) => [...open.filter((other) => other.anchor !== message.anchor), notice]);
  });
  const dismiss = (anchor: string) => setNotices((open) => open.filter((notice) => notice.anchor !== anchor));
  return { notices, dismiss };
}

/** Above the editor body: the page's field clashes still to decide and the values teammates replaced. */
export function EditorNoticeStrip({ page, data, config = NO_COMPONENTS, docKey, onSelect }: EditorNoticeStripProps) {
  const { conflicts, pendingAnchor, goneAnchors, pick, error } = usePageConflicts(page);
  const { notices, dismiss } = useOverwrites(page, useDocRead(docKey ?? ''));
  const write = useDocEdit(docKey ?? '');
  const [restoreError, setRestoreError] = useState<string | null>(null);

  // Only over the value announced: a newer one (theirs or a third person's) is never replaced unseen.
  const restore = (notice: OpenOverwrite) => {
    const result = write(notice.anchor, notice.value, { value: notice.seen });
    setRestoreError(result.ok ? null : result.message);
    if (result.ok || result.reason === 'changed') dismiss(notice.anchor);
  };

  return (
    <div className={cn('flex flex-col gap-2 px-4 empty:hidden', conflicts.length + notices.length > 0 && 'py-2')}>
      {notices.map((notice) => (
        <div key={notice.anchor} data-field-anchor={overwriteFieldAnchor(notice)}>
          <OverwriteNotice
            label={resolveConflictLabel(overwriteFieldAnchor(notice), data, config).field}
            byName={notice.byName}
            {...(docKey ? { onRestore: () => restore(notice) } : {})}
            onDismiss={() => dismiss(notice.anchor)}
          />
        </div>
      ))}
      {restoreError ? (
        <p role="alert" className={cn('text-sm text-red-04 dark:text-red-08')}>
          {restoreError}
        </p>
      ) : null}
      {conflicts.length === 0 ? (
        <p role="status" className="sr-only">
          No fields need a decision
        </p>
      ) : onSelect ? (
        <nav aria-label="Fields that need a decision" className={cn('flex flex-wrap items-center gap-2 text-sm')}>
          <p role="status" className={cn('font-medium')}>
            {conflicts.length === 1 ? '1 field needs a decision' : `${conflicts.length} fields need a decision`}
          </p>
          {conflicts.map((conflict) => (
            <button
              key={conflict.anchor}
              type="button"
              className={cn('underline text-azure-04 dark:text-azure-08')}
              onClick={() => onSelect(conflict.anchor)}
            >
              {fieldName(resolveConflictLabel(conflict.anchor, data, config))}
            </button>
          ))}
        </nav>
      ) : (
        <FieldConflictList
          conflicts={conflicts}
          data={data}
          config={config}
          sourceLabel={conflictSource}
          age={(conflict) => conflictAge(conflict)}
          {...(pendingAnchor === undefined ? {} : { pendingAnchor })}
          goneAnchors={goneAnchors}
          onPick={(anchor, choice) => {
            const conflict = conflicts.find((candidate) => candidate.anchor === anchor);
            if (conflict) void pick(conflict, choice);
          }}
        />
      )}
      {error && !onSelect ? (
        <p role="alert" className={cn('text-sm text-red-04 dark:text-red-08')}>
          {error.text}
        </p>
      ) : null}
    </div>
  );
}

/** The strip for an editor without Puck's fields panel (MDX, fragments, data): the full pickers inline; nothing without draft tools. */
export function DraftNoticeStrip({ id, locale, docKey }: { id: string | undefined; locale: string; docKey?: string }) {
  const page = draftToolsPage(id, locale);
  return page ? <EditorNoticeStrip page={page} {...(docKey === undefined ? {} : { docKey })} /> : null;
}
