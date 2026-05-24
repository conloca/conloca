import { Check, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Textarea } from '../components/ui';
import { cn } from '../utils/cn';
import { formatConflictValue, parseConflictValue } from './format-value';
import type { FieldConflict, ResolutionDecision } from './types';

interface FieldPickerRowProps {
  field: FieldConflict;
  decision: ResolutionDecision | undefined;
  onDecide(next: ResolutionDecision | undefined): void;
}

/**
 * One conflicted field row in the VXJSON resolver. Shows the two
 * competing values side-by-side, with three picker affordances:
 *
 * - "Use yours" / "Use Alex's" — accept one side verbatim. The side
 *   labels include the author name when available (per the copy
 *   rule: "yours/theirs" only when paired with names).
 * - "Custom" — opens a textarea pre-filled with the current decision
 *   (or the "yours" side as a starting point). Strings flow through
 *   as-is; structured values (objects, arrays) round-trip through
 *   JSON.parse, with an inline error if parsing fails.
 *
 * The selected side gets a green ring + check icon so the row's
 * state is glanceable while scrolling. The decision lives in the
 * parent (the resolver page) so bulk actions can rewrite it without
 * surgery here.
 */
export function FieldPickerRow({ field, decision, onDecide }: FieldPickerRowProps) {
  const yoursLabel = field.yoursAuthor ? 'Use yours' : 'Use this version';
  const theirsLabel = field.theirsAuthor ? 'Use ' + field.theirsAuthor + "'s" : 'Use this version';
  const yoursHeader = field.yoursAuthor ? 'Your version' : 'Version A';
  const theirsHeader = field.theirsAuthor ? field.theirsAuthor + "'s version" : 'Version B';

  const isYours = decision?.kind === 'accept-yours';
  const isTheirs = decision?.kind === 'accept-theirs';
  const customDecision = decision?.kind === 'custom' ? decision : null;
  const isCustom = customDecision !== null;

  return (
    <section className="rounded-md border border-grey-09 dark:border-grey-03 bg-white dark:bg-grey-02 p-4">
      <header className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-medium text-grey-01 dark:text-grey-12">{field.label}</h3>
        <code className="text-xs text-grey-04 dark:text-grey-07 font-mono">{field.path}</code>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <SideCard
          header={yoursHeader}
          value={field.yours}
          selected={isYours}
          buttonLabel={yoursLabel}
          onClick={() => onDecide(isYours ? undefined : { kind: 'accept-yours' })}
        />
        <SideCard
          header={theirsHeader}
          value={field.theirs}
          selected={isTheirs}
          buttonLabel={theirsLabel}
          onClick={() => onDecide(isTheirs ? undefined : { kind: 'accept-theirs' })}
        />
      </div>
      <CustomEditor
        key={isCustom ? 'custom-active' : 'custom-resting'}
        field={field}
        active={isCustom}
        initialValue={customDecision ? customDecision.value : field.yours}
        onActivate={() => onDecide({ kind: 'custom', value: field.yours })}
        onClear={() => onDecide(undefined)}
        onCommit={(value) => onDecide({ kind: 'custom', value })}
      />
    </section>
  );
}

interface SideCardProps {
  header: string;
  value: unknown;
  selected: boolean;
  buttonLabel: string;
  onClick: () => void;
}

function SideCard({ header, value, selected, buttonLabel, onClick }: SideCardProps) {
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
      <pre className="text-xs text-grey-01 dark:text-grey-12 font-mono whitespace-pre-wrap break-words max-h-48 overflow-y-auto mb-3">
        {formatConflictValue(value)}
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
  field: FieldConflict;
  active: boolean;
  initialValue: unknown;
  onActivate(): void;
  onClear(): void;
  onCommit(value: unknown): void;
}

function CustomEditor({ field, active, initialValue, onActivate, onClear, onCommit }: CustomEditorProps) {
  const [draft, setDraft] = useState(() => formatConflictValue(initialValue));
  const [error, setError] = useState<string | null>(null);

  const handleSave = () => {
    const parsed = parseConflictValue(draft, field.yours);
    if (!parsed.ok) {
      setError(parsed.reason);
      return;
    }
    setError(null);
    onCommit(parsed.value);
  };

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
      <p className="text-xs font-medium text-grey-04 dark:text-grey-07 mb-2">Your custom version</p>
      <Textarea
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          if (error) setError(null);
        }}
        rows={4}
        className="font-mono text-xs w-full"
        aria-label={'Custom value for ' + field.label}
      />
      {error ? <p className="text-xs text-red-04 mt-2">{error}</p> : null}
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
          onClick={handleSave}
          className="text-xs font-medium px-3 py-1.5 rounded-md bg-azure-04 hover:bg-azure-03 dark:bg-azure-06 dark:hover:bg-azure-07 text-white transition-colors"
        >
          Save this version
        </button>
      </div>
    </div>
  );
}
