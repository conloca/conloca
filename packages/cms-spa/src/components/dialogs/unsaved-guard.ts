import { hasHeldDataValues } from '../../live/data-binding.js';
import { hasHeldWork } from '../../live/markdown-live-plugin.js';
import type { LiveStatus } from '../../live/messages.js';
import { anyHeld } from '../../live/use-live.js';

/**
 * Whether leaving the editor loses work. An editor saving with Save, or a live one before the first status arrives, is
 * judged by its dirty flag; the status is the whole channel's, so it never speaks for a Save editor. Live, only edits
 * neither acknowledged by the server nor kept on this device are at risk. Either way, so are values and replicas the
 * frame holds unwritten and keys held for a body on its way back, which exist nowhere else.
 */
export function shouldBlockLeave(status: LiveStatus | null, localDirty: boolean, live: boolean): boolean {
  const unsynced = !live || status === null ? localDirty : status.pending && !status.persisted;
  return unsynced || hasHeldDataValues() || anyHeld() || hasHeldWork();
}
