import type { FieldConflict } from '@conloca/content-api';
import type { Config } from '@puckeditor/core';
import { cn } from '../../utils/cn.js';
import { resolveConflictLabel } from './conflict-label.js';
import { type ConflictChoice, FieldConflictPicker } from './FieldConflictPicker.js';

export interface FieldConflictListProps {
  conflicts: FieldConflict[];
  /** The page's data as the editor holds it; the labels resolve against it and `config`. */
  data: unknown;
  config: Config;
  sourceLabel: (conflict: FieldConflict) => string;
  theirsBy?: (conflict: FieldConflict) => string | undefined;
  age?: (conflict: FieldConflict) => string | undefined;
  /** The anchor whose choice is being sent; only that picker waits. */
  pendingAnchor?: string;
  onPick: (anchor: string, choice: ConflictChoice) => void;
}

/** Every field on a page waiting for a decision, with a count screen readers announce as it changes. */
export function FieldConflictList({
  conflicts,
  data,
  config,
  sourceLabel,
  theirsBy,
  age,
  pendingAnchor,
  onPick,
}: FieldConflictListProps) {
  const count = conflicts.length;
  return (
    <section className={cn('flex flex-col gap-3')}>
      <p role="status" className={cn('text-sm font-medium')}>
        {count === 1 ? '1 field needs a decision' : `${count} fields need a decision`}
      </p>
      {conflicts.map((conflict) => {
        const by = theirsBy?.(conflict);
        const ago = age?.(conflict);
        return (
          <FieldConflictPicker
            key={conflict.anchor}
            conflict={conflict}
            label={resolveConflictLabel(conflict.anchor, data, config)}
            sourceLabel={sourceLabel(conflict)}
            {...(by === undefined ? {} : { theirsBy: by })}
            {...(ago === undefined ? {} : { age: ago })}
            pending={pendingAnchor === conflict.anchor}
            onPick={(choice) => onPick(conflict.anchor, choice)}
          />
        );
      })}
    </section>
  );
}
