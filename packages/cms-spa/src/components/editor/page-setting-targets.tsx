import { type Overrides, registerOverlayPortal, useGetPuck } from '@puckeditor/core';
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { PAGE_SETTING_ATTRIBUTE } from '../../page-setting-attributes.js';

/**
 * The parts of blocks that show one of the page's settings (marked with
 * `pageSettingAttributes`), made clickable on the page editor's canvas.
 *
 * Puck makes everything inside a block ignore the pointer, so a click on a
 * block's heading lands on the block. `registerOverlayPortal` is Puck's own
 * way to let part of a block take the pointer (its inline text fields use it),
 * with Puck's dashed hover outline in edit mode.
 */

const MARKED = `[${PAGE_SETTING_ATTRIBUTE}]`;

/** Unlayered, like Puck's own canvas rules, so no site rule in `conloca-site` overrides it. */
const PAGE_SETTING_TARGET_CSS = `${MARKED} { cursor: pointer; }`;

interface PageSettingTargets {
  /** Opens Page settings at the named field. */
  openPageSettings(name: string): void;
  /** The canvas document, for the sidebar hint to look up a block's marked parts. */
  readonly canvas: { current: Document | undefined };
}

const PageSettingTargetsContext = createContext<PageSettingTargets | undefined>(undefined);

/**
 * Hands the canvas and the fields panel what opens Page settings. The value is
 * created once and `onOpen` read through a ref, so nothing inside Puck
 * re-renders or remounts when the editor passes a new callback.
 */
export function PageSettingTargetsProvider({
  onOpen,
  children,
}: {
  onOpen: (name: string) => void;
  children: ReactNode;
}) {
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const [targets] = useState<PageSettingTargets>(() => ({
    openPageSettings: (name) => onOpenRef.current(name),
    canvas: { current: undefined },
  }));
  return <PageSettingTargetsContext.Provider value={targets}>{children}</PageSettingTargetsContext.Provider>;
}

/**
 * Makes the marked parts on the canvas document take the pointer and open Page
 * settings at their field when clicked. Does nothing outside a
 * PageSettingTargetsProvider.
 */
export function usePageSettingTargets(canvas: Document | undefined): void {
  const targets = useContext(PageSettingTargetsContext);

  useEffect(() => {
    if (!targets || !canvas?.body) return undefined;
    targets.canvas.current = canvas;

    // Blocks render into the canvas after it loads, and a part can appear
    // later (a cover once its image is set), so the marked parts are tracked
    // as the canvas changes. Puck's own portal attribute is not observed, so
    // registering a portal never wakes the observer.
    const portals = new Map<HTMLElement, (() => void) | undefined>();
    const sync = () => {
      const marked = new Set(canvas.querySelectorAll<HTMLElement>(MARKED));
      for (const [part, unregister] of portals) {
        if (marked.has(part)) continue;
        unregister?.();
        portals.delete(part);
      }
      for (const part of marked) {
        if (!portals.has(part)) portals.set(part, registerOverlayPortal(part));
      }
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(canvas.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [PAGE_SETTING_ATTRIBUTE],
    });

    const onClick = (event: MouseEvent) => {
      // Use the iframe's own Element constructor: instanceof against this window
      // rejects valid canvas nodes because they belong to a different realm.
      const CanvasElement = canvas.defaultView?.Element;
      const target = CanvasElement && event.target instanceof CanvasElement ? event.target : null;
      const name = target?.closest(MARKED)?.getAttribute(PAGE_SETTING_ATTRIBUTE);
      if (!name) return;
      // Capture phase, and the click stops here: it opens Page settings and
      // does nothing else. Puck lets an overlay portal's click bubble on
      // through every block around it, each selecting itself, and then to its
      // canvas, which clears the selection because the click did not land on
      // a block; a marked part inside a link would also navigate the canvas.
      event.preventDefault();
      event.stopPropagation();
      targets.openPageSettings(name);
    };
    canvas.addEventListener('click', onClick, { capture: true });

    const style = canvas.createElement('style');
    style.setAttribute('data-conloca-page-setting-targets', '');
    style.textContent = PAGE_SETTING_TARGET_CSS;
    canvas.head.appendChild(style);

    return () => {
      observer.disconnect();
      canvas.removeEventListener('click', onClick, { capture: true });
      style.remove();
      for (const unregister of portals.values()) unregister?.();
      if (targets.canvas.current === canvas) targets.canvas.current = undefined;
    };
  }, [canvas, targets]);
}

/** Whether the block with this Puck id renders a marked part of its own (not one of a block inside it). */
function blockShowsPageSettings(canvas: Document | undefined, blockId: string | undefined): boolean {
  if (!canvas || !blockId) return false;
  return Array.from(canvas.querySelectorAll(MARKED)).some(
    (part) => part.closest('[data-puck-component]')?.getAttribute('data-puck-component') === blockId,
  );
}

/**
 * Puck's fields panel, with a line above a selected block's fields when parts
 * of it come from Page settings: those parts have no field here, and clicking
 * them on the page is how they are edited.
 */
export const FieldsWithPageSettingsHint: Overrides['fields'] = ({ children, itemSelector }) => {
  const targets = useContext(PageSettingTargetsContext);
  const getPuck = useGetPuck();
  const blockId: string | undefined = itemSelector ? getPuck().getItemBySelector(itemSelector)?.props.id : undefined;
  const [shows, setShows] = useState(false);

  // Read from the canvas once the selection has rendered there.
  useEffect(() => {
    setShows(blockShowsPageSettings(targets?.canvas.current, blockId));
  }, [blockId, targets]);

  return (
    <>
      {shows && (
        <p className="px-4 pt-4 text-xs text-grey-04 dark:text-grey-07">
          Parts of this block come from Page settings. Click one on the page to edit it.
        </p>
      )}
      {children}
    </>
  );
};
