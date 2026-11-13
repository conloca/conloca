import { type ContentAPIClient, getContentAPIClient, useLocalizedContent } from '@conloca/content-api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { contentWriteOwner } from '../../write-access.js';

const pendingWrites = new WeakMap<ContentAPIClient, Map<string, Set<Promise<void>>>>();

/** A request can finish after its editor unmounts; keep its lifetime scoped to the same content client. */
export function trackFragmentSave<T>(
  client: ContentAPIClient,
  id: string,
  locale: string,
  request: Promise<T>,
): Promise<T> {
  const owner = contentWriteOwner(client);
  const key = JSON.stringify([id, locale]);
  const writes = pendingWrites.get(owner) ?? new Map<string, Set<Promise<void>>>();
  const requests = writes.get(key) ?? new Set<Promise<void>>();
  const settled = request.then(
    () => undefined,
    () => undefined,
  );
  requests.add(settled);
  writes.set(key, requests);
  pendingWrites.set(owner, writes);
  void settled.then(() => {
    requests.delete(settled);
    if (requests.size === 0) writes.delete(key);
    if (writes.size === 0) pendingWrites.delete(owner);
  });
  return request;
}

/** Wait for every write already sent for this document without retaining its text or treating a rejection as saved. */
export function pendingFragmentSave(client: ContentAPIClient, id: string, locale: string): Promise<void> | null {
  const requests = pendingWrites.get(contentWriteOwner(client))?.get(JSON.stringify([id, locale]));
  return requests?.size ? Promise.all(requests).then(() => undefined) : null;
}

const SAVE_WAIT_TIMEOUT_MS = 30_000;
const SAVE_WAIT_FAILURE = 'The previous save has not finished. Try again or go back.';

/** A deadline reports an unknown write outcome; it never forgets or releases that write. */
export function waitForFragmentSave(pending: Promise<void> | null): Promise<void> {
  if (!pending) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(SAVE_WAIT_FAILURE)), SAVE_WAIT_TIMEOUT_MS);
    void pending.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

interface FragmentArrival {
  client: ContentAPIClient;
  id: string;
  locale: string;
  pending: Promise<void> | null;
  refresh?: boolean;
}

interface FragmentArrivalResolution {
  arrival: FragmentArrival;
  settled: boolean;
  waitError?: string;
}

/** A reopened editor must read after earlier writes settle, before MDX takes its one-time initial value. */
export function useFragmentContent(id: string, locale: string) {
  const client = contentWriteOwner(getContentAPIClient());
  const queryClient = useQueryClient();
  const [snapshot, setSnapshot] = useState<FragmentArrival>(() => ({
    client,
    id,
    locale,
    pending: pendingFragmentSave(client, id, locale),
  }));
  let current = snapshot;
  if (snapshot.client !== client || snapshot.id !== id || snapshot.locale !== locale) {
    current = { client, id, locale, pending: pendingFragmentSave(client, id, locale) };
    setSnapshot(current);
  }
  // This is the arrival snapshot, not a disposable memo: the editor's own later saves cannot unmount its surface.
  const [resolution, setResolution] = useState<FragmentArrivalResolution | null>(null);
  const isSettled = resolution?.arrival === current && resolution.settled;
  const waitError = resolution?.arrival === current ? resolution.waitError : undefined;
  const waitingForSave = !isSettled && (current.pending !== null || resolution?.arrival === current);
  // Even an idle arrival must wait until passive cleanup has revoked the previous editor's flush handler.
  const loaded = useLocalizedContent(isSettled ? id : '', locale);

  useEffect(() => {
    // The previous editor can start its first write or queue another after render, before passive cleanup.
    const committedSave = pendingFragmentSave(current.client, current.id, current.locale);
    if (!current.pending && !committedSave && !current.refresh) {
      setResolution({ arrival: current, settled: true });
      return undefined;
    }
    let active = true;
    setResolution({ arrival: current, settled: false });
    void waitForFragmentSave(Promise.all([current.pending, committedSave]).then(() => undefined))
      .then(async () => {
        if (!active) return;
        // Cancel an older read and drop its cached snapshot before enabling the fresh read. A failed write may
        // still have reached storage, and a successful reply alone cannot describe a later external write.
        await queryClient.resetQueries({ queryKey: ['content', current.id, current.locale], exact: true });
        if (active) setResolution({ arrival: current, settled: true });
      })
      .catch(() => {
        if (active) setResolution({ arrival: current, settled: false, waitError: SAVE_WAIT_FAILURE });
      });
    return () => {
      active = false;
    };
  }, [current, queryClient]);

  const retrySaveWait = () => {
    setSnapshot({ client, id, locale, pending: pendingFragmentSave(client, id, locale), refresh: true });
  };
  // Only the same editor's guarded locale handoff may call this, after awaiting old writes and reading the locale.
  const markLocaleLoaded = (nextLocale: string) => {
    const arrival = { client, id, locale: nextLocale, pending: null };
    setSnapshot(arrival);
    setResolution({ arrival, settled: true });
  };

  return {
    data: loaded.data,
    error: loaded.error,
    isLoading: !isSettled || loaded.isLoading,
    waitingForSave,
    waitError,
    retrySaveWait,
    markLocaleLoaded,
  };
}
