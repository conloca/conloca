/**
 * The one naming rule for uploads, in every editor and on every server: the file name a picture is stored under, the
 * suffix a taken name gets, and the folder names git and a stored link can hold. Pure strings: the browser entry
 * re-exports them.
 */

/** Names Windows reserves for devices: a file or folder named like this, with any extension, cannot be checked out. */
const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/** True when the part of `name` before its first dot is a Windows device name. */
function isWindowsDeviceName(name: string): boolean {
  return WINDOWS_DEVICE_NAME.test(name.split('.', 1)[0] ?? '');
}

/**
 * Sanitize an uploaded filename: split accented and fullwidth letters into their plain Latin base (`é` keeps its `e`
 * in either Unicode form), lowercase, spaces→`-`, drop chars outside `[a-z0-9._-]`, then leading dots, so a name
 * never becomes a hidden dot-file (`.config.png` → `config.png`), and keep the first 200 characters, so a long name
 * alone cannot push a storage key past its limit. A name left with no Latin letter or digit (only non-Latin words and
 * dashes, say) becomes `file`.
 */
export function safeAssetFilename(name: string): string {
  // Split after the Unicode split, so a fullwidth dot parts the extension off as a plain one does
  const normalized = name.normalize('NFKD');
  const dot = normalized.lastIndexOf('.');
  const hasExt = dot > 0 && dot < normalized.length - 1;
  const base = hasExt ? normalized.slice(0, dot) : normalized;
  const ext = hasExt ? normalized.slice(dot + 1) : '';
  const cleanBase = base
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/^\.+/, '')
    .slice(0, 200);
  const cleanExt = ext.toLowerCase().replace(/[^a-z0-9]/g, '');
  const safeBase = /[a-z0-9]/.test(cleanBase) ? cleanBase : 'file';
  return cleanExt === '' ? safeBase : `${safeBase}.${cleanExt}`;
}

/** Insert a `-n` collision suffix before the extension: `photo.png` → `photo-1.png`. */
export function withNumberSuffix(filename: string, n: number): string {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return `${filename}-${n}`;
  return `${filename.slice(0, dot)}-${n}${filename.slice(dot)}`;
}

/**
 * `name`, or the first `-n` variant of it, that is free: its lowercase is not in `taken` (lowercased names), so
 * `Hero.webp` takes `hero.webp` on a case-insensitive checkout, and it is not a Windows device name. A device name
 * gets its suffix before its first dot, the part Windows reads (`aux.tar.png` → `aux-1.tar.png`).
 */
export function uniqueAssetName(name: string, taken: ReadonlySet<string>): string {
  const device = isWindowsDeviceName(name);
  if (!device && !taken.has(name.toLowerCase())) return name;
  const dot = name.indexOf('.');
  const [base, rest] = dot === -1 ? [name, ''] : [name.slice(0, dot), name.slice(dot)];
  for (let n = 1; ; n += 1) {
    const candidate = device ? `${base}-${n}${rest}` : withNumberSuffix(name, n);
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * Characters a folder name may not hold: whitespace and control characters, and the characters that end a stored
 * `/assets/...` link or that Windows cannot hold in a name.
 */
const FOLDER_NAME_FORBIDDEN = /[\s\p{Cc}"'()<>`\\?#&%*:|]/u;

/**
 * Why `path` (folders below the media folder, `/`-separated, `''` for the media folder itself) cannot hold new
 * media, as a sentence naming the folder and the rule; `null` when it can. Each folder name must be one git can
 * check out on every system and one a stored image link keeps whole.
 */
export function folderPathError(path: string): string | null {
  if (path === '') return null;
  for (const segment of path.split('/')) {
    if (segment === '') return `The folder path "${path}" has an empty folder name between two slashes.`;
    if (segment === '.' || segment === '..') return `"${segment}" cannot be a folder name.`;
    if (/^(\.git|git~1)$/i.test(segment)) return `"${segment}" is reserved by Git and cannot be a folder name.`;
    if (segment.startsWith('.')) return `The folder name "${segment}" cannot start with a dot.`;
    if (/[. ]$/.test(segment)) return `The folder name "${segment}" cannot end with a dot or a space.`;
    if (isWindowsDeviceName(segment)) {
      return `"${segment}" is a name Windows reserves for a device and cannot be a folder name.`;
    }
    if (FOLDER_NAME_FORBIDDEN.test(segment)) {
      return `The folder name "${segment}" cannot hold spaces, line breaks or any of " ' ( ) < > \` \\ ? # & % * : |.`;
    }
  }
  return null;
}

/**
 * Why a new folder `name` cannot sit beside `siblings` (the folders already in its parent): one of them differs from it
 * only in case, and Mac and Windows would check both out as one folder. `null` when none does.
 */
export function folderCaseClashError(name: string, siblings: Iterable<string>): string | null {
  for (const sibling of siblings) {
    if (sibling !== name && sibling.toLowerCase() === name.toLowerCase()) {
      return `The folder "${sibling}" already exists, and "${name}" differs from it only in capital letters, which Mac and Windows treat as the same folder.`;
    }
  }
  return null;
}

/**
 * The name of the file an import URL points at: its decoded last path part, and of that only what follows the last
 * decoded slash or backslash, so no folder of the remote site shows in the media library. A part whose decoding would
 * hold a control character, invisible in the library, or that does not decode, stays as written in the address.
 */
export function fileNameFromUrl(url: URL): string {
  const lastPart = url.pathname.split('/').pop() || 'import';
  let decoded: string;
  try {
    decoded = decodeURIComponent(lastPart);
  } catch {
    return lastPart;
  }
  if (/\p{Cc}/u.test(decoded)) return lastPart;
  return decoded.split(/[/\\]/).pop() || lastPart;
}
