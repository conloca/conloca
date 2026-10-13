/** A stored date as a Date, or undefined when it is empty or cannot be read: such a date counts as not set. */
export function readDate(value: string | Date | null | undefined): Date | undefined {
  if (!value) return undefined;
  // Copies a Date, so a caller never shares the one it was handed.
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
