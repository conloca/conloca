import { Check, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Textarea } from '../components/ui';
import { cn } from '../utils/cn';
import type { BlockConflict, ResolutionDecision } from './types';

interface BlockPickerRowProps {
  block: BlockConflict;
  decision: ResolutionDecision | undefined;
  onDecide(next: ResolutionDecision | undefined): void;
}

/**
 * One conflicted MDX block row. Shows the two competing serialized
 * MDX strings side by side, with the same three picker affordances
 * the VXJSON `FieldPickerRow` uses — "Use yours" / "Use <author>'s"
 * / custom edit.
 *
 * MDX values are always strings on the wire (the Branch DO ships
 * the serialized source per the spec). For Phase 1 the picker
 * renders the source verbatim in a styled prose block — non-techie
 * users still recognize the rough shape ("# Heading", paragraphs)
 * and can compare what changed. Hooking the real cms-spa MDX
 * renderer in for a typeset preview is a follow-up; the picker
 * mechanics don't depend on it.
 */
export function BlockPickerRow({ block, decision, onDecide }: BlockPickerRowProps) {
  const yoursLabel = block.yoursAuthor ? 'Use yours' : 'Use this version';
  const theirsLabel = block.theirsAuthor ? 'Use ' + block.theirsAuthor + "'s" : 'Use this version';
  const yoursHeader = block.yoursAuthor ? 'Your version' : 'Version A';
  const theirsHeader = block.theirsAuthor ? block.theirsAuthor + "'s version" : 'Version B';

  const isYours = decision?.kind === 'accept-yours';
  const isTheirs = decision?.kind === 'accept-theirs';
  const customDecision = decision?.kind === 'custom' ? decision : null;
  const isCustom = customDecision !== null;

  return (
    <section className="rounded-md border border-grey-09 dark:border-grey-03 bg-white dark:bg-grey-02 p-4">
      <header className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-medium text-grey-01 dark:text-grey-12">Section {block.blockIndex + 1}</h3>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <SideCard
          header={yoursHeader}
          mdx={block.yoursMdx}
          selected={isYours}
          buttonLabel={yoursLabel}
          onClick={() => onDecide(isYours ? undefined : { kind: 'accept-yours' })}
        />
        <SideCard
          header={theirsHeader}
          mdx={block.theirsMdx}
          selected={isTheirs}
          buttonLabel={theirsLabel}
          onClick={() => onDecide(isTheirs ? undefined : { kind: 'accept-theirs' })}
        />
      </div>
      <CustomEditor
        key={isCustom ? 'custom-active' : 'custom-resting'}
        block={block}
        active={isCustom}
        initialMdx={customDecision && typeof customDecision.value === 'string' ? customDecision.value : block.yoursMdx}
        onActivate={() => onDecide({ kind: 'custom', value: block.yoursMdx })}
        onClear={() => onDecide(undefined)}
        onCommit={(value) => onDecide({ kind: 'custom', value })}
      />
    </section>
  );
}

interface SideCardProps {
  header: string;
  mdx: string;
  selected: boolean;
  buttonLabel: string;
  onClick: () => void;
}

function SideCard({ header, mdx, selected, buttonLabel, onClick }: SideCardProps) {
  return (
    <div
      className={cn(
        'rounded-md border p-3 transition-colors',
        selected
          ? 'border-green-04 dark:border-green-06 bg-green-12/40 dark:bg-green-02/30'
          : 'border-grey-09 dark:border-grey-03 bg-grey-12 dark:bg-grey-01',
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-xs font-medium text-grey-04 dark:text-grey-07">{header}</p>
        {selected ? <Check aria-hidden className="h-4 w-4 text-green-04 dark:text-green-06" /> : null}
      </div>
      <pre className="text-xs text-grey-01 dark:text-grey-12 font-mono whitespace-pre-wrap break-words max-h-64 overflow-y-auto mb-3">
        {mdx}
      </pre>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        className={cn(
          'w-full text-xs font-medium px-3 py-1.5 rounded-md transition-colors',
          selected
            ? 'bg-green-04 dark:bg-green-06 text-white hover:bg-green-03 dark:hover:bg-green-07'
            : 'border border-grey-09 dark:border-grey-03 text-grey-01 dark:text-grey-12 hover:bg-grey-11 dark:hover:bg-grey-03',
        )}
      >
        {selected ? '✓ Selected' : buttonLabel}
      </button>
    </div>
  );
}

interface CustomEditorProps {
  block: BlockConflict;
  active: boolean;
  initialMdx: string;
  onActivate(): void;
  onClear(): void;
  onCommit(mdx: string): void;
}

function CustomEditor({ block, active, initialMdx, onActivate, onClear, onCommit }: CustomEditorProps) {
  const [draft, setDraft] = useState(initialMdx);

  if (!active) {
    return (
      <button
        type="button"
        onClick={onActivate}
        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md text-grey-04 dark:text-grey-07 hover:bg-grey-11 dark:hover:bg-grey-03 hover:text-grey-01 dark:hover:text-grey-12 transition-colors"
      >
        <Pencil aria-hidden className="h-3.5 w-3.5" />
        Write a different version
      </button>
    );
  }

  return (
    <div className="rounded-md border border-grey-09 dark:border-grey-03 bg-grey-12 dark:bg-grey-01 p-3">
      <p className="text-xs font-medium text-grey-04 dark:text-grey-07 mb-2">Your custom section</p>
      <Textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={8}
        className="font-mono text-xs w-full"
        aria-label={'Custom prose for section ' + (block.blockIndex + 1)}
      />
      <div className="flex justify-end gap-2 mt-2">
        <button
          type="button"
          onClick={onClear}
          className="text-xs font-medium px-3 py-1.5 rounded-md text-grey-04 dark:text-grey-07 hover:bg-grey-11 dark:hover:bg-grey-03 hover:text-grey-01 dark:hover:text-grey-12 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onCommit(draft)}
          className="text-xs font-medium px-3 py-1.5 rounded-md bg-azure-04 hover:bg-azure-03 dark:bg-azure-06 dark:hover:bg-azure-07 text-white transition-colors"
        >
          Save this version
        </button>
      </div>
    </div>
  );
}
