import { getContentAPIClient, useUpdateLocalized } from '@conloca/content-api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import type { PageMetadata } from '../../types.js';
import { buildMetadataUpdate, extractPageMetadata, pageSettingsSaveError } from '../../utils/pageMetadata.js';
import { toast } from '../toast.js';

/** How long opening Page settings live waits for the latest settings before it opens with the ones held. */
export const PAGE_SETTINGS_READ_WAIT_MS = 5000;
/** `read`, or a rejection once it has taken PAGE_SETTINGS_READ_WAIT_MS. */
async function readWithin<T>(read: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(reject, PAGE_SETTINGS_READ_WAIT_MS, new Error('timed out'));
  });
  try {
    return await Promise.race([read, expired]);
  } finally {
    clearTimeout(timer);
  }
}
const PAGE_SETTINGS_READ_FAILED =
  "Couldn't load the latest page settings, so these may be out of date. If someone changed the same setting, Apply will tell you instead of overwriting it.";
const PAGE_SETTINGS_CLASH_UNREAD =
  "Someone changed these settings while you were editing, and the latest couldn't be loaded. Your changes weren't saved. Close Page settings and open it again.";
const PAGE_SETTINGS_UNREAD = "Couldn't load this page's settings. Check your connection and try again.";

/**
 * Page settings of a page edited live, Puck or MDX. They are the page's own, not in its shared doc, so a teammate's
 * change to them reaches no open editor: opening reads the page first, and a save writes them with the version the
 * form's values came from, so a teammate's change to a setting left alone is kept and one to the same setting clashes.
 */
export function useLivePageSettings(id: string, locale: string) {
  const updateContent = useUpdateLocalized();
  const queryClient = useQueryClient();
  const readPending = useRef(false);

  /** Reads the page, then calls `open`; a failed or slow read opens with the settings held, and their version. */
  const openLatest = (open: () => void) => {
    if (readPending.current) return;
    readPending.current = true;
    const pending = toast.loading('Loading the latest page settings…');
    void readWithin(getContentAPIClient().getLocalized(id, locale))
      .then(
        (fresh) => {
          if (fresh) queryClient.setQueryData(['content', id, locale], fresh);
          toast.dismiss(pending);
        },
        (err: Error) => {
          console.warn('[useLivePageSettings] Could not re-read the page settings:', err);
          toast.warning(PAGE_SETTINGS_READ_FAILED, { id: pending });
        },
      )
      .finally(() => {
        readPending.current = false;
        // With no settings held either (the page never loaded), there is nothing to open with.
        if (queryClient.getQueryData<{ localized?: unknown }>(['content', id, locale])?.localized) open();
        else toast.error(PAGE_SETTINGS_UNREAD, { id: pending });
      });
  };

  /**
   * Writes `metadata` from version `etag` and returns the version written. A failure throws so the dialog stays open
   * and shows it; on a clash the dialog moves to the page as it is now, read whole: a version known only by its
   * clashing fields would let the next Apply overwrite another field a teammate changed in it.
   */
  const save = async (metadata: PageMetadata, etag: string): Promise<string | undefined> => {
    const result = await updateContent.mutateAsync({ id, locale, data: buildMetadataUpdate(metadata), etag });
    if (result.success) return result.etag;
    if (!result.conflictDetails?.conflicts?.length) throw pageSettingsSaveError(result);
    const fresh = await readWithin(getContentAPIClient().getLocalized(id, locale)).catch((err: Error) =>
      console.warn('[useLivePageSettings] Could not re-read the page settings:', err),
    );
    if (!fresh?.localized) throw new Error(PAGE_SETTINGS_CLASH_UNREAD);
    queryClient.setQueryData(['content', id, locale], fresh);
    throw pageSettingsSaveError(result, { page: extractPageMetadata(fresh), etag: fresh.localized.etag });
  };

  return { openLatest, save };
}
