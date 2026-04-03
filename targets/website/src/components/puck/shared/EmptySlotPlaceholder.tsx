export function EmptySlotPlaceholder({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-surface-300 dark:border-surface-700 px-6 py-10 text-center text-sm text-surface-400 dark:text-surface-500">
      {label}
    </div>
  );
}
