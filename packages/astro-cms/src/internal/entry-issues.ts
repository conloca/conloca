import type { SchemaIssue } from '@conloca/content-api/schemas';

/** Renders a failed parse as the build error the loader throws. */
export function describeEntryIssues(
  issues: readonly SchemaIssue[],
  where: { collection: string; id: string; filePath?: string },
): string {
  const lines = issues.map(
    (issue) => `  - ${issue.path}: expected ${issue.expected}, received ${describeValue(issue.value)}`,
  );
  const file = where.filePath ? ` (${where.filePath})` : '';
  return `[conloca] ${where.collection} entry "${where.id}"${file} does not match its schema:\n${lines.join('\n')}`;
}

function describeValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
