import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { RpcError } from '../../frame/channel.js';
import type { PreviewOpenResult } from '../../frame/protocol.js';
import { useSiteBaseUrl } from '../../hooks/index.js';
import {
  EDITOR_CONFIG_CHANGED_EVENT,
  getUIConfig,
  type OpenPreviewResult,
  type PreviewCapability,
  setPreviewCapability,
  type UIConfig,
} from '../../ui-config.js';
import { toast } from '../toast.js';
import {
  PREVIEW_BLOCKED_DETAIL,
  PREVIEW_BLOCKED_TITLE,
  PREVIEW_CHECK_AGAIN,
  PREVIEW_FAILED_DETAIL,
  PREVIEW_FAILED_TITLE,
  PREVIEW_TRY_AGAIN,
  PREVIEW_UNAVAILABLE_DETAIL,
  PREVIEW_UNAVAILABLE_NEXT_STEP,
  PREVIEW_UNAVAILABLE_TITLE,
} from './preview-availability.js';

const TOAST_MS = 10_000;
const UNAVAILABLE_EXPLANATION = `${PREVIEW_UNAVAILABLE_DETAIL} ${PREVIEW_UNAVAILABLE_NEXT_STEP}`;

/** A host that never answers must not leave the control stuck on "working" until the page is reloaded. */
const PREVIEW_REPLY_DEADLINE_MS = 30_000;

export type OpenPreview = NonNullable<UIConfig['openPreview']>;

function subscribeToConfig(onChange: () => void): () => void {
  window.addEventListener(EDITOR_CONFIG_CHANGED_EVENT, onChange);
  return () => window.removeEventListener(EDITOR_CONFIG_CHANGED_EVENT, onChange);
}

function currentProvider(): UIConfig['openPreview'] {
  return getUIConfig().openPreview;
}

function currentCapability(): PreviewCapability {
  return getUIConfig().previewCapability ?? 'unknown';
}

/** The reason, what to do about it, and a way to ask again: the site's answer may have changed since. */
function explainUnavailable(detail: string, checkAgain: () => void) {
  return toast.error(PREVIEW_UNAVAILABLE_TITLE, {
    description: detail,
    duration: TOAST_MS,
    action: { label: PREVIEW_CHECK_AGAIN, onClick: checkAgain },
  });
}

/**
 * Asks the host, rejecting when it throws before answering or never answers. Without that, either would leave the
 * request marked in flight and every later click ignored.
 */
export function askHost(
  openPreview: OpenPreview,
  path: string,
  timeoutMs = PREVIEW_REPLY_DEADLINE_MS,
): Promise<OpenPreviewResult | PreviewOpenResult> {
  // The package's lib target predates Promise.withResolvers.
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`The host did not answer the preview request within ${timeoutMs} ms.`)),
      timeoutMs,
    );
    try {
      openPreview({ path })
        .then(resolve, reject)
        .finally(() => clearTimeout(timer));
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}

export interface PagePreview {
  /** Why the site cannot show a preview, or null when it can (or when nobody has established otherwise). */
  blockedReason: string | null;
  /** A preview request is in flight; a second click would only open a second blank tab. */
  pending: boolean;
  /** The Preview control's click handler. */
  open: () => void;
}

/**
 * What the page editor's Preview control does, and the state it shows.
 *
 * The unavailable state is DERIVED from the live `previewCapability`, which the host rewrites as it learns (the
 * cold-cache re-probe, "Check again", preview setup). Latching it in component state instead left a branch that
 * gained a preview server with a dead control until the page was reloaded. The one thing learned here is the
 * wording: an explicitly unavailable answer from openPreview is written back so the control
 * stops inviting clicks, and a verified successful one as `'available'`, so a stale verdict never outlives the proof against
 * it. Inconclusive site responses offer a retry; a session restriction only explains the refusal.
 * Only a conclusive site response replaces the known verdict.
 *
 * The toasts it raises are the hook's: they are dismissed when the editor goes away, so no action can fire a
 * request for a page that is no longer open.
 */
export function usePagePreview(pathname: string | undefined): PagePreview {
  const { buildUrl } = useSiteBaseUrl();
  const capability = useSyncExternalStore(subscribeToConfig, currentCapability, currentCapability);
  const provider = useSyncExternalStore(subscribeToConfig, currentProvider, currentProvider);
  const [refusal, setRefusal] = useState<{ provider: OpenPreview; message: string } | null>(null);
  const learnedReason = refusal?.provider === provider ? refusal?.message : null;
  const [pending, setPending] = useState(false);
  const pendingRef = useRef<{ provider: OpenPreview } | null>(null);
  const mountedRef = useRef(false);
  const toastId = useRef<string | number | undefined>(undefined);
  // Retry actions reach the request through this ref because the request is defined after them.
  const requestRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // A committed provider transition invalidates its request token, including an A → B → A reversal.
  useLayoutEffect(() => {
    pendingRef.current = null;
    setPending(false);
    setRefusal((current) => (current?.provider === provider ? current : null));
    return () => {
      if (toastId.current !== undefined) toast.dismiss(toastId.current);
      toastId.current = undefined;
    };
  }, [provider]);

  // A reason belongs to the verdict it explained; once the host moves on, drop it.
  useEffect(() => {
    if (capability !== 'unavailable') setRefusal(null);
  }, [capability]);

  const blockedReason = capability === 'unavailable' ? (learnedReason ?? PREVIEW_UNAVAILABLE_DETAIL) : null;

  const show = useCallback((raise: () => string | number) => {
    if (!mountedRef.current) return;
    const next = raise();
    if (toastId.current !== undefined && toastId.current !== next) toast.dismiss(toastId.current);
    toastId.current = next;
  }, []);

  const request = useCallback(() => {
    const { openPreview, openSiteUrl, previewTab: previewTabOwner } = getUIConfig();
    const pathnameOrRoot = pathname || '/';
    if (openPreview) {
      if (pendingRef.current?.provider === openPreview) return;
      const token = { provider: openPreview };
      const ownsResponse = () =>
        mountedRef.current && pendingRef.current === token && getUIConfig().openPreview === openPreview;
      const tryAgain = { label: PREVIEW_TRY_AGAIN, onClick: () => requestRef.current() };
      const reportFailure = (cause: unknown) => {
        if (!ownsResponse()) return;
        if (cause instanceof RpcError && cause.code === 'rate_limited') {
          if (currentCapability() === 'unavailable') {
            const detail = `${learnedReason ?? UNAVAILABLE_EXPLANATION} Please wait a moment before checking again.`;
            show(() => explainUnavailable(detail, () => requestRef.current()));
          } else {
            show(() => toast.info('Please wait a moment before opening another preview.', { action: tryAgain }));
          }
          return;
        }
        // A genuine fault is a DIFFERENT situation from "the site has no preview": not latched, so a transient
        // fault never disables a working button.
        show(() => toast.error(PREVIEW_FAILED_TITLE, { description: PREVIEW_FAILED_DETAIL, action: tryAgain }));
        console.error('[PageEditor] openPreview failed:', cause);
      };
      const reportPopupBlocked = () =>
        show(() =>
          toast.error(PREVIEW_BLOCKED_TITLE, {
            description: PREVIEW_BLOCKED_DETAIL,
            duration: TOAST_MS,
            action: tryAgain,
          }),
        );
      // The site does not serve draft preview, so no URL exists that could work. Say so where the user is
      // looking instead of navigating a tab to a 404 on their own domain, and remember it so the control goes
      // disabled rather than staying a trap.
      const markUnavailable = (message: string) => {
        if (!ownsResponse()) return;
        setRefusal(message !== '' ? { provider: openPreview, message } : null);
        setPreviewCapability('unavailable');
        show(() => explainUnavailable(message !== '' ? message : UNAVAILABLE_EXPLANATION, () => requestRef.current()));
      };
      // A verified mint can replace an earlier verdict; a fail-open URL alone proves nothing.
      const markAvailable = () => {
        if (!ownsResponse()) return;
        if (currentCapability() !== 'available') setPreviewCapability('available');
      };
      const rememberResult = (result: OpenPreviewResult | PreviewOpenResult) => {
        if (!ownsResponse()) return;
        if (result.ok) {
          if (result.previewCapability === 'available') markAvailable();
          return;
        }
        if (result.reason === 'not-allowed') {
          show(() => toast.info(result.message, { duration: TOAST_MS }));
          return;
        }
        if (result.reason !== 'not-deployed') return;
        if (result.previewCapability === 'unavailable') {
          markUnavailable(result.message);
        } else {
          show(() =>
            toast.error(PREVIEW_FAILED_TITLE, {
              description: result.message || PREVIEW_FAILED_DETAIL,
              duration: TOAST_MS,
              action: { label: PREVIEW_CHECK_AGAIN, onClick: () => requestRef.current() },
            }),
          );
        }
      };
      const begin = () => {
        // A popup refusal, disconnect or timeout says nothing new about the site's preview capability.
        pendingRef.current = token;
        setPending(true);
      };
      const end = () => {
        if (pendingRef.current !== token) return;
        pendingRef.current = null;
        if (mountedRef.current) setPending(false);
      };
      // The parent frame opens the tab during the click itself; a blocked popup is the parent's to explain, so
      // the editor shows nothing for it.
      if (previewTabOwner === 'parent') {
        begin();
        void askHost(openPreview, pathnameOrRoot).then(rememberResult).catch(reportFailure).finally(end);
        return;
      }
      // Popup blockers only allow window creation during the click itself. `openPreview` answers
      // asynchronously, so reserve a blank tab now and navigate it once the preview URL arrives.
      const previewTab = window.open('', '_blank');
      if (!previewTab) {
        reportPopupBlocked();
        return;
      }
      previewTab.opener = null;
      begin();
      void askHost(openPreview, pathnameOrRoot)
        .then((result) => {
          if (!ownsResponse()) {
            previewTab.close();
            return;
          }
          rememberResult(result);
          if (result.ok) {
            if ('url' in result) previewTab.location.href = result.url;
            else previewTab.close();
            return;
          }
          previewTab.close();
          if (result.reason === 'popup-blocked') reportPopupBlocked();
        })
        .catch((cause: unknown) => {
          previewTab.close();
          reportFailure(cause);
        })
        .finally(end);
      return;
    }
    if (openSiteUrl) {
      void openSiteUrl({ path: pathnameOrRoot }).catch((cause: unknown) =>
        console.error('[PageEditor] openSiteUrl failed:', cause),
      );
      return;
    }
    const previewUrl = buildUrl(pathnameOrRoot);
    const cacheBustedUrl = `${previewUrl}${previewUrl.includes('?') ? '&' : '?'}_t=${Date.now()}`;
    window.open(cacheBustedUrl, '_blank');
  }, [pathname, buildUrl, show, learnedReason]);
  requestRef.current = request;

  const open = useCallback(() => {
    // Already known to be impossible: explain it without flashing a blank tab open and shut, which reads as a
    // bug even when it is correct.
    if (blockedReason !== null && getUIConfig().openPreview) {
      show(() => explainUnavailable(learnedReason ?? UNAVAILABLE_EXPLANATION, () => requestRef.current()));
      return;
    }
    request();
  }, [blockedReason, learnedReason, request, show]);

  return { blockedReason, pending, open };
}
