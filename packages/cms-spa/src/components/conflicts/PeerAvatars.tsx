import { useMemo } from 'react';
import type { FrameLiveDoc } from '../../live/doc-channel.js';
import type { PresencePeer } from '../../live/messages.js';
import { usePresencePeers } from '../../live/use-live.js';

const SHOWN = 4;

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
}

/** One peer per person: a teammate in two tabs is one avatar, and the user's own other tabs are none. */
export function peoplePresent(peers: PresencePeer[], selfId: string): PresencePeer[] {
  const people = new Map<string, PresencePeer>();
  for (const peer of peers) if (peer.user.id !== selfId && !people.has(peer.user.id)) people.set(peer.user.id, peer);
  return [...people.values()];
}

/** The other people on the open page, from the same presence the block outlines use; past four collapse into "+N". */
export function PeerAvatars({ live }: { live: Pick<FrameLiveDoc, 'docKey' | 'user'> }) {
  const peers = usePresencePeers(live.docKey);
  const people = useMemo(() => peoplePresent(peers, live.user.id), [peers, live.user.id]);
  if (people.length === 0) return null;
  const hidden = people.length - SHOWN;
  return (
    <ul aria-label="People on this page" className="flex items-center -space-x-1.5">
      {people.slice(0, SHOWN).map((peer) => (
        <li
          key={peer.user.id}
          aria-label={peer.user.name}
          title={peer.user.name}
          className="h-7 w-7 rounded-full bg-azure-04 text-white ring-2 ring-white dark:ring-grey-01 flex items-center justify-center text-xs font-medium"
        >
          <span aria-hidden>{initials(peer.user.name)}</span>
        </li>
      ))}
      {hidden > 0 && (
        <li
          aria-label={`${hidden} more`}
          className="h-7 w-7 rounded-full bg-grey-05 text-white ring-2 ring-white dark:ring-grey-01 flex items-center justify-center text-xs font-medium"
        >
          <span aria-hidden>+{hidden}</span>
        </li>
      )}
    </ul>
  );
}
