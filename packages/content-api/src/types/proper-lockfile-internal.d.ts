// proper-lockfile 4.1.2 exports its in-process lock table from lib/lockfile.js (no `exports` map, so the deep import
// resolves); it is undocumented and missing from @types/proper-lockfile. Only the fields withFileLock reads or sets.
declare module 'proper-lockfile/lib/lockfile.js' {
  export interface LockRecord {
    mtime: Date;
    lastUpdate: number;
    released?: boolean;
    updateTimeout?: NodeJS.Timeout | null;
  }
  export function getLocks(): Record<string, LockRecord>;
}
