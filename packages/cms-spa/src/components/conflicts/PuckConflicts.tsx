import { parsePlaceAnchor } from '@conloca/content-api/merge';
import { createUsePuck, type Data, useGetPuck } from '@puckeditor/core';
import { createContext, useContext } from 'react';
import type { PageRef } from '../../draft-tools.js';
import { cn } from '../../utils/cn.js';
import { PUCK_ROOT_DROP_ZONE } from '../editor/DrawerItemOverride.js';
import { resolveConflictLabel } from './conflict-label.js';
import { EditorNoticeStrip } from './EditorNoticeStrip.js';
import { FieldConflictPicker } from './FieldConflictPicker.js';
import { conflictAge, conflictSource, usePageConflicts } from './use-page-conflicts.js';

/** The page the Puck editor shows, for the strip and the fields panel inside `<Puck>`; null without draft tools. */
export const DraftPageContext = createContext<{ page: PageRef; docKey?: string } | null>(null);

const usePuck = createUsePuck();

/**
 * The top-level block whose panel settles an anchor: a block field's or a block position's block. Everything Puck has
 * no block panel for (page fields, legacy zones, block order, the whole page, meta, removed blocks) is `null`: the
 * page settings panel.
 */
// shortcut: a field inside a slot shows on its outermost block; upgrade when slots get their own panel.
function anchorBlockId(anchor: string, content: Data['content']): string | null {
  const id = /^content\[id=([^\]]+)\]/.exec(anchor)?.[1] ?? parsePlaceAnchor(anchor);
  return id && content.some((block) => block.props.id === id) ? id : null;
}

/** Above the canvas: how many fields need a decision, each a link that selects its block. */
export function PuckNoticeStrip() {
  const draft = useContext(DraftPageContext);
  const data = usePuck((s) => s.appState.data);
  const config = usePuck((s) => s.config);
  const dispatch = usePuck((s) => s.dispatch);
  if (!draft) return null;
  const select = (anchor: string) => {
    const id = anchorBlockId(anchor, data.content);
    const index = data.content.findIndex((block) => block.props.id === id);
    dispatch({
      type: 'setUi',
      ui: { itemSelector: index < 0 ? null : { index, zone: PUCK_ROOT_DROP_ZONE } },
    });
  };
  return (
    <EditorNoticeStrip
      page={draft.page}
      data={data}
      config={config}
      {...(draft.docKey === undefined ? {} : { docKey: draft.docKey })}
      onSelect={select}
    />
  );
}

/** In the fields panel: the pickers for the selected block's fields, or the page's own fields with nothing selected. */
export function PageConflictFields({ blockId }: { blockId: string | undefined }) {
  const draft = useContext(DraftPageContext);
  // Without draft tools: nothing, and no query hook (the editor may have no QueryClient).
  return draft ? <PanelPickers page={draft.page} blockId={blockId} /> : null;
}

function PanelPickers({ page, blockId }: { page: PageRef; blockId: string | undefined }) {
  const getPuck = useGetPuck();
  const { conflicts, pendingAnchor, goneAnchors, pick, error } = usePageConflicts(page);
  const { appState, config } = getPuck();
  const shown = conflicts.filter(
    (conflict) => anchorBlockId(conflict.anchor, appState.data.content) === (blockId ?? null),
  );
  // A refusal shows only in the panel of the field it answers.
  const refusal = error && shown.some((conflict) => conflict.anchor === error.anchor) ? error.text : null;
  if (shown.length === 0) return null;
  return (
    <div className={cn('flex flex-col gap-2 px-4 pt-4')}>
      {shown.map((conflict) => (
        <FieldConflictPicker
          key={conflict.anchor}
          conflict={conflict}
          label={resolveConflictLabel(conflict.anchor, appState.data, config)}
          sourceLabel={conflictSource(conflict)}
          age={conflictAge(conflict)}
          pending={pendingAnchor === conflict.anchor}
          mineOnly={goneAnchors.has(conflict.anchor)}
          onPick={(choice) => void pick(conflict, choice)}
        />
      ))}
      {refusal ? (
        <p role="alert" className={cn('text-sm text-red-04 dark:text-red-08')}>
          {refusal}
        </p>
      ) : null}
    </div>
  );
}
