import cn from 'clsx';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { SANDBOX_FRAME_PATH, type SandboxOutboundMessage } from './frame-runtime.js';

/**
 * Puck mounts canvas content inside a nested srcdoc iframe while React still
 * runs in the parent window. Sandbox postMessages go to the canvas window
 * (the iframe's parent), NOT `window` where React hooks run. Always attach
 * height/ready listeners to the iframe ownerDocument's defaultView.
 */
function messageWindowFor(iframe: HTMLIFrameElement | null): Window {
  return iframe?.ownerDocument?.defaultView ?? window;
}

function ensureSandboxHeightBus(win: Window): void {
  const w = win as Window & { __conlocaSandboxHeightBus?: boolean };
  if (w.__conlocaSandboxHeightBus) return;
  w.__conlocaSandboxHeightBus = true;
  win.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as SandboxOutboundMessage | undefined;
    if (data?.__conlocaSandbox !== true || data.kind !== 'height') return;
    if (!data.k || !(data.px > 0)) return;
    const doc = win.document;
    const el = doc.querySelector(`iframe[data-sandbox-k="${data.k}"]`) as HTMLIFrameElement | null;
    if (el) el.style.height = `${Math.ceil(data.px)}px`;
  });
}

export interface ContentSandboxProps {
  /** `mdx` delivers a compiled MDX function body; `html` a sanitized HTML string. */
  mode: 'mdx' | 'html';
  /** Compiled MDX code or sanitized HTML, delivered to the frame via postMessage. */
  content: string;
  /** Optional stylesheet text forwarded into the frame for preview fidelity. */
  styles?: string;
  className?: string;
  /**
   * When false the iframe is display-only (`pointer-events: none`) so an
   * outer editor surface — Puck's canvas selection, a block wrapper — keeps
   * owning interaction. Defaults to true (links/interaction cross out).
   */
  interactive?: boolean;
  /** A link inside the sandbox was clicked; the host decides what to do. */
  onLinkClick?: (href: string) => void;
  /** A pointer landed in the sandbox — used by hosts that select on click. */
  onInteract?: () => void;
  /** The frame failed to evaluate/render the content. */
  onError?: (error: Error) => void;
}

/**
 * Renders untrusted MDX or HTML inside an opaque-origin `sandbox="allow-scripts"`
 * iframe.
 *
 * Frame identity uses per-instance `?k=` / `data-sandbox-k` echoed on outbound
 * messages. Height is applied on the canvas window (iframe owner), because that
 * is where sandbox `parent.postMessage` lands under Puck's nested preview frame.
 */
export function ContentSandbox({
  mode,
  content,
  styles,
  className,
  interactive = true,
  onLinkClick,
  onInteract,
  onError,
}: ContentSandboxProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const reactId = useId().replace(/:/g, '');
  const frameKeyRef = useRef(`sf_${reactId}_${Math.random().toString(36).slice(2, 10)}`);
  const frameSrc = `${SANDBOX_FRAME_PATH}?k=${encodeURIComponent(frameKeyRef.current)}`;

  const modeRef = useRef(mode);
  const contentRef = useRef(content);
  const stylesRef = useRef(styles);
  modeRef.current = mode;
  contentRef.current = content;
  stylesRef.current = styles;

  const [height, setHeight] = useState(0);
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);

  const deliver = useCallback(() => {
    if (!readyRef.current) return;
    const payload = contentRef.current;
    iframeRef.current?.contentWindow?.postMessage(
      {
        __conlocaSandbox: true,
        kind: 'render',
        mode: modeRef.current,
        payload,
        styles: stylesRef.current,
      },
      '*',
    );
  }, []);

  const markReady = useCallback(() => {
    if (readyRef.current) return;
    readyRef.current = true;
    setReady(true);
  }, []);

  // Attach listeners to the canvas window (owner of this iframe), not React's window.
  useLayoutEffect(() => {
    const iframe = iframeRef.current;
    const win = messageWindowFor(iframe);
    ensureSandboxHeightBus(win);

    const frameKey = frameKeyRef.current;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as SandboxOutboundMessage | undefined;
      if (data?.__conlocaSandbox !== true) return;
      if (data.k !== frameKey) return;
      switch (data.kind) {
        case 'ready':
          markReady();
          break;
        case 'height': {
          const px = Math.max(0, Math.ceil(data.px));
          if (px > 0) {
            setHeight(px);
            const el =
              iframeRef.current ??
              (win.document.querySelector(`iframe[data-sandbox-k="${frameKey}"]`) as HTMLIFrameElement | null);
            if (el) el.style.height = `${px}px`;
          } else {
            deliver();
          }
          break;
        }
        case 'link':
          onLinkClick?.(data.href);
          break;
        case 'interact':
          onInteract?.();
          break;
        case 'error':
          onError?.(new Error(data.message));
          break;
        default:
          break;
      }
    };

    win.addEventListener('message', onMessage);
    return () => win.removeEventListener('message', onMessage);
  }, [markReady, deliver, onLinkClick, onInteract, onError]);

  useEffect(() => {
    if (!ready) return;
    // Chromium occasionally drops a postMessage around iframe load. Duplicate
    // load/ready signals do not create more retries, and unmount clears these.
    const win = messageWindowFor(iframeRef.current);
    const retryTimers = [50, 250, 1000].map((delay) => win.setTimeout(deliver, delay));
    return () => {
      for (const timer of retryTimers) win.clearTimeout(timer);
    };
  }, [ready, deliver]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Mode, content, and styles are delivery events; deliver reads their current values from refs to keep message listeners stable.
  useEffect(() => {
    if (!ready) return;
    deliver();
  }, [ready, mode, content, styles, deliver]);

  return (
    <iframe
      ref={iframeRef}
      title="Sandboxed content preview"
      className={cn('conloca-content-sandbox', className)}
      // SECURITY: allow-scripts WITHOUT allow-same-origin keeps the frame on an
      // opaque origin, cut off from the admin session and privileged globals.
      sandbox="allow-scripts"
      src={frameSrc}
      data-sandbox-k={frameKeyRef.current}
      onLoad={markReady}
      style={{
        width: '100%',
        height: height > 0 ? height : undefined,
        minHeight: height > 0 ? undefined : 1,
        border: 0,
        overflow: 'hidden',
        display: 'block',
        pointerEvents: interactive ? undefined : 'none',
      }}
    />
  );
}
