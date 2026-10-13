/** The human-readable text of a thrown value, whatever its type. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
