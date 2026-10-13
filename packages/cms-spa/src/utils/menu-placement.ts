/**
 * Whether a card's action menu should open above its trigger instead of below —
 * true when the menu would run past the viewport bottom but still fits above it.
 * Card menus are plain absolutely-positioned divs, so anything hanging below the
 * fold is unreachable: the scroll container will not extend for it.
 */
export function menuOpensUp(
  trigger: Pick<DOMRect, 'top' | 'bottom'>,
  viewportHeight: number,
  menuHeight = 160,
): boolean {
  return trigger.bottom + menuHeight > viewportHeight && trigger.top > menuHeight;
}
