import { type ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSandboxPreviewStyles } from '../../sandbox-preview-styles.js';

// flow-root keeps child margins inside the body, so its box is the content height and can shrink.
const EMPTY_DOCUMENT = '<!doctype html><html><head></head><body style="margin:0;display:flow-root"></body></html>';

// Duck-typed, not `instanceof Element`: the target usually belongs to another frame's realm.
const isElement = (target: EventTarget | null): target is Element =>
  target !== null && 'closest' in target && typeof target.closest === 'function';

/**
 * A preview never navigates: a followed link or image-map area would replace the frame (with target=_top or
 * _parent, the editor), and a form submit would too. A submit control's click is cancelled as well, since its
 * `form` attribute may name a form outside the preview whose submit event never passes through it. Cancelling the
 * click only stops the submit or reset; the control's own click handlers still run. Handles click, auxclick and
 * submit.
 */
export function preventLinkNavigation(event: Pick<Event, 'type' | 'target' | 'preventDefault'>): void {
  if (event.type === 'submit') {
    event.preventDefault();
    return;
  }
  const { target } = event;
  if (isElement(target) && target.closest('a, area, button, input[type=submit], input[type=image]')) {
    event.preventDefault();
  }
}

/**
 * A same-origin frame the children render into, so the site's styles (and the
 * prose floor) apply to them without reaching the editor's own UI. Its height
 * follows its body.
 */
export function InlinePreviewFrame({ children, title }: { children: ReactNode; title: string }) {
  const styles = useSandboxPreviewStyles();
  const [frame, setFrame] = useState<HTMLIFrameElement | null>(null);
  const [body, setBody] = useState<HTMLElement | null>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!frame) return undefined;
    const ready = () => {
      const doc = frame.contentDocument;
      // The initial about:blank document is replaced once the srcdoc loads; only the srcdoc one is kept.
      if (doc?.URL === 'about:srcdoc' && doc.readyState === 'complete' && doc.body) setBody(doc.body);
    };
    ready();
    frame.addEventListener('load', ready);
    return () => frame.removeEventListener('load', ready);
  }, [frame]);

  useEffect(() => {
    if (!body) return undefined;
    const doc = body.ownerDocument;
    for (const type of ['click', 'auxclick', 'submit']) doc.addEventListener(type, preventLinkNavigation, true);
    const observer = new ResizeObserver(() => setHeight(Math.ceil(body.getBoundingClientRect().height)));
    observer.observe(body);
    return () => {
      for (const type of ['click', 'auxclick', 'submit']) doc.removeEventListener(type, preventLinkNavigation, true);
      observer.disconnect();
    };
  }, [body]);

  return (
    <>
      <iframe
        ref={setFrame}
        title={title}
        srcDoc={EMPTY_DOCUMENT}
        className="block w-full border-0"
        style={{ height }}
      />
      {body && createPortal(<style data-conloca-preview-styles="">{styles}</style>, body.ownerDocument.head)}
      {body && createPortal(children, body)}
    </>
  );
}
