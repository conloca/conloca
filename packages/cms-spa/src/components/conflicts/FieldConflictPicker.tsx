import type { FieldConflict, JsonValue } from '@conloca/content-api';
import { type KeyboardEvent, useId, useRef, useState } from 'react';
import { cn } from '../../utils/cn.js';
import { Button } from '../ui/Button.js';
import { Input } from '../ui/Input.js';
import type { ConflictLabel } from './conflict-label.js';

/** What a person decided: keep their value, take the other one, or settle on a value they typed. */
export type ConflictChoice = 'mine' | 'theirs' | { kind: 'value'; value: JsonValue };

export interface FieldConflictPickerProps {
  conflict: FieldConflict;
  label: ConflictLabel;
  /** Where the other value came from, for example `from GitHub`. */
  sourceLabel: string;
  /** Who wrote the other value; without it the other value is "theirs". */
  theirsBy?: string;
  /** How long ago the other value arrived, for example `2 hours ago`. */
  age?: string;
  /** A choice is being sent: every button is disabled until it settles. */
  pending?: boolean;
  /** The field's block was removed: only `Keep mine` can settle it. */
  mineOnly?: boolean;
  onPick: (choice: ConflictChoice) => void;
}

/** The string leaves of a value, in order. */
function leaves(value: JsonValue): string[] {
  if (value === null) return [];
  if (Array.isArray(value)) return value.flatMap(leaves);
  if (typeof value === 'object') return Object.values(value).flatMap(leaves);
  return [String(value)];
}

/** One value as a person reads it: text, a list of its items, or an object's text joined with `·`; never JSON. */
function ConflictValue({ value }: { value: JsonValue | undefined }) {
  if (value === undefined) return <span className="italic">(deleted)</span>;
  if (leaves(value).join('') === '') return <span className="italic">(empty)</span>;
  if (Array.isArray(value)) {
    return (
      <ul className={cn('list-disc pl-5')}>
        {value.map((item, index) => (
          // Items of an id-less list have nothing steadier than their place.
          // biome-ignore lint/suspicious/noArrayIndexKey: the list is read-only and never reordered here.
          <li key={index} className={cn('line-clamp-3')}>
            {leaves(item).join(' · ')}
          </li>
        ))}
      </ul>
    );
  }
  return <span className={cn('line-clamp-3')}>{leaves(value).join(' · ')}</span>;
}

/**
 * One field two people changed differently. The person keeps theirs, takes the other value or types a new one; nothing
 * settles before they choose. A file a git rule keeps back has no choice here: a developer has to change the setting.
 */
export function FieldConflictPicker({
  conflict,
  label,
  sourceLabel,
  theirsBy,
  age,
  pending = false,
  mineOnly = false,
  onPick,
}: FieldConflictPickerProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const inputId = useId();
  const name = `${label.field}${label.component === null ? '' : ` on ${label.component}`}, ${sourceLabel}`;
  const theirs = conflict.theirs;
  const theirsName = theirsBy === undefined ? 'Their value:' : `${theirsBy}'s value:`;

  const closeEdit = () => {
    setDraft(null);
    // The box takes focus with it when it closes; hand it back to the button that opened it.
    requestAnimationFrame(() => editButton.current?.focus());
  };
  const onEditKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    closeEdit();
  };

  return (
    <fieldset
      aria-label={name}
      aria-busy={pending ? 'true' : undefined}
      className={cn('flex flex-col gap-2 rounded-md border border-line bg-panel p-3 text-sm')}
    >
      <p className={cn('font-medium text-grey-01 dark:text-grey-12')}>
        {name}
        {age === undefined ? null : (
          <span className={cn('ml-1 font-normal text-grey-04 dark:text-grey-07')}>{age}</span>
        )}
      </p>
      {conflict.anchor.startsWith('lfs:') ? (
        <p>Ask your developer: this file needs a git setting before it can ship.</p>
      ) : (
        <>
          <div>
            <span className={cn('font-medium')}>Your value:</span> <ConflictValue value={conflict.ours} />
          </div>
          <div>
            <span className={cn('font-medium')}>{theirsName}</span> <ConflictValue value={theirs} />
          </div>
          {draft === null ? (
            <div className={cn('flex flex-wrap gap-2')}>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => onPick('mine')}>
                Keep mine
              </Button>
              <Button size="sm" variant="outline" disabled={pending || mineOnly} onClick={() => onPick('theirs')}>
                {theirsBy === undefined ? 'Use theirs' : `Use ${theirsBy}'s`}
              </Button>
              {typeof theirs === 'string' ? (
                <Button
                  ref={editButton}
                  size="sm"
                  variant="ghost"
                  disabled={pending || mineOnly}
                  onClick={() => setDraft(theirs)}
                >
                  Edit
                </Button>
              ) : null}
            </div>
          ) : (
            <div className={cn('flex flex-col gap-2')}>
              <label htmlFor={inputId} className={cn('font-medium')}>
                New value for {label.field}
              </label>
              <Input
                id={inputId}
                size="sm"
                value={draft}
                autoFocus
                disabled={pending}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onEditKey}
              />
              <div className={cn('flex gap-2')}>
                <Button size="sm" disabled={pending} onClick={() => onPick({ kind: 'value', value: draft })}>
                  Save value
                </Button>
                <Button size="sm" variant="ghost" disabled={pending} onClick={closeEdit}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </fieldset>
  );
}
