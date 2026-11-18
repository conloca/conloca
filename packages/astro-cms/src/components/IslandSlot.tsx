import { createElement, type ReactElement, type ReactNode } from 'react';

/**
 * The element an island's children sit in. On the server it renders the children and records that the component
 * rendered them; in the browser it replays the HTML already on the page, so React keeps those DOM nodes.
 */
export function IslandSlot({
  id,
  html,
  seen,
  children,
}: {
  id: string;
  html?: string;
  seen?: { slot: boolean };
  children?: ReactNode;
}): ReactElement {
  const attributes = { 'data-conloca-island-slot': id, style: { display: 'contents' } };
  if (html !== undefined) {
    return createElement('conloca-island-slot', {
      ...attributes,
      dangerouslySetInnerHTML: { __html: html },
      suppressHydrationWarning: true,
    });
  }
  if (seen) seen.slot = true;
  return createElement('conloca-island-slot', attributes, children);
}
