import { cn } from '../../utils/cn.js';
import { Button } from '../ui/Button.js';

export interface OverwriteNoticeProps {
  /** The field as a person reads it, for example `Hero title`. */
  label: string;
  byName: string;
  /** Absent: there is no open shared doc to write the value back into. */
  onRestore?: () => void;
  onDismiss: () => void;
}

/** A teammate replaced a value this person had written; it stays until they restore theirs or dismiss it. */
export function OverwriteNotice({ label, byName, onRestore, onDismiss }: OverwriteNoticeProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2 rounded-md border border-line bg-panel p-3 text-sm')}>
      <p role="status" className={cn('flex-1')}>
        {byName} changed {label}.
      </p>
      {onRestore ? (
        <Button size="sm" variant="outline" onClick={onRestore}>
          Restore yours
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  );
}
